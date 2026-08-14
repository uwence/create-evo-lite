'use strict';

const fs = require('fs');
const path = require('path');

const LEDGER_VERSION = 'evo-disposition-ledger@1';
// Frozen ARRAY (not a Set): Object.freeze(new Set()) does NOT block .add(),
// so the exported choices are an array and the lookup structure stays
// module-private below.
const CHOICES = Object.freeze(['not-applicable', 'accepted-debt', 'deferred', 'wont-fix']);
const CHOICES_SET = new Set(CHOICES);

function ledgerPath(projectRoot) {
    return path.join(projectRoot, '.evo-lite', 'dispositions.json');
}

// A missing field is tolerated (no tombstone). A field that is PRESENT but
// unrecognisable must fail closed — same ruling as the releaseBlocking
// frontmatter work: one typo must never silently defeat a gate. `null` is
// rejected on purpose: nothing in this system legitimately writes it, so a
// present-but-null value is a writer bug, not a shape this layer tolerates.
function isValidIsoTimestamp(value) {
    return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function readLedger(projectRoot) {
    const file = ledgerPath(projectRoot);
    if (!fs.existsSync(file)) return { version: LEDGER_VERSION, entries: [] };
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        throw new Error(`disposition ledger is invalid JSON: ${err && err.message ? err.message : String(err)}`);
    }
    if (!parsed || parsed.version !== LEDGER_VERSION || !Array.isArray(parsed.entries)) {
        throw new Error(`disposition ledger must use ${LEDGER_VERSION} with an entries array`);
    }
    const seen = new Set();
    for (const e of parsed.entries) {
        if (!e || typeof e.findingId !== 'string' || seen.has(e.findingId)
            || !/^[0-9a-f]{64}$/.test(e.fingerprint || '')
            || !CHOICES_SET.has(e.choice)) {
            throw new Error('disposition ledger contains an invalid or duplicate entry');
        }
        // orphanedAt: absent is fine (no tombstone). Present must be a valid
        // ISO-8601 string — '', 0, false, null and unparsable strings all
        // fail closed rather than silently reviving a tombstoned decision.
        if (Object.prototype.hasOwnProperty.call(e, 'orphanedAt') && !isValidIsoTimestamp(e.orphanedAt)) {
            throw new Error('disposition ledger contains an invalid or duplicate entry');
        }
        // orphanedHead: same treatment, trivial case only — present must be
        // a non-empty string.
        if (Object.prototype.hasOwnProperty.call(e, 'orphanedHead')
            && (typeof e.orphanedHead !== 'string' || e.orphanedHead.length === 0)) {
            throw new Error('disposition ledger contains an invalid or duplicate entry');
        }
        seen.add(e.findingId);
    }
    return parsed;
}

function writeLedger(projectRoot, ledger) {
    const file = ledgerPath(projectRoot);
    const entries = [...(ledger.entries || [])]
        .sort((a, b) => String(a.findingId).localeCompare(String(b.findingId)));
    const body = `${JSON.stringify({ version: LEDGER_VERSION, entries }, null, 2)}\n`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, body, 'utf8');
    fs.renameSync(tmp, file);
}

function upsertEntry(ledger, entry) {
    const entries = (ledger.entries || []).filter(e => e.findingId !== entry.findingId);
    entries.push(entry);
    return { version: LEDGER_VERSION, entries };
}

// Lives here, not in each consumer: `list`, `verify`, `commitWithContext` and
// `context track` all need it, and three copies of a git-status predicate is
// how they drift apart.
function dispositionsDirty(projectRoot) {
    try {
        return require('child_process')
            .execFileSync('git', ['status', '--porcelain', '--', '.evo-lite/dispositions.json'],
                { cwd: projectRoot, encoding: 'utf8' }).trim().length > 0;
    } catch (err) {
        // Only swallow the "not a git repository" case. Other errors (missing
        // binary, permissions, corrupted .git) must propagate rather than be
        // misreported as "clean" — this function decides governance durability.
        if (err && err.stderr && err.stderr.includes('not a git repository')) {
            return false;
        }
        throw err;
    }
}

module.exports = {
    LEDGER_VERSION, CHOICES, ledgerPath, readLedger, writeLedger, upsertEntry, dispositionsDirty,
};
