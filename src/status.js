'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { scanSections, capsVerdict } = require('./structure');

// Every field below is a mechanical fact with one pinned source
// (docs/specs/3.1-minimal-cli.md §2). Nothing here interprets prose.

function git(root, args) {
    try {
        // stderr ignored so a non-repository degrades silently, as claimed.
        return execFileSync('git', args, {
            cwd: root, encoding: 'utf8', timeout: 3000,
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch { return null; }
}

function projectName(root) {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        if (pkg && typeof pkg.name === 'string' && pkg.name) return pkg.name;
    } catch { /* fall through to the directory name */ }
    return path.basename(path.resolve(root));
}

function dirtyCount(root) {
    const porcelain = git(root, ['status', '--porcelain']);
    if (porcelain === null) return null;
    if (!porcelain) return 0;
    return porcelain.split('\n').filter(Boolean).length;
}

function specCount(root) {
    const dir = path.join(root, 'docs', 'specs');
    try {
        return fs.readdirSync(dir).filter(f => f.endsWith('.md')).length;
    } catch { return 0; }
}

// The first second-level heading of the devlog. Its text is copied, never
// interpreted: status does not care what the entry says.
function lastLog(root) {
    try {
        const text = fs.readFileSync(path.join(root, 'docs', 'devlog.md'), 'utf8');
        for (const line of text.split('\n')) {
            if (line.startsWith('## ')) return line.slice(3).trim();
        }
    } catch { /* no devlog */ }
    return null;
}

function collect(root) {
    const projectPath = path.join(root, 'PROJECT.md');
    const initialized = fs.existsSync(projectPath);
    const dirty = dirtyCount(root);
    return {
        Initialized: initialized ? 'yes' : 'no',
        Project: projectName(root),
        Branch: git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || '—',
        Dirty: dirty === null ? '—' : `${dirty} files`,
        Specs: String(specCount(root)),
        'Last log': lastLog(root) || '—',
        // No PROJECT.md means there is nothing to measure, which is a value,
        // not an error branch.
        Caps: initialized
            ? capsVerdict(scanSections(fs.readFileSync(projectPath, 'utf8')))
            : 'N/A',
    };
}

function run(root) {
    const facts = collect(root);
    const width = Math.max(...Object.keys(facts).map(k => k.length)) + 2;
    for (const [key, value] of Object.entries(facts)) {
        console.log(key.padEnd(width) + value);
    }
    return 0;   // display only, never a gate
}

module.exports = { run, collect };
