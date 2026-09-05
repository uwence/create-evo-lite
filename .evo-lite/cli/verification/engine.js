'use strict';

const fs = require('fs');
const { execSync, execFileSync } = require('child_process');
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
    // Evidence-derived sha is untrusted input. Refuse anything that is not a bare
    // Git OID before it reaches git at all — a non-OID (tampered or legacy) record
    // is treated as unreachable → STALE, never executed. And use argv-form git so
    // even a malformed sha cannot be interpreted by a shell.
    const OID_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
    const gitDiff = opts.gitDiff || function (sha) {
        if (typeof sha !== 'string' || !OID_RE.test(sha)) return null;
        try {
            const out = String(execFileSync('git',
                ['diff', '--name-only', `${sha}..HEAD`, '--'],
                { cwd: root, encoding: 'utf8' }));
            return out.split(/\r?\n/).filter(Boolean);
        } catch (_) {
            return null;   // unreachable commit → STALE
        }
    };
    return computeLiveVerdicts(contract.criteria, store.records, headSha, gitDiff);
}

// Attest one or more manual criteria in a single pass.
//
// Why more than one: attest is fail-closed on a dirty tree, and writing an
// evidence record is itself what dirties the tree — so attesting N criteria used
// to force N commits, one per criterion, purely to satisfy the next call's own
// precondition. A child project ended up with seven `chore(verification)` commits
// for seven attestations. The commit-bound intent is right (evidence must bind to
// a real committed state); needing a commit BETWEEN two attestations of the same
// state is not part of that intent.
//
// All-or-nothing comes from ordering, not from rollback: every criterion is
// resolved and type-checked, and the tree is verified clean, BEFORE the first
// write happens. There is nothing to undo because nothing is written until the
// whole batch is known good. A rollback transaction here would be more machinery
// for strictly less certainty.
//
// The clean-tree check and `git rev-parse HEAD` run ONCE, so every record in a
// batch binds the same commitSha and the same ranAt — they describe one act of
// human inspection of one tree state, and reading HEAD per record would let them
// disagree if something moved mid-batch.
function attestSpec(specPath, criterionIds, opts = {}) {
    const root = opts.root || process.cwd();
    const exec = opts.exec || defaultExec;
    if (!opts.by) throw new Error('attest requires --by <name>');
    const ids = Array.isArray(criterionIds) ? criterionIds : [criterionIds];
    if (!ids.length) throw new Error('attest requires at least one criterionId');
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length) {
        throw new Error(`criterion listed more than once: ${[...new Set(dupes)].join(', ')}`);
    }
    const specText = fs.readFileSync(specPath, 'utf8');

    // Trust gate: a human attestation may ONLY stand in for a `manual` verifier.
    // Without this, attest could forge a machine criterion into a human PASS,
    // bypassing its verifier and defeating the whole contract.
    const contract = loadValidatedContract(specText);
    if (!contract.ok) {
        throw new Error('contract invalid — cannot attest: ' + contract.findings.map(f => f.message).join('; '));
    }

    // --- Preflight: resolve and type-check EVERY id before any write ---
    const crits = [];
    for (const criterionId of ids) {
        const crit = contract.criteria.find(c => c.id === criterionId);
        if (!crit) {
            throw new Error(`criterion not found: ${criterionId}`);
        }
        if (!crit.verifier || crit.verifier.type !== 'manual') {
            throw new Error(`criterion ${criterionId} is type "${crit.verifier && crit.verifier.type}", not manual — only manual criteria can be attested; run its verifier instead`);
        }
        crits.push(crit);
    }

    // Clean-tree fail-closed: an attestation binds to a real committed state.
    const porcelain = String(exec('git status --porcelain', { cwd: root })).trim();
    if (porcelain) {
        throw new Error('working tree is dirty — commit or stash first; attestation must bind a real commit');
    }

    const specId = contract.specId;
    const headSha = opts.headSha || String(exec('git rev-parse HEAD', { cwd: root })).trim();
    const ranAt = opts.ranAt || new Date().toISOString();

    // --- Writes: preflight passed, so every record below is known valid ---
    const records = crits.map(crit => {
        const record = {
            criterionId: crit.id, verdict: 'PASS', commitSha: headSha, verifierType: 'manual',
            ranAt, detail: opts.note || 'manual attestation', attestedBy: opts.by,
            criterionDigest: criterionDigest(crit),
        };
        writeRecord(root, specId, record);
        return record;
    });
    // A single id still returns the record itself — existing callers are unchanged.
    return Array.isArray(criterionIds) ? records : records[0];
}

module.exports = { runSpec, statusSpec, attestSpec, specIdOf };
