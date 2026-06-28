'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseFrontmatter } = require('../planning/parse-markdown');

const SCHEMA = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'contract-schema.json'), 'utf8'));

function finding(id, message) {
    return { id, level: 'error', message };
}

function validateCriteria(criteria) {
    const findings = [];
    if (!Array.isArray(criteria)) {
        return [finding('criteria', 'criteria must be an array')];
    }
    const seen = new Set();
    criteria.forEach((c, i) => {
        const id = (c && typeof c.id === 'string') ? c.id : `#${i}`;
        if (!c || typeof c.id !== 'string' || !c.id) {
            findings.push(finding(id, 'criterion is missing a string id'));
        } else if (seen.has(c.id)) {
            findings.push(finding(id, `duplicate criterion id: ${c.id}`));
        } else {
            seen.add(c.id);
        }
        if (!c || typeof c.description !== 'string' || !c.description) {
            findings.push(finding(id, 'criterion is missing a string description'));
        }
        if (!c || !Array.isArray(c.dependsOn) || c.dependsOn.length === 0) {
            findings.push(finding(id, 'criterion needs a non-empty dependsOn array'));
        }
        const v = c && c.verifier;
        if (!v || typeof v.type !== 'string') {
            findings.push(finding(id, 'criterion is missing verifier.type'));
            return;
        }
        const typeSpec = SCHEMA.verifierTypes[v.type];
        if (!typeSpec) {
            findings.push(finding(id, `unknown verifier type: ${v.type}`));
            return;
        }
        const params = (v.params && typeof v.params === 'object') ? v.params : {};
        for (const req of typeSpec.requiredParams) {
            if (!(req in params)) {
                findings.push(finding(id, `missing required param "${req}" for type ${v.type}`));
            }
        }
        const allowed = new Set([...typeSpec.requiredParams, ...typeSpec.optionalParams]);
        for (const key of Object.keys(params)) {
            if (!allowed.has(key)) {
                findings.push(finding(id, `unknown param "${key}" for type ${v.type}`));
            }
        }
    });
    return findings;
}

function validateEvidenceRecord(rec) {
    const findings = [];
    const id = (rec && typeof rec.criterionId === 'string') ? rec.criterionId : '<record>';
    if (!rec || typeof rec.criterionId !== 'string' || !rec.criterionId) {
        findings.push(finding(id, 'evidence record needs a string criterionId'));
    }
    if (!rec || !SCHEMA.verdictStates.includes(rec.verdict)) {
        findings.push(finding(id, `verdict must be one of ${SCHEMA.verdictStates.join(', ')}`));
    }
    if (!rec || typeof rec.commitSha !== 'string' || !rec.commitSha) {
        findings.push(finding(id, 'evidence record needs a commitSha'));
    }
    if (!rec || !SCHEMA.verifierTypes[rec.verifierType]) {
        findings.push(finding(id, 'verifierType must be a known type'));
    }
    const attested = rec && rec.attestedBy != null && rec.attestedBy !== '';
    if (rec && rec.verifierType === 'manual' && !attested) {
        findings.push(finding(id, 'manual evidence requires a non-null attestedBy'));
    }
    if (rec && rec.verifierType !== 'manual' && attested) {
        findings.push(finding(id, 'machine evidence must not carry attestedBy'));
    }
    return findings;
}

function parseSpecCriteria(specText) {
    const lines = String(specText).split(/\r?\n/);
    const headIdx = lines.findIndex(l => /^##\s+Acceptance Criteria\s*$/.test(l));
    if (headIdx === -1) {
        return { criteria: [], error: 'no "## Acceptance Criteria" heading found' };
    }
    let start = -1;
    for (let i = headIdx + 1; i < lines.length; i++) {
        if (/^##\s+/.test(lines[i])) break;            // next section, no block
        if (/^```json\s*$/.test(lines[i])) { start = i + 1; break; }
    }
    if (start === -1) {
        return { criteria: [], error: 'no ```json criteria block under Acceptance Criteria' };
    }
    const end = lines.findIndex((l, i) => i >= start && /^```\s*$/.test(l));
    if (end === -1) {
        return { criteria: [], error: 'unterminated ```json block' };
    }
    try {
        const parsed = JSON.parse(lines.slice(start, end).join('\n'));
        return { criteria: Array.isArray(parsed.criteria) ? parsed.criteria : [], error: null };
    } catch (e) {
        return { criteria: [], error: `invalid JSON in criteria block: ${e.message}` };
    }
}

// The single fail-closed entry every run/status/preview/apply/attest path uses:
// parse frontmatter id + criteria, then validate. ok=false when the criteria block
// is missing/malformed OR any criterion fails validation — callers must refuse.
function loadValidatedContract(specText) {
    const fm = parseFrontmatter(specText).frontmatter || {};
    const specId = fm.id;
    const parsed = parseSpecCriteria(specText);
    if (parsed.error) {
        // A missing heading / missing json block means the spec simply opts out of
        // the contract (NO-CONTRACT) — ok, no criteria, not a failure. A present-but-
        // malformed block (bad/unterminated JSON) is invalid → fail-closed.
        const optedOut = /no "## Acceptance Criteria"|no ```json criteria block/.test(parsed.error);
        if (optedOut) {
            return { ok: true, noContract: true, specId, criteria: [], findings: [] };
        }
        return { ok: false, noContract: false, specId, criteria: [], findings: [finding('contract', parsed.error)] };
    }
    const findings = validateCriteria(parsed.criteria);
    return { ok: findings.length === 0, noContract: parsed.criteria.length === 0, specId, criteria: parsed.criteria, findings };
}

// Recursively sort object keys so the JSON is canonical regardless of author key order.
function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value).sort()) out[k] = canonicalize(value[k]);
        return out;
    }
    return value;
}

// Fingerprint of a criterion's VERIFICATION SEMANTICS only (id + verifier + dependsOn).
// description is excluded (prose). Used to STALE evidence when the criterion is redefined.
function criterionDigest(criterion) {
    const c = criterion || {};
    const v = c.verifier || {};
    const norm = canonicalize({
        id: c.id,
        verifier: { type: v.type, params: v.params || {} },
        dependsOn: c.dependsOn || [],
    });
    return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(norm)).digest('hex');
}

module.exports = { validateCriteria, validateEvidenceRecord, parseSpecCriteria, loadValidatedContract, criterionDigest, SCHEMA };
