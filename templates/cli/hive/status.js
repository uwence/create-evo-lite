'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const manifest = require('../template-manifest');
const { readOutbox } = require('./feedback');
const { readRegistry } = require('./registry');

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readVersion(pkgPath) {
    try { return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || null; }
    catch { return null; }
}

// Split-root managed entries: source = mother templates/, destination = child.
function childEntries(motherRoot, childRoot, options = {}) {
    const families = options.familiesOverride || manifest.MANAGED_TEMPLATE_FAMILIES;
    const selected = options.family ? families.filter(f => f.key === options.family) : families;
    if (options.family && selected.length === 0) {
        throw new Error(`unknown managed family: ${options.family}`);
    }
    const paths = {
        workspaceRoot: childRoot,
        activeCliDir: path.join(childRoot, '.evo-lite', 'cli'),
        templateRootPath: path.join(motherRoot, 'templates'),
        templateCliPath: path.join(motherRoot, 'templates', 'cli'),
    };
    return selected
        .filter(f => f.scope === 'sync-always')
        .flatMap(f => f.files.map(file => manifest.buildEntry(f, file, paths)));
}

function readChildVersion(childEvoDir) {
    const productPath = path.join(childEvoDir, 'evo-lite-version.json');
    if (fs.existsSync(productPath)) {
        return { version: readVersion(productPath), source: 'evo-lite-version.json' };
    }
    // Legacy child scaffolded before the manifest/product split — fall back to the
    // runtime manifest, but mark it so the ambiguity is visible, not silent.
    return { version: readVersion(path.join(childEvoDir, 'package.json')), source: 'package.json (legacy)' };
}

function childStatus(motherRoot, entry, options = {}) {
    const motherVersion = readVersion(path.join(motherRoot, 'package.json'));
    const childEvoDir = path.join(entry.path, '.evo-lite');
    if (!fs.existsSync(childEvoDir)) {
        return { id: entry.id, status: 'unreachable', motherVersion, childVersion: null, versionSource: null, driftedFiles: [], feedback: [] };
    }
    const { version: childVersion, source: versionSource } = readChildVersion(childEvoDir);
    const driftedFiles = [];
    for (const e of childEntries(motherRoot, entry.path, options)) {
        if (!fs.existsSync(e.templateFile)) continue; // mother-side gap is nurture's preflight problem
        if (!fs.existsSync(e.activeFile)) { driftedFiles.push(e.label); continue; }
        if (sha256(fs.readFileSync(e.templateFile)) !== sha256(fs.readFileSync(e.activeFile))) {
            driftedFiles.push(e.label);
        }
    }
    let status = 'up-to-date';
    if (driftedFiles.length) status = 'drifted';
    else if (childVersion !== motherVersion) status = 'behind';
    // Read-only feedback surface: status reports pending outbox items, never marks.
    const feedback = readOutbox(entry.path).pending.map(({ label, text }) => ({ label, text }));
    return { id: entry.id, status, motherVersion, childVersion, versionSource, driftedFiles, feedback };
}

function hiveStatus(motherRoot, options = {}) {
    const reg = readRegistry(motherRoot);
    const children = options.id ? reg.children.filter(c => c.id === options.id) : reg.children;
    return children.map(c => childStatus(motherRoot, c, options));
}

module.exports = { childEntries, childStatus, hiveStatus, sha256 };
