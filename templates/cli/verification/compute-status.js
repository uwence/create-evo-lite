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
        if (rec.verifierType !== 'manual') {
            const changed = gitDiff(rec.commitSha);
            if (changed === null) {
                return { criterionId: c.id, verdict: 'STALE', detail: `commit ${rec.commitSha} unreachable` };
            }
            return deriveVerdicts([c], [rec], headSha, changed)[0];
        }
        // manual: STALE-exempt, no git needed.
        return deriveVerdicts([c], [rec], headSha, [])[0];
    });
}

module.exports = { computeLiveVerdicts };
