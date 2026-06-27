'use strict';

const fs = require('fs');
const { execSync } = require('child_process');
const { parseSpecCriteria } = require('./validate-contract');
const { parseFrontmatter } = require('../planning/parse-markdown');
const { runVerifier } = require('./run-verifiers');
const { writeRecord } = require('./evidence-store');

function defaultExec(cmd, o) { return execSync(cmd, o); }

function specIdOf(specText) {
    const fm = parseFrontmatter(specText).frontmatter || {};
    return fm.id;
}

function runSpec(specPath, opts = {}) {
    const root = opts.root || process.cwd();
    const exec = opts.exec || defaultExec;
    const specText = fs.readFileSync(specPath, 'utf8');
    const specId = specIdOf(specText);
    if (!specId) return { ok: false, error: 'spec has no id frontmatter', written: [] };
    // Dirty-tree fail-closed: evidence must bind to a real, committed state.
    const porcelain = String(
        opts.porcelain != null ? opts.porcelain : exec('git status --porcelain', { cwd: root })
    ).trim();
    if (porcelain) {
        return { ok: false, error: 'dirty-tree', written: [] };
    }
    const headSha = opts.headSha || String(exec('git rev-parse HEAD', { cwd: root })).trim();
    const ranAt = opts.ranAt || new Date().toISOString();
    const parsed = parseSpecCriteria(specText);
    if (parsed.error) return { ok: false, error: parsed.error, written: [] };
    const written = [];
    for (const c of parsed.criteria) {
        if (c.verifier && c.verifier.type === 'manual') continue;
        const { verdict, detail } = runVerifier(c, { repoRoot: root, exec });
        writeRecord(root, specId, {
            criterionId: c.id, verdict, commitSha: headSha,
            verifierType: c.verifier.type, ranAt, detail, attestedBy: null,
        });
        written.push({ criterionId: c.id, verdict });
    }
    return { ok: true, written };
}

module.exports = { runSpec, specIdOf };
