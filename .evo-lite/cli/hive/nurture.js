'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { childEntries, sha256 } = require('./status');
const feedback = require('./feedback');
const registry = require('./registry');
const { runTransaction } = require('../transaction');

function defaultExec(args, cwd) {
    return childProcess.execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function readJson(fp) {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

// Anchor names are [A-Z0-9_]; markers are `<!-- NAME -->` — no regex escaping needed.
function mergeAnchoredContent(motherText, childText, anchorPairs) {
    let merged = motherText;
    for (const [begin, end] of anchorPairs || []) {
        const re = new RegExp(`(<!-- ${begin} -->)([\\s\\S]*?)(<!-- ${end} -->)`);
        const childMatch = childText.match(re);
        if (!childMatch) continue;
        merged = merged.replace(re, (_m, b, _mid, e) => b + childMatch[2] + e);
    }
    return merged;
}

function diffRuntimeDeps(motherRoot, childRoot) {
    const gap = { missing: [], versionDiffs: [] };
    const motherPkgPath = path.join(motherRoot, 'templates', 'runtime', 'package.json');
    const childPkgPath = path.join(childRoot, '.evo-lite', 'package.json');
    if (!fs.existsSync(motherPkgPath) || !fs.existsSync(childPkgPath)) return gap;
    const motherDeps = readJson(motherPkgPath).dependencies || {};
    const childDeps = readJson(childPkgPath).dependencies || {};
    for (const [name, range] of Object.entries(motherDeps)) {
        if (!(name in childDeps)) gap.missing.push(name);
        else if (childDeps[name] !== range) gap.versionDiffs.push({ name, mother: range, child: childDeps[name] });
    }
    return gap;
}

function readChildEngineChoice(childRoot) {
    const cfgPath = path.join(childRoot, '.evo-lite', 'memory-engine.json');
    try {
        if (fs.existsSync(cfgPath)) {
            const cfg = readJson(cfgPath);
            if (cfg && typeof cfg.engine === 'string') return cfg.engine;
        }
    } catch (_) {}
    return 'zvec';
}

function hasChildZvecDependency(childRoot) {
    return [
        path.join(childRoot, '.evo-lite', 'node_modules', '@zvec', 'zvec'),
        path.join(childRoot, 'node_modules', '@zvec', 'zvec'),
    ].some(target => fs.existsSync(target));
}

function assessEngineReadiness(childRoot) {
    const childChoice = readChildEngineChoice(childRoot);
    const depPresent = hasChildZvecDependency(childRoot);
    const recommendation = childChoice === 'zvec' && !depPresent
        ? 'install @zvec/zvec in child, or pin memory-engine.json to sqlite-fts5-trigram then rebuild'
        : '';
    return { childChoice, depPresent, recommendation };
}

function nurtureChild(motherRoot, entry, opts = {}) {
    const now = opts.now || (() => new Date().toISOString());
    const exec = opts.exec || defaultExec;
    const childRoot = entry.path;
    const report = {
        status: null, copied: [], skipped: [], missingSources: [], dirtyFiles: [], feedback: [],
        depGap: { missing: [], versionDiffs: [] }, engineReadiness: null, tag: null, receiptPath: null, upToDate: false,
    };

    if (!fs.existsSync(path.join(childRoot, '.evo-lite'))) {
        report.status = 'unreachable';
        return report;
    }

    const entries = childEntries(motherRoot, childRoot, { family: opts.family, familiesOverride: opts.familiesOverride });
    const motherVersion = readJson(path.join(motherRoot, 'package.json')).version;

    // --- Preflight 1: every source must exist BEFORE any write (all-or-nothing) ---
    report.missingSources = entries.filter(e => !fs.existsSync(e.templateFile)).map(e => e.label);
    if (report.missingSources.length) {
        report.status = 'aborted';
        return report;
    }

    // --- Plan the copy set (and dep gap) — pure reads ---
    const planned = [];
    const checksums = {};
    for (const e of entries) {
        const motherBytes = fs.readFileSync(e.templateFile);
        let targetBytes = motherBytes;
        const childExists = fs.existsSync(e.activeFile);
        if (e.mergeAnchors && e.mergeAnchors.length && childExists) {
            const mergedText = mergeAnchoredContent(motherBytes.toString('utf8'),
                fs.readFileSync(e.activeFile, 'utf8'), e.mergeAnchors);
            targetBytes = Buffer.from(mergedText, 'utf8');
        }
        const targetHash = sha256(targetBytes);
        const relActive = path.relative(childRoot, e.activeFile).replace(/\\/g, '/');
        checksums[relActive] = targetHash;
        if (childExists && sha256(fs.readFileSync(e.activeFile)) === targetHash) {
            report.skipped.push(e.label);
        } else {
            planned.push({ entry: e, bytes: targetBytes });
            report.copied.push(e.label);
        }
    }
    report.depGap = diffRuntimeDeps(motherRoot, childRoot);
    report.engineReadiness = assessEngineReadiness(childRoot);
    report.upToDate = report.copied.length === 0 && report.depGap.missing.length === 0;

    // --- Feedback outbox: pure read here; marking happens inside the transaction ---
    const outbox = feedback.readOutbox(childRoot);
    report.feedback = outbox.pending.map(({ label, text }) => ({ label, text }));

    if (opts.dryRun || opts.check) {
        report.status = 'dry-run';
        return report;
    }

    // --- Preflight 2: dirty check + rollback tag (git; injectable) ---
    let gitAvailable = true;
    try {
        const managedRel = entries.map(e => path.relative(childRoot, e.activeFile).replace(/\\/g, '/'));
        // Guard empty pathspec: `git status --porcelain --` (no paths) reports the
        // WHOLE repo as dirty. Nothing managed → nothing to be dirty about.
        if (managedRel.length > 0) {
            const porcelain = exec(['status', '--porcelain', '--', ...managedRel], childRoot);
            report.dirtyFiles = String(porcelain).split('\n').filter(Boolean).map(l => l.slice(3));
        } else {
            exec(['rev-parse', '--is-inside-work-tree'], childRoot); // still detect non-git for the refuse path
        }
    } catch {
        gitAvailable = false;
    }
    if (!gitAvailable && !opts.force) {
        report.status = 'refused';
        report.dirtyFiles = ['(not a git repo — dirty check impossible; re-run with --force)'];
        return report;
    }
    if (report.dirtyFiles.length && !opts.force) {
        report.status = 'refused';
        return report;
    }
    if (gitAvailable) {
        try {
            report.tag = `evo-nurture-pre-${motherVersion}`;
            exec(['tag', '-a', report.tag, '-m', `pre-nurture rollback point (mother ${motherVersion})`], childRoot);
        } catch {
            report.tag = null; // tag may already exist from a retried nurture — non-fatal
        }
    }

    // --- Apply: copy all, then lock, then receipt, then bump — wrapped in a
    // transaction so a mid-apply failure restores every snapshotted file instead
    // of leaving a half-nurtured child. Registry update happens AFTER commit
    // (see below), since it is the mother's file, not a child snapshot target.
    const productVersionPath = path.join(childRoot, '.evo-lite', 'evo-lite-version.json');
    const lockPath = path.join(childRoot, '.evo-lite', 'generated', 'runtime-mirror.lock.json');
    report.receiptPath = path.join(childRoot, '.evo-lite', 'hive', 'nurture-received.json');
    const outboxPath = feedback.feedbackPath(childRoot);
    const targets = [
        ...planned.map(p => p.entry.activeFile),
        lockPath, report.receiptPath, productVersionPath, outboxPath,
    ];
    const journalPath = path.join(childRoot, '.evo-lite', 'hive', `nurture-journal-${entry.id}.json`);
    const txn = runTransaction({
        root: childRoot, targets, journalPath, now: now(),
        apply: () => {
            for (const p of planned) {
                fs.mkdirSync(path.dirname(p.entry.activeFile), { recursive: true });
                fs.writeFileSync(p.entry.activeFile, p.bytes);
            }
            fs.mkdirSync(path.dirname(lockPath), { recursive: true });
            fs.writeFileSync(lockPath, JSON.stringify({ version: 'evo-runtime-mirror@1', generatedAt: now(), entries: checksums }, null, 2) + '\n');
            // Test-only hook: forces a post-write throw to exercise the rollback path.
            // Never set by real callers — see T-nurture-transactional in governance.js.
            if (opts.failAfterWrites) throw new Error('injected mid-apply failure');
            const receipt = {
                version: 'evo-hive-receipt@1', motherVersion,
                families: [...new Set(entries.map(e => e.family))],
                files: entries.map(e => e.label), engineReadiness: report.engineReadiness, nurturedAt: now(),
            };
            fs.mkdirSync(path.dirname(report.receiptPath), { recursive: true });
            fs.writeFileSync(report.receiptPath, JSON.stringify(receipt, null, 2) + '\n');
            // Feedback outbox: scaffold when absent, else check off collected items.
            // Protocol state (same class as the receipt), never project state.
            if (!outbox.exists) {
                fs.writeFileSync(outboxPath, feedback.FEEDBACK_TEMPLATE);
            } else if (outbox.pending.length) {
                fs.writeFileSync(outboxPath, feedback.markCollected(outbox.text, outbox.pending.map(p => p.line)));
            }
            // Product version travels via evo-lite-version.json — the same artifact the
            // runtime reads and hive/status compares. The runtime manifest package.json
            // is version-pinned by design (lockfile stability); nurture must NOT touch it.
            fs.writeFileSync(productVersionPath, JSON.stringify({ version: motherVersion }, null, 2) + '\n');
        },
    });
    if (!txn.ok) {
        report.status = 'aborted';
        report.aborted = true;
        report.error = txn.error;
        report.journalPath = journalPath;
        return report;
    }

    const reg = registry.readRegistry(motherRoot);
    const regEntry = reg.children.find(c => c.id === entry.id);
    if (regEntry) {
        regEntry.lastNurturedAt = now();
        regEntry.lastNurturedVersion = motherVersion;
        registry.writeRegistry(motherRoot, reg);
    }

    report.status = 'applied';
    return report;
}

module.exports = { nurtureChild, mergeAnchoredContent, diffRuntimeDeps };
