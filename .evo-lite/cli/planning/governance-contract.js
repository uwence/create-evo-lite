'use strict';

const fs = require('fs');
const path = require('path');

const CONTRACT_KEYS = [
    'schema', 'artifactStage', 'proofLayer', 'requiredCapabilities',
    'blockScope', 'remediationBudget', 'requiredInvariants',
];
const STAGES = new Set(['design', 'plan', 'spike', 'implementation', 'closure']);
const LAYERS = new Set(['A', 'B', 'C']);
const BLOCK_SCOPES = new Set(['artifact', 'admission', 'implementation', 'none']);
const INVARIANT_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function finding(code, file, message, level = 'error') {
    return { code, level, file: file || null, message };
}

function duplicateJsonKey(jsonText) {
    const seen = new Set();
    const keyRe = /"((?:\\.|[^"\\])*)"\s*:/g;
    let match;
    while ((match = keyRe.exec(jsonText)) !== null) {
        let key;
        try { key = JSON.parse(`"${match[1]}"`); } catch (_) { continue; }
        if (seen.has(key)) return key;
        seen.add(key);
    }
    return null;
}

function parseGovernanceContract(markdown) {
    const text = String(markdown == null ? '' : markdown);
    const headingRe = /^## Governance Contract[ \t]*\r?$/gm;
    const headings = [...text.matchAll(headingRe)];
    if (headings.length === 0) return { present: false, contract: null, error: null };
    if (headings.length !== 1) {
        return { present: true, contract: null, error: 'duplicate Governance Contract heading' };
    }

    const heading = headings[0];
    const bodyStart = heading.index + heading[0].length;
    const remainder = text.slice(bodyStart).replace(/^\r?\n/, '');
    const nextHeading = remainder.search(/^##\s+/m);
    const section = (nextHeading === -1 ? remainder : remainder.slice(0, nextHeading)).trim();
    const fence = section.match(/^```json\r?\n([\s\S]*?)\r?\n```$/);
    if (!fence) {
        return { present: true, contract: null, error: 'Governance Contract must contain exactly one JSON fence and no extra content' };
    }

    const jsonText = fence[1];
    const duplicate = duplicateJsonKey(jsonText);
    if (duplicate) {
        return { present: true, contract: null, error: `duplicate JSON key: ${duplicate}` };
    }
    let contract;
    try { contract = JSON.parse(jsonText); } catch (error) {
        return { present: true, contract: null, error: `invalid Governance Contract JSON: ${error.message}` };
    }
    if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
        return { present: true, contract: null, error: 'Governance Contract JSON must be an object' };
    }
    const unknown = Object.keys(contract).filter(key => !CONTRACT_KEYS.includes(key));
    if (unknown.length) {
        return { present: true, contract: null, error: `unknown Governance Contract key: ${unknown[0]}` };
    }
    const missing = CONTRACT_KEYS.filter(key => !Object.prototype.hasOwnProperty.call(contract, key));
    if (missing.length) {
        return { present: true, contract: null, error: `missing Governance Contract key: ${missing[0]}` };
    }
    return { present: true, contract, error: null };
}

function validateStringArray(value, field, file, { nonEmpty = false, invariant = false } = {}) {
    const findings = [];
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        return [finding('PLAN_CONTRACT_INVALID', file, `${field} must be an array of strings`)];
    }
    if (nonEmpty && value.length === 0) {
        findings.push(finding('PLAN_CONTRACT_INVALID', file, `${field} must not be empty`));
    }
    if (new Set(value).size !== value.length) {
        findings.push(finding('PLAN_CONTRACT_INVALID', file, `${field} entries must be unique`));
    }
    if (invariant) {
        const invalid = value.find(item => !INVARIANT_RE.test(item));
        if (invalid) findings.push(finding('PLAN_CONTRACT_INVALID', file, `${field} contains invalid invariant ${JSON.stringify(invalid)}`));
    } else {
        const invalid = value.find(item => !item.trim() || item !== item.trim());
        if (invalid != null) findings.push(finding('PLAN_CONTRACT_INVALID', file, `${field} entries must be non-empty trimmed strings`));
    }
    return findings;
}

