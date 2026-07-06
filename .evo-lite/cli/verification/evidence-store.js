'use strict';

const fs = require('fs');
const path = require('path');
const { validateEvidenceRecord } = require('./validate-contract');

function evidenceSlug(specId) {
    const slug = String(specId).replace(/^spec:/, '');
    // Reject anything that could escape the verification dir (path separators, `..`).
    // The slug becomes a filename — a malicious spec id must not write outside it.
    if (!/^[a-z0-9._-]+$/i.test(slug)) {
        throw new Error(`invalid spec id for evidence slug: ${specId}`);
    }
    return slug;
}

function evidencePath(root, specId) {
    return path.join(root, '.evo-lite', 'verification', `evidence-${evidenceSlug(specId)}.json`);
}

function readEvidence(root, specId) {
    const fp = evidencePath(root, specId);
    if (!fs.existsSync(fp)) {
        return { version: 'evo-verification-evidence@1', specId, records: {} };
    }
    let store;
    try {
        store = JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch (e) {
        // Fail-closed: a malformed evidence file must never be silently treated as
        // "no evidence" — that would flip a real FAIL to UNVERIFIED-by-absence.
        throw new Error(`malformed evidence file ${path.basename(fp)}: not valid JSON (${e.message})`);
    }
    if (!store || typeof store !== 'object' || Array.isArray(store) ||
        typeof store.records !== 'object' || store.records === null || Array.isArray(store.records)) {
        throw new Error(`malformed evidence file ${path.basename(fp)}: records must be an object`);
    }
    // Individually invalid records are dropped LOUDLY (never silently) so a
    // tampered/legacy record can't masquerade as a valid verdict.
    for (const [key, rec] of Object.entries(store.records)) {
        const findings = validateEvidenceRecord(rec);
        if (findings.length) {
            console.warn(`⚠ evidence record "${key}" excluded (${findings.map(f => f.message).join('; ')})`);
            delete store.records[key];
        }
    }
    return store;
}

function writeRecord(root, specId, record) {
    const findings = validateEvidenceRecord(record);
    if (findings.length) {
        throw new Error('invalid evidence record: ' + findings.map(f => f.message).join('; '));
    }
    const store = readEvidence(root, specId);
    store.records[record.criterionId] = record;
    const fp = evidencePath(root, specId);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(store, null, 2) + '\n');
    return store;
}

module.exports = { evidenceSlug, evidencePath, readEvidence, writeRecord };
