'use strict';

const { criterionDigest } = require('./validate-contract');

// Minimal glob → RegExp: ** spans path segments, * stays within a segment.
function globToRegExp(glob) {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') { re += '.*'; i++; }
            else re += '[^/]*';
        } else if ('\\^$+?.()|[]{}'.includes(c)) {
            re += '\\' + c;
        } else {
            re += c;
        }
    }
    return new RegExp('^' + re + '$');
}

function dependsMatches(dependsOn, changedFiles) {
    const regexes = (dependsOn || []).map(globToRegExp);
    return changedFiles.some(f => regexes.some(r => r.test(f)));
}

// Pure: no git, no verifier execution. headSha + changedFiles are supplied by the
// caller (a later phase computes changedFiles from `git diff record.commitSha..HEAD`).
function deriveVerdicts(criteria, records, headSha, changedFiles) {
    const byId = new Map();
    for (const r of (records || [])) byId.set(r.criterionId, r); // last record wins
    return (criteria || []).map(c => {
        const rec = byId.get(c.id);
        if (!rec) return { criterionId: c.id, verdict: 'UNVERIFIED', detail: 'no evidence record' };
        if (rec.verdict === 'FAIL') return { criterionId: c.id, verdict: 'FAIL', detail: rec.detail || 'recorded FAIL' };
        if (rec.verdict !== 'PASS') return { criterionId: c.id, verdict: 'UNVERIFIED', detail: `raw verdict ${rec.verdict}` };
        // Evidence must match the criterion it claims to verify. Absent or mismatched
        // digest → STALE (covers both machine and manual; legacy records have none).
        if (!rec.criterionDigest) {
            return { criterionId: c.id, verdict: 'STALE', detail: 'evidence predates criterion digest' };
        }
        if (rec.criterionDigest !== criterionDigest(c)) {
            return { criterionId: c.id, verdict: 'STALE', detail: 'criterion definition changed since evidence' };
        }
        // Manual evidence used to return PASS here, BEFORE the dependsOn check —
        // so an attestation only went STALE when the criterion was redefined, never
        // when the code it guards changed. That is backwards: a machine criterion
        // can be re-run for free, while a manual one is exactly the kind only a
        // human can re-check (visual, interaction, feel) — and it was the one
        // permanently exempt. Worse, `readinessOf()` maps every non-PASS verdict to
        // a closure blocker, so a manual PASS that had gone stale in fact still let
        // a spec close READY, and R011 consumed the same verdict.
        //
        // Manual now takes the same path as machine: dependsOn changed → STALE, and
        // a human decides whether the change actually invalidates the attestation.
        // The remedy differs (re-attest, not re-run) and is routed by verifierType
        // in close-preview's remedyFor().
        const kind = rec.verifierType === 'manual' ? 'attestation' : 'evidence';
        if (changedFiles == null) {
            return rec.commitSha !== headSha
                ? { criterionId: c.id, verdict: 'STALE', detail: `commit ${rec.commitSha} != HEAD ${headSha}` }
                : { criterionId: c.id, verdict: 'PASS', detail: 'commit matches HEAD' };
        }
        return dependsMatches(c.dependsOn, changedFiles)
            ? { criterionId: c.id, verdict: 'STALE', detail: `dependsOn changed since ${kind}` }
            : { criterionId: c.id, verdict: 'PASS', detail: `dependsOn unchanged since ${kind}` };
    });
}

module.exports = { deriveVerdicts, globToRegExp };
