'use strict';

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
        if (rec.verifierType === 'manual') {
            return { criterionId: c.id, verdict: 'PASS', detail: 'manual attestation (STALE-exempt)' };
        }
        if (changedFiles == null) {
            return rec.commitSha !== headSha
                ? { criterionId: c.id, verdict: 'STALE', detail: `commit ${rec.commitSha} != HEAD ${headSha}` }
                : { criterionId: c.id, verdict: 'PASS', detail: 'commit matches HEAD' };
        }
        return dependsMatches(c.dependsOn, changedFiles)
            ? { criterionId: c.id, verdict: 'STALE', detail: 'dependsOn changed since evidence' }
            : { criterionId: c.id, verdict: 'PASS', detail: 'dependsOn unchanged' };
    });
}

module.exports = { deriveVerdicts, globToRegExp };
