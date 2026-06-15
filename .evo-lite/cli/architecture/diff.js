'use strict';

// Drift engine — architecture scope: R001, R002, R007
// Also provides shared drift report I/O (loadReport / saveReport / mergeFindings)
// used by planning/gaps.js.

const fs = require('fs');
const path = require('path');

// --- Report I/O ---

function driftReportPath(projectRoot) {
    return path.join(projectRoot, '.evo-lite', 'generated', 'architecture', 'drift-report.json');
}

function loadReport(projectRoot) {
    const p = driftReportPath(projectRoot);
    if (!fs.existsSync(p)) return { version: 'evo-drift-report@1', findings: [] };
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch { return { version: 'evo-drift-report@1', findings: [] }; }
}

function saveReport(projectRoot, report) {
    const outDir = path.dirname(driftReportPath(projectRoot));
    fs.mkdirSync(outDir, { recursive: true });
    const findings = report.findings || [];
    const full = {
        version: report.version || 'evo-drift-report@1',
        generatedAt: new Date().toISOString(),
        project: report.project || { name: path.basename(projectRoot), root: '.' },
        findings,
        summary: {
            total: findings.length,
            warnings: findings.filter(f => f.level === 'warning').length,
            info: findings.filter(f => f.level === 'info').length,
            errors: findings.filter(f => f.level === 'error').length,
        },
    };
    fs.writeFileSync(driftReportPath(projectRoot), JSON.stringify(full, null, 2), 'utf8');
    return driftReportPath(projectRoot);
}

function mergeFindings(existingFindings, newFindings, scope) {
    return [
        ...(existingFindings || []).filter(f => f.scope !== scope),
        ...newFindings,
    ];
}

// --- R001 ---

function checkR001(projectRoot) {
    const archPath = path.join(projectRoot, '.agents', 'rules', 'architecture.md');
    if (!fs.existsSync(archPath)) {
        return [{
            id: 'R001',
            rule: 'R001',
            scope: 'architecture',
            level: 'warning',
            type: 'missing-file',
            message: '.agents/rules/architecture.md is missing',
            evidence: [],
            suggestedAction: 'Create .agents/rules/architecture.md with module boundary definitions',
        }];
    }
    return [];
}

// --- R002 ---

const PLACEHOLDER_PATTERNS = [/\bTODO\b/, /\bTBD\b/, /\bplaceholder\b/i, /\bfixme\b/i, /\bXXX\b/];

function checkR002(projectRoot) {
    const archPath = path.join(projectRoot, '.agents', 'rules', 'architecture.md');
    if (!fs.existsSync(archPath)) return [];
    const content = fs.readFileSync(archPath, 'utf8');
    const matches = PLACEHOLDER_PATTERNS.filter(p => p.test(content)).map(p => p.source);
    if (matches.length > 0) {
        return [{
            id: 'R002',
            rule: 'R002',
            scope: 'architecture',
            level: 'warning',
            type: 'placeholder',
            message: '.agents/rules/architecture.md contains placeholder text',
            evidence: matches,
            suggestedAction: 'Replace placeholder text with real module definitions',
        }];
    }
    return [];
}

// --- R007 ---

function checkR007(projectRoot, architectureIR) {
    const modulesDocPath = path.join(projectRoot, 'docs', 'architecture', 'modules.md');
    if (!fs.existsSync(modulesDocPath)) {
        return [{
            id: 'R007',
            rule: 'R007',
            scope: 'architecture',
            level: 'info',
            type: 'unknown-module',
            message: 'docs/architecture/modules.md not found — module boundaries not formally documented',
            evidence: architectureIR ? architectureIR.modules.map(m => m.id) : [],
            suggestedAction: 'Create docs/architecture/modules.md listing canonical module boundaries',
        }];
    }
    return [];
}

// --- Public ---

function runArchitectureDrift(projectRoot, architectureIR) {
    return [
        ...checkR001(projectRoot),
        ...checkR002(projectRoot),
        ...checkR007(projectRoot, architectureIR),
    ];
}

module.exports = { runArchitectureDrift, loadReport, saveReport, mergeFindings };
