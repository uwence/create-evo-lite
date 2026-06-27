'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { previewClose } = require('./close-preview');
const { parseFrontmatter } = require('../planning/parse-markdown');

function defaultExec(root) {
    return (args) => childProcess.execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function defaultBackfill(root) {
    return require('../planning/backfill-evidence').backfillArchiveEvidence(root);
}

function defaultScan(root) {
    const { scanPlanning, writePlanIR } = require('../planning/scan');
    return writePlanIR(root, scanPlanning(root));
}

function slugFor(fm, specPath) {
    const id = String(fm.id || '').replace(/^spec:/, '').trim();
    return id || path.basename(specPath).replace(/\.md$/, '');
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

function applyClose(specPath, opts = {}) {
    const root = opts.root || process.cwd();
    const exec = opts.exec || defaultExec(root);
    const previewFn = opts.previewFn || ((sp) => previewClose(sp, { root }));
    const backfillFn = opts.backfillFn || defaultBackfill;
    const scanFn = opts.scanFn || defaultScan;
    const now = opts.now || new Date().toISOString();

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
    const planAbs = (plan.uncheckedBoxes > 0 && plan.planPath) ? path.join(root, plan.planPath) : null;
    const willSetStatus = fm.status !== 'done';
    const archPath = path.join(root, '.evo-lite', 'generated', 'planning', 'archive-evidence.json');
    const irPath = path.join(root, '.evo-lite', 'generated', 'planning', 'plan-ir.json');
    const targets = [];
    if (planAbs) targets.push(planAbs);
    if (willSetStatus) targets.push(specPath);
    targets.push(archPath, irPath);

    // Journal: snapshot prior bytes (null = file absent).
    const entries = targets.map(p => ({ path: p, priorBytes: fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null }));
    const journalPath = path.join(root, '.evo-lite', 'verification', `close-journal-${slugFor(fm, specPath)}.json`);
    const journal = { version: 'evo-close-journal@1', spec: specPath, createdAt: now, status: 'applying',
        entries: entries.map(e => ({ path: path.relative(root, e.path).replace(/\\/g, '/'), existed: e.priorBytes !== null })) };
    writeJournal(journalPath, journal);

    const actions = [];
    try {
        if (planAbs) {
            const txt = fs.readFileSync(planAbs, 'utf8');
            fs.writeFileSync(planAbs, txt.replace(/- \[ \] /g, '- [x] '));
            actions.push(`flip ${plan.uncheckedBoxes} checkbox(es) in ${plan.planPath}`);
        }
        if (willSetStatus) {
            fs.writeFileSync(specPath, setStatusDone(specText));
            actions.push('set spec status: done');
        }
        backfillFn(root);
        scanFn(root);
        actions.push('backfill R008 archive evidence + rescan plan IR');
    } catch (err) {
        for (const e of entries) {
            if (e.priorBytes === null) { if (fs.existsSync(e.path)) fs.unlinkSync(e.path); }
            else fs.writeFileSync(e.path, e.priorBytes);
        }
        writeJournal(journalPath, Object.assign({}, journal, { status: 'aborted', error: err.message }));
        return { applied: false, aborted: true, error: err.message, journalPath };
    }

    const staged = targets.filter(p => fs.existsSync(p)).map(p => path.relative(root, p).replace(/\\/g, '/'));
    if (staged.length) exec(['add', ...staged]);
    writeJournal(journalPath, Object.assign({}, journal, { status: 'applied', actions, staged }));

    return { applied: true, readiness: 'READY', actions, journalPath, staged };
}

module.exports = { applyClose, setStatusDone, slugFor };
