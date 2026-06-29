'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { previewClose } = require('./close-preview');
const { parseFrontmatter } = require('../planning/parse-markdown');
const { evidenceSlug } = require('./evidence-store');

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

    const specText = fs.readFileSync(specPath, 'utf8');
    const fm = parseFrontmatter(specText).frontmatter || {};
    const plan = preview.plan || {};

    // Build target list (every file --apply may overwrite).
    const planNeedsMutation = !!plan.planPath &&
        (plan.uncheckedBoxes > 0 || (plan.planStatus && plan.planStatus !== 'done'));
    const planAbs = planNeedsMutation ? path.join(root, plan.planPath) : null;
    const willSetStatus = fm.status !== 'done';
    const archPath = path.join(root, '.evo-lite', 'generated', 'planning', 'archive-evidence.json');
    const irPath = path.join(root, '.evo-lite', 'generated', 'planning', 'plan-ir.json');
    const targets = [];
    if (planAbs) targets.push(planAbs);
    if (willSetStatus) targets.push(specPath);
    targets.push(archPath, irPath);

    // Journal: snapshot prior bytes (null = file absent).
    const entries = targets.map(p => ({ path: p, priorBytes: fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null }));
    const journalPath = path.join(root, '.evo-lite', 'verification', `close-journal-${evidenceSlug(fm.id)}.json`);
    const journal = { version: 'evo-close-journal@1', spec: specPath, createdAt: now, status: 'applying',
        entries: entries.map(e => ({ path: path.relative(root, e.path).replace(/\\/g, '/'), existed: e.priorBytes !== null })) };
    writeJournalFn(journalPath, journal);

    const actions = [];
    let staged = [];
    try {
        if (planAbs) {
            let txt = fs.readFileSync(planAbs, 'utf8');
            if (plan.uncheckedBoxes > 0) txt = txt.replace(/- \[ \] /g, '- [x] ');
            fs.writeFileSync(planAbs, setStatusDone(txt));
            actions.push(plan.uncheckedBoxes > 0
                ? `flip ${plan.uncheckedBoxes} checkbox(es) + set plan status: done in ${plan.planPath}`
                : `set plan status: done in ${plan.planPath}`);
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
        const sourceTargets = [planAbs, willSetStatus ? specPath : null].filter(Boolean);
        staged = sourceTargets.filter(p => fs.existsSync(p)).map(p => path.relative(root, p).replace(/\\/g, '/'));
        if (staged.length) exec(['add', ...staged]);
        writeJournalFn(journalPath, Object.assign({}, journal, { status: 'applied', actions, staged }));
    } catch (err) {
        for (const e of entries) {
            if (e.priorBytes === null) { if (fs.existsSync(e.path)) fs.unlinkSync(e.path); }
            else fs.writeFileSync(e.path, e.priorBytes);
        }
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
