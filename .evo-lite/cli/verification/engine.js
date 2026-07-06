'use strict';

const fs = require('fs');
const { execSync } = require('child_process');
const { loadValidatedContract, criterionDigest } = require('./validate-contract');
const { parseFrontmatter } = require('../planning/parse-markdown');
const { runVerifier } = require('./run-verifiers');
const { writeRecord, readEvidence } = require('./evidence-store');
const { computeLiveVerdicts } = require('./compute-status');

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
    // Dirty-tree fail-closed: evidence must bind to a real, committed state.
    const porcelain = String(
        opts.porcelain != null ? opts.porcelain : exec('git status --porcelain', { cwd: root })
    ).trim();
    if (porcelain) {
        return { ok: false, error: 'dirty-tree', written: [] };
    }
    const headSha = opts.headSha || String(exec('git rev-parse HEAD', { cwd: root })).trim();
    const ranAt = opts.ranAt || new Date().toISOString();
    // Fail-closed on a malformed contract; a spec with no criteria block is a no-op.
    const contract = loadValidatedContract(specText);
    if (!contract.ok) {
        return { ok: false, error: 'contract invalid: ' + contract.findings.map(f => f.message).join('; '), written: [] };
    }
    const written = [];
    for (const c of contract.criteria) {
        if (c.verifier && c.verifier.type === 'manual') continue;
        const result = runVerifier(c, { repoRoot: root, exec });
        if (result.blocked) {
            // Policy-blocked: write no evidence — the criterion stays UNVERIFIED
            // by absence, preserving stored-verdict ∈ {PASS,FAIL}. Reported below.
            written.push({ criterionId: c.id, verdict: 'UNVERIFIED', blocked: true, detail: result.detail });
            continue;
        }
        writeRecord(root, specId, {
            criterionId: c.id, verdict: result.verdict, commitSha: headSha,
            verifierType: c.verifier.type, ranAt, detail: result.detail, attestedBy: null,
            criterionDigest: criterionDigest(c),
        });
        written.push({ criterionId: c.id, verdict: result.verdict });
    }
    return { ok: true, written };
}

function statusSpec(specPath, opts = {}) {
    const root = opts.root || process.cwd();
    const exec = opts.exec || defaultExec;
    const specText = fs.readFileSync(specPath, 'utf8');
    const specId = specIdOf(specText);
    const headSha = opts.headSha || String(exec('git rev-parse HEAD', { cwd: root })).trim();
    // Fail-closed on a malformed contract — surface it as a single INVALID verdict
    // rather than silently deriving over garbage criteria.
    const contract = loadValidatedContract(specText);
    if (!contract.ok) {
        return contract.findings.map(f => ({ criterionId: f.id, verdict: 'INVALID', detail: f.message }));
    }
    if (contract.noContract) {
        return [{ criterionId: '<contract>', verdict: 'NO-CONTRACT',
            detail: 'no machine-readable acceptance criteria' }];
    }
    const store = readEvidence(root, specId);
    const gitDiff = opts.gitDiff || function (sha) {
        try {
            const out = String(exec(`git diff ${sha}..HEAD --name-only`, { cwd: root }));
            return out.split(/\r?\n/).filter(Boolean);
        } catch (_) {
            return null;   // unreachable commit → STALE
        }
    };
    return computeLiveVerdicts(contract.criteria, store.records, headSha, gitDiff);
}

function attestSpec(specPath, criterionId, opts = {}) {
    const root = opts.root || process.cwd();
    const exec = opts.exec || defaultExec;
    if (!opts.by) throw new Error('attest requires --by <name>');
    const specText = fs.readFileSync(specPath, 'utf8');

    // Trust gate: a human attestation may ONLY stand in for a `manual` verifier.
    // Without this, attest could forge a machine criterion into a STALE-exempt
    // manual PASS, bypassing its verifier and defeating the whole contract.
    const contract = loadValidatedContract(specText);
    if (!contract.ok) {
        throw new Error('contract invalid — cannot attest: ' + contract.findings.map(f => f.message).join('; '));
    }
    const crit = contract.criteria.find(c => c.id === criterionId);
    if (!crit) {
        throw new Error(`criterion not found: ${criterionId}`);
    }
    if (!crit.verifier || crit.verifier.type !== 'manual') {
        throw new Error(`criterion ${criterionId} is type "${crit.verifier && crit.verifier.type}", not manual — only manual criteria can be attested; run its verifier instead`);
    }
    // Clean-tree fail-closed: an attestation binds to a real committed state.
    const porcelain = String(exec('git status --porcelain', { cwd: root })).trim();
    if (porcelain) {
        throw new Error('working tree is dirty — commit or stash first; attestation must bind a real commit');
    }

    const specId = contract.specId;
    const headSha = opts.headSha || String(exec('git rev-parse HEAD', { cwd: root })).trim();
    const ranAt = opts.ranAt || new Date().toISOString();
    const record = {
        criterionId, verdict: 'PASS', commitSha: headSha, verifierType: 'manual',
        ranAt, detail: opts.note || 'manual attestation', attestedBy: opts.by,
        criterionDigest: criterionDigest(crit),
    };
    writeRecord(root, specId, record);
    return record;
}

module.exports = { runSpec, statusSpec, attestSpec, specIdOf };
