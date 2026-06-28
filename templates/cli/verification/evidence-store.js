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
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
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
