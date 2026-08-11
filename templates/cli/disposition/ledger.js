'use strict';

const fs = require('fs');
const path = require('path');

const LEDGER_VERSION = 'evo-disposition-ledger@1';
const CHOICES = Object.freeze(new Set(['not-applicable', 'accepted-debt', 'deferred', 'wont-fix']));

function ledgerPath(projectRoot) {
    return path.join(projectRoot, '.evo-lite', 'dispositions.json');
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
            || !CHOICES.has(e.choice)) {
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
    } catch (_) { return false; }   // not a git repo
}

module.exports = {
    LEDGER_VERSION, CHOICES, ledgerPath, readLedger, writeLedger, upsertEntry, dispositionsDirty,
};
