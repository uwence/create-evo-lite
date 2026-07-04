'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { childEntries, sha256 } = require('./status');
const registry = require('./registry');

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

function nurtureChild(motherRoot, entry, opts = {}) {
    const now = opts.now || (() => new Date().toISOString());
    const exec = opts.exec || defaultExec;
    const childRoot = entry.path;
    const report = {
        status: null, copied: [], skipped: [], missingSources: [], dirtyFiles: [],
        depGap: { missing: [], versionDiffs: [] }, tag: null, receiptPath: null, upToDate: false,
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
    report.upToDate = report.copied.length === 0 && report.depGap.missing.length === 0;

    if (opts.dryRun || opts.check) {
        report.status = 'dry-run';
        return report;
    }

    // --- Preflight 2: dirty check + rollback tag (git; injectable) ---
    let gitAvailable = true;
    try {
        const managedRel = entries.map(e => path.relative(childRoot, e.activeFile).replace(/\\/g, '/'));
        const porcelain = exec(['status', '--porcelain', '--', ...managedRel], childRoot);
        report.dirtyFiles = String(porcelain).split('\n').filter(Boolean).map(l => l.slice(3));
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

    // --- Apply: copy all, then lock, then receipt, then bump, then registry ---
    for (const p of planned) {
        fs.mkdirSync(path.dirname(p.entry.activeFile), { recursive: true });
        fs.writeFileSync(p.entry.activeFile, p.bytes);
    }
    const lockPath = path.join(childRoot, '.evo-lite', 'generated', 'runtime-mirror.lock.json');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ version: 'evo-runtime-mirror@1', generatedAt: now(), entries: checksums }, null, 2) + '\n');

    const receipt = {
        version: 'evo-hive-receipt@1',
        motherVersion,
        families: [...new Set(entries.map(e => e.family))],
        files: entries.map(e => e.label),
        nurturedAt: now(),
    };
    report.receiptPath = path.join(childRoot, '.evo-lite', 'hive', 'nurture-received.json');
    fs.mkdirSync(path.dirname(report.receiptPath), { recursive: true });
    fs.writeFileSync(report.receiptPath, JSON.stringify(receipt, null, 2) + '\n');

    const childPkgPath = path.join(childRoot, '.evo-lite', 'package.json');
    const childPkg = readJson(childPkgPath);
    childPkg.version = motherVersion;
    fs.writeFileSync(childPkgPath, JSON.stringify(childPkg, null, 2) + '\n');

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
