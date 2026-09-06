'use strict';

const { deriveVerdicts } = require('./derive-verdicts');

// Computes the live verdict per criterion using that criterion's own changedFiles
// (git diff <its record's commitSha>..HEAD). gitDiff returns null for an
// unreachable commit, which is reported conservatively as STALE.
function computeLiveVerdicts(criteria, records, headSha, gitDiff) {
    return (criteria || []).map(c => {
        const rec = records ? records[c.id] : undefined;
        if (!rec) {
            return deriveVerdicts([c], [], headSha, [])[0];   // UNVERIFIED
        }
        // Every verifier type takes the same path. Manual used to be handed an
        // empty changedFiles array and skipped git entirely ("STALE-exempt, no git
        // needed") — but attestSpec() already requires a clean tree and reads HEAD,
        // so a manual record always carries a real commit sha and git is available
        // here regardless. The exemption bought nothing and cost the one signal
        // that tells a human their attestation may no longer hold.
        const changed = gitDiff(rec.commitSha);
        if (changed === null) {
            return { criterionId: c.id, verdict: 'STALE', detail: `commit ${rec.commitSha} unreachable` };
        }
        return deriveVerdicts([c], [rec], headSha, changed)[0];
    });
}

module.exports = { computeLiveVerdicts };
