'use strict';

const fs = require('fs');
const path = require('path');

// Read current bytes of each path (null = absent) so a failed apply can be undone.
function snapshotFiles(paths) {
    return paths.map(p => ({ path: p, priorBytes: fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null }));
}

// Restore each snapshot entry: rewrite prior content, or remove a file that
// did not exist before the transaction.
function rollbackFiles(entries) {
    for (const e of entries) {
        if (e.priorBytes === null) {
            if (fs.existsSync(e.path)) fs.unlinkSync(e.path);
        } else {
            fs.writeFileSync(e.path, e.priorBytes);
        }
    }
}

function defaultWriteJournal(journalPath, payload) {
    fs.mkdirSync(path.dirname(journalPath), { recursive: true });
    fs.writeFileSync(journalPath, JSON.stringify(payload, null, 2) + '\n');
}

// Snapshot `targets`, run `apply()`, and on any throw restore every target and
// mark the journal aborted. Git staging (if any) belongs inside `apply`.
function runTransaction({ root, targets, journalPath, now, writeJournalFn, apply }) {
    const writeJournal = writeJournalFn || defaultWriteJournal;
    const entries = snapshotFiles(targets);
    const base = {
        version: 'evo-transaction@1', createdAt: now, status: 'applying',
        entries: entries.map(e => ({
            path: root ? path.relative(root, e.path).replace(/\\/g, '/') : e.path,
            existed: e.priorBytes !== null,
        })),
    };
    writeJournal(journalPath, base);
    try {
        const result = apply();
        writeJournal(journalPath, Object.assign({}, base, { status: 'applied' }));
        return { ok: true, journalPath, result };
    } catch (err) {
        rollbackFiles(entries);
        writeJournal(journalPath, Object.assign({}, base, { status: 'aborted', error: err.message }));
        return { ok: false, error: err.message, journalPath };
    }
}

module.exports = { snapshotFiles, rollbackFiles, runTransaction };
