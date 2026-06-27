'use strict';

const fs = require('fs');
const path = require('path');
const { validateEvidenceRecord } = require('./validate-contract');

function evidenceSlug(specId) {
    return String(specId).replace(/^spec:/, '');
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