function isSpecPath(filePath) {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    return /(^|\/)docs\/(?:superpowers\/)?specs\//.test(normalized);
}

function isPlanPath(filePath) {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    return /(^|\/)docs\/(?:superpowers\/)?plans\//.test(normalized);
}

function validateGovernanceContract(contract, context = {}) {
    const file = context.filePath || null;
    const findings = [];
    if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
        return [finding('PLAN_CONTRACT_INVALID', file, 'Governance Contract must be an object')];
    }
    const unknown = Object.keys(contract).filter(key => !CONTRACT_KEYS.includes(key));
    if (unknown.length) findings.push(finding('PLAN_CONTRACT_INVALID', file, `unknown Governance Contract key: ${unknown[0]}`));
    const missing = CONTRACT_KEYS.filter(key => !Object.prototype.hasOwnProperty.call(contract, key));
    if (missing.length) findings.push(finding('PLAN_CONTRACT_INVALID', file, `missing Governance Contract key: ${missing[0]}`));
    if (findings.length) return findings;

    if (contract.schema !== 1) findings.push(finding('PLAN_CONTRACT_INVALID', file, 'schema must be the number 1'));
    if (!STAGES.has(contract.artifactStage)) findings.push(finding('PLAN_CONTRACT_INVALID', file, `unknown artifactStage: ${contract.artifactStage}`));
    if (!LAYERS.has(contract.proofLayer)) findings.push(finding('PLAN_CONTRACT_INVALID', file, `unknown proofLayer: ${contract.proofLayer}`));
    if (!BLOCK_SCOPES.has(contract.blockScope)) findings.push(finding('PLAN_CONTRACT_INVALID', file, `unknown blockScope: ${contract.blockScope}`));
    if (!Number.isInteger(contract.remediationBudget) || contract.remediationBudget < 0 || contract.remediationBudget > 2147483647) {
        findings.push(finding('PLAN_CONTRACT_INVALID', file, 'remediationBudget must be an integer from 0 to 2147483647'));
    }
    findings.push(...validateStringArray(contract.requiredCapabilities, 'requiredCapabilities', file));
    findings.push(...validateStringArray(contract.requiredInvariants, 'requiredInvariants', file, {
        nonEmpty: contract.proofLayer === 'A', invariant: true,
    }));
    if (findings.length) return findings;

    if (contract.proofLayer === 'B' && contract.blockScope === 'artifact') {
        findings.push(finding('PROOF_LAYER_BLOCK_SCOPE_INVALID', file, 'Layer B must not block the design artifact'));
    }
    if (contract.proofLayer === 'C' && !['implementation', 'none'].includes(contract.blockScope)) {
        findings.push(finding('PROOF_LAYER_BLOCK_SCOPE_INVALID', file, 'Layer C may block only implementation or none'));
    }
    if (['B', 'C'].includes(contract.proofLayer) && contract.requiredCapabilities.length === 0) {
        findings.push(finding('REQUIRED_CAPABILITY_MISSING', file, `Layer ${contract.proofLayer} requires at least one capability`));
    }
    if (contract.artifactStage === 'design' && !isSpecPath(file)) {
        findings.push(finding('ARTIFACT_STAGE_PATH_MISMATCH', file, 'design artifacts must live under a specs directory'));
    }
    if (['plan', 'spike'].includes(contract.artifactStage) && !isPlanPath(file)) {
        findings.push(finding('ARTIFACT_STAGE_PATH_MISMATCH', file, `${contract.artifactStage} artifacts must live under a plans directory`));
    }
    if (contract.artifactStage === 'spike') {
        const tasks = context.parsedArtifact && Array.isArray(context.parsedArtifact.tasks)
            ? context.parsedArtifact.tasks : [];
        const executable = tasks.some(task =>
            (Array.isArray(task.verify) && task.verify.length > 0)
            || (Array.isArray(task.evidence) && task.evidence.length > 0));
        if (!executable) findings.push(finding('SPIKE_EXECUTION_EVIDENCE_MISSING', file, 'spike artifacts require a task with verify or evidence'));
    }
    return findings;
}

