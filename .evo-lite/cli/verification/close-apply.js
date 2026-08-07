'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { previewClose } = require('./close-preview');
const { parseFrontmatter, markTrackedPlanCheckboxesDone } = require('../planning/parse-markdown');
const { evidenceSlug } = require('./evidence-store');
const { snapshotFiles, rollbackFiles } = require('../transaction');

function defaultExec(root) {
    return (args) => childProcess.execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function defaultBackfill(root) {
    return require('../planning/backfill-evidence').backfillArchiveEvidence(root);
}

function defaultScan(root) {
    const { scanPlanning, writePlanIR } = require('../planning/scan');
    return writePlanIR(scanPlanning(root), root);
}

function slugFor(fm) {
    return evidenceSlug(fm && fm.id);
}

// Set frontmatter `status:` to done (rewrite the key, or insert if absent).
function setStatusDone(text) {
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return text;
    let block = m[1];
    if (/^status:.*$/m.test(block)) {
        block = block.replace(/^status:.*$/m, 'status: done');
    } else {
        block = block + '\nstatus: done';
    }
    return text.replace(m[0], `---\n${block}\n---`);
}

function writeJournal(journalPath, payload) {
    fs.mkdirSync(path.dirname(journalPath), { recursive: true });
    fs.writeFileSync(journalPath, JSON.stringify(payload, null, 2) + '\n');
}

const LOCK_STALE_MS = 10 * 60 * 1000;

// Minimal advisory lock — guards the single-user local case against two concurrent
// `--apply` runs racing on the regenerated plan-ir.json. Atomic `wx` create; a lock
// older than LOCK_STALE_MS (by the caller's `now`) is treated as a crashed run and
// overwritten so a dead lock can't brick the command forever. Returns the lock path,
// or null when a fresh lock is already held.
function acquireCloseLock(root, now) {
    const lockPath = path.join(root, '.evo-lite', 'verification', 'close.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const content = JSON.stringify({ pid: process.pid, startedAt: now }) + '\n';
    try {
        fs.writeFileSync(lockPath, content, { flag: 'wx' });
        return lockPath;
    } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let startedAt = null;
        try { startedAt = JSON.parse(fs.readFileSync(lockPath, 'utf8')).startedAt; } catch (_) { /* unparseable → stale */ }
        const age = startedAt ? (Date.parse(now) - Date.parse(startedAt)) : Infinity;
        if (!(age >= 0) || age > LOCK_STALE_MS) {
            fs.writeFileSync(lockPath, content);
            return lockPath;
        }
        return null;
    }
}

function applyClose(specPath, opts = {}) {
    const root = opts.root || process.cwd();
    const exec = opts.exec || defaultExec(root);
    const previewFn = opts.previewFn || ((sp) => previewClose(sp, { root }));
    const backfillFn = opts.backfillFn || defaultBackfill;
    const scanFn = opts.scanFn || defaultScan;
    const now = opts.now || new Date().toISOString();
    const writeJournalFn = opts.writeJournalFn || writeJournal;

    // Advisory lock around the whole apply (gates + mutations) so two concurrent runs
    // cannot both pass Gate 1 and then race on the regenerated planning artifacts.
    const lockPath = acquireCloseLock(root, now);
    if (!lockPath) {
        return { applied: false, refused: 'locked',
            message: 'another mem close --apply is in progress (close.lock) — wait or remove .evo-lite/verification/close.lock' };
    }
    try {

    // Gate 1: clean tree.
    const porcelain = String(exec(['status', '--porcelain']) || '').trim();
    if (porcelain) {
        return { applied: false, refused: 'dirty-tree', readiness: null,
            message: 'working tree is dirty — commit or stash first' };
    }

    // Gate 2: READY only.
    const preview = previewFn(specPath);
    if (preview.readiness !== 'READY') {
        return { applied: false, refused: preview.readiness, readiness: preview.readiness,
            blockers: preview.blockers || [], note: preview.note };
    }

    const plan = preview.plan || {};

    // Gate 3: every declared linked plan must have been resolved. This is a
    // transaction-safety gate like dirty-tree and the lock, NOT a readiness
    // verdict — acceptance readiness stays criteria-only. But closing a spec
    // while one of its linked plans could not even be located would leave a
    // half-closed governance state that no rollback can describe.
    const unresolved = Array.isArray(plan.unresolvedPlanIds) ? plan.unresolvedPlanIds : [];
    if (unresolved.length) {
        return { applied: false, refused: 'plan-resolution-incomplete', readiness: preview.readiness,
            unresolvedPlanIds: unresolved,
            // Covers both routes: no IR record at all, and a record carrying no
            // sourcePath. Claiming "not found in the planning IR" would be false
            // for the second, where the record exists and is simply not
            // actionable.
            message: `linked plan(s) cannot be resolved to mutable source files: ${unresolved.join(', ')} — refusing a partial closure` };
    }

    const specText = fs.readFileSync(specPath, 'utf8');
    const fm = parseFrontmatter(specText).frontmatter || {};

    // Build target list (every file --apply may overwrite). ALL linked plans that
    // need mutation go in the same batch: closing a spec means closing every plan
    // that belongs to it, and "plan A done, plan B untouched, spec done" is the
    // silent half-transaction this task exists to remove.
    const planStates = Array.isArray(plan.plans)
        ? plan.plans
        : (plan.planPath || plan.planId ? [plan] : []);
    const planMutations = planStates
        .filter(p => !!p.planPath && (p.uncheckedBoxes > 0 || (p.planStatus && p.planStatus !== 'done')))
        .map(p => ({ ...p, abs: path.join(root, p.planPath) }));
    const willSetStatus = fm.status !== 'done';
    const archPath = path.join(root, '.evo-lite', 'generated', 'planning', 'archive-evidence.json');
    const irPath = path.join(root, '.evo-lite', 'generated', 'planning', 'plan-ir.json');
    const targets = [];
    for (const m of planMutations) targets.push(m.abs);
    if (willSetStatus) targets.push(specPath);
    targets.push(archPath, irPath);

    // Journal: snapshot prior bytes (null = file absent).
    const entries = snapshotFiles(targets);
    const journalPath = path.join(root, '.evo-lite', 'verification', `close-journal-${evidenceSlug(fm.id)}.json`);
    const journal = { version: 'evo-close-journal@1', spec: specPath, createdAt: now, status: 'applying',
        entries: entries.map(e => ({ path: path.relative(root, e.path).replace(/\\/g, '/'), existed: e.priorBytes !== null })) };
    writeJournalFn(journalPath, journal);

    const actions = [];
    let staged = [];
    try {
        for (const m of planMutations) {
            const original = fs.readFileSync(m.abs, 'utf8');
            // Scanner-owned, line-indexed rewrite. The previous
            // `txt.replace(/- \[ \] /g, ...)` was unanchored and global, so it
            // also rewrote indented children, prose, and literals inside fenced
            // code — including examples that match the tracked grammar exactly.
            const marked = markTrackedPlanCheckboxesDone(original);
            // Preview promised a number. If the file no longer agrees, either the
            // tree moved under us or the two semantics have forked again; a
            // partial rewrite is the worst outcome, so abort into the existing
            // rollback rather than write something nobody predicted.
            if (typeof m.uncheckedBoxes === 'number' && marked.changedCount !== m.uncheckedBoxes) {
                throw new Error(`checkbox count mismatch in ${m.planPath}: preview said ${m.uncheckedBoxes}, scanner found ${marked.changedCount}`);
            }
            fs.writeFileSync(m.abs, setStatusDone(marked.content));
            actions.push(marked.changedCount > 0
                ? `flip ${marked.changedCount} checkbox(es) + set ${m.planId} status: done in ${m.planPath}`
                : `set ${m.planId} status: done in ${m.planPath}`);
        }
        if (willSetStatus) {
            fs.writeFileSync(specPath, setStatusDone(specText));
            actions.push('set spec status: done');
        }
        backfillFn(root);
        scanFn(root);
        actions.push('backfill R008 archive evidence + rescan plan IR');
        // Stage tracked source (plan + spec) INSIDE the txn so a git-add failure rolls
        // back too. archPath/irPath are gitignored regenerated artifacts — journaled for
        // rollback but never `git add`-ed (git refuses ignored paths and would fail).
        const sourceTargets = [...planMutations.map(m => m.abs), willSetStatus ? specPath : null].filter(Boolean);
        staged = sourceTargets.filter(p => fs.existsSync(p)).map(p => path.relative(root, p).replace(/\\/g, '/'));
        if (staged.length) exec(['add', ...staged]);
        writeJournalFn(journalPath, Object.assign({}, journal, { status: 'applied', actions, staged }));
    } catch (err) {
        rollbackFiles(entries);
        // Unstage anything we git-add-ed so a rollback leaves the index clean too.
        try { if (staged.length) exec(['reset', '--', ...staged]); } catch (_) { /* best-effort */ }
        writeJournalFn(journalPath, Object.assign({}, journal, { status: 'aborted', error: err.message }));
        return { applied: false, aborted: true, error: err.message, journalPath };
    }

    return { applied: true, readiness: 'READY', actions, journalPath, staged,
        warnings: preview.warnings || [] };

    } finally {
        try { fs.unlinkSync(lockPath); } catch (_) { /* already gone */ }
    }
}

module.exports = { applyClose, setStatusDone, slugFor, defaultScan, defaultBackfill, LOCK_STALE_MS };
