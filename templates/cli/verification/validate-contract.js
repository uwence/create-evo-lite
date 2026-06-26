'use strict';

const fs = require('fs');
const path = require('path');

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

module.exports = { validateCriteria, SCHEMA };