function loadContractLintConfig(projectRoot) {
    const configPath = path.join(projectRoot, '.evo-lite', 'config.json');
    if (!fs.existsSync(configPath)) return { ok: true, config: { required: false, paths: [], requiredInvariants: [] }, findings: [] };
    let root;
    try { root = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (error) {
        return { ok: false, config: null, findings: [finding('CONTRACT_LINT_CONFIG_INVALID', configPath, error.message)] };
    }
    const raw = root && root.planning && root.planning.contractLint;
    if (raw == null) return { ok: true, config: { required: false, paths: [], requiredInvariants: [] }, findings: [] };
    const errors = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        errors.push(finding('CONTRACT_LINT_CONFIG_INVALID', configPath, 'planning.contractLint must be an object'));
    } else {
        const unknown = Object.keys(raw).filter(key => !['required', 'paths', 'requiredInvariants'].includes(key));
        if (unknown.length) errors.push(finding('CONTRACT_LINT_CONFIG_INVALID', configPath, `unknown contractLint key: ${unknown[0]}`));
        if (typeof raw.required !== 'boolean') errors.push(finding('CONTRACT_LINT_CONFIG_INVALID', configPath, 'contractLint.required must be boolean'));
        errors.push(...validateStringArray(raw.paths, 'contractLint.paths', configPath));
        errors.push(...validateStringArray(raw.requiredInvariants, 'contractLint.requiredInvariants', configPath, { invariant: true }));
        if (Array.isArray(raw.paths)) {
            const unsafe = raw.paths.find(pattern => path.isAbsolute(pattern) || pattern.includes('..') || /[^A-Za-z0-9_./*\-]/.test(pattern));
            if (unsafe) errors.push(finding('CONTRACT_LINT_CONFIG_INVALID', configPath, `unsafe contractLint path pattern: ${unsafe}`));
        }
    }
    return errors.length
        ? { ok: false, config: null, findings: errors }
        : { ok: true, config: {
            required: raw.required, paths: raw.paths.slice(), requiredInvariants: raw.requiredInvariants.slice(),
        }, findings: [] };
}

function globToRegExp(pattern) {
    let out = '^';
    for (let i = 0; i < pattern.length; i++) {
        const ch = pattern[i];
        if (ch === '*' && pattern[i + 1] === '*') { out += '.*'; i++; }
        else if (ch === '*') out += '[^/]*';
        else out += ch.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
    return new RegExp(out + '$');
}

function matchesConfiguredPath(filePath, patterns) {
    const normalized = String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
    return patterns.some(pattern => globToRegExp(pattern).test(normalized));
}

function lintGovernedArtifact({ projectRoot, filePath, markdown, parsedArtifact }) {
    const configResult = loadContractLintConfig(projectRoot);
    if (!configResult.ok) return configResult.findings;
    const parsed = parseGovernanceContract(markdown);
    const required = configResult.config.required && matchesConfiguredPath(filePath, configResult.config.paths);
    if (!parsed.present) {
        return required ? [finding('PLAN_CONTRACT_MISSING', filePath, 'Governance Contract is required for this path')] : [];
    }
    if (parsed.error) return [finding('PLAN_CONTRACT_INVALID', filePath, parsed.error)];
    const findings = validateGovernanceContract(parsed.contract, { filePath, parsedArtifact });
    if (findings.length) return findings;
    for (const id of configResult.config.requiredInvariants) {
        if (!parsed.contract.requiredInvariants.includes(id)) {
            findings.push(finding('PLAN_CONTRACT_INVARIANT_MISSING', filePath, `required invariant is missing: ${id}`));
        }
    }
    return findings;
}

module.exports = {
    parseGovernanceContract,
    validateGovernanceContract,
    loadContractLintConfig,
    lintGovernedArtifact,
    matchesConfiguredPath,
};
