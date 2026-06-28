'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function truncate(s, n = 500) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n) + '…' : s;
}

// Resolve a spec-supplied relative path but refuse to escape the project root.
// A criterion from an untrusted spec must not probe `../../etc/passwd`.
function resolveWithin(repoRoot, rel) {
    const root = path.resolve(repoRoot);
    const abs = path.resolve(root, String(rel == null ? '' : rel));
    if (abs !== root && !abs.startsWith(root + path.sep)) {
        throw new Error(`path escapes project root: ${rel}`);
    }
    return abs;
}

function getByKeyPath(obj, keys) {
    let cur = obj;
    for (const k of keys) {
        if (cur == null || typeof cur !== 'object' || !(k in cur)) return { found: false };
        cur = cur[k];
    }
    return { found: true, value: cur };
}

function runJsonPathEquals(repoRoot, p) {
    let data;
    try {
        data = JSON.parse(fs.readFileSync(resolveWithin(repoRoot, p.file), 'utf8'));
    } catch (e) {
        return { verdict: 'FAIL', detail: `cannot read ${p.file}: ${e.message}` };
    }
    const got = getByKeyPath(data, p.path || []);
    if (!got.found) return { verdict: 'FAIL', detail: `path ${JSON.stringify(p.path)} not found in ${p.file}` };
    let expected;
    if ('equals' in p) {
        expected = p.equals;
    } else if (p.equalsJsonPath) {
        let d2;
        try {
            d2 = JSON.parse(fs.readFileSync(resolveWithin(repoRoot, p.equalsJsonPath.file), 'utf8'));
        } catch (e) {
            return { verdict: 'FAIL', detail: `cannot read ${p.equalsJsonPath.file}: ${e.message}` };
        }
        const g2 = getByKeyPath(d2, p.equalsJsonPath.path || []);
        if (!g2.found) return { verdict: 'FAIL', detail: `equalsJsonPath ${JSON.stringify(p.equalsJsonPath.path)} not found` };
        expected = g2.value;
    } else {
        return { verdict: 'FAIL', detail: 'json-path-equals needs equals or equalsJsonPath' };
    }
    const ok = JSON.stringify(got.value) === JSON.stringify(expected);
    return ok
        ? { verdict: 'PASS', detail: `${JSON.stringify(got.value)} == expected` }
        : { verdict: 'FAIL', detail: `${JSON.stringify(got.value)} != ${JSON.stringify(expected)}` };
}

function runVerifier(criterion, opts = {}) {
    const repoRoot = opts.repoRoot || process.cwd();
    const exec = opts.exec || ((cmd, o) => execSync(cmd, o));
    const v = (criterion && criterion.verifier) || {};
    const p = v.params || {};
    try {
        switch (v.type) {
            case 'command': {
                try {
                    const out = exec(p.cmd, { cwd: repoRoot, timeout: 120000 });
                    return { verdict: 'PASS', detail: `exit=0 ${truncate(out)}`.trim() };
                } catch (e) {
                    return { verdict: 'FAIL', detail: `exit=${e.status != null ? e.status : '?'} ${truncate(e.stdout || e.message)}`.trim() };
                }
            }
            case 'file-exists':
                return fs.existsSync(resolveWithin(repoRoot, p.path))
                    ? { verdict: 'PASS', detail: `${p.path} exists` }
                    : { verdict: 'FAIL', detail: `${p.path} missing` };
            case 'file-absent':
                return !fs.existsSync(resolveWithin(repoRoot, p.path))
                    ? { verdict: 'PASS', detail: `${p.path} absent` }
                    : { verdict: 'FAIL', detail: `${p.path} present` };
            case 'json-path-equals':
                return runJsonPathEquals(repoRoot, p);
            default:
                return { verdict: 'FAIL', detail: `non-runnable verifier type: ${v.type}` };
        }
    } catch (e) {
        return { verdict: 'FAIL', detail: `verifier error: ${e.message}` };
    }
}

module.exports = { runVerifier, getByKeyPath };
