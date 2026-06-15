'use strict';

const fs = require('fs');
const path = require('path');
const { parseSpecFile, parsePlanFile } = require('./parse-markdown');

const SCAN_DIRS = {
    specs: ['docs/specs', 'docs/superpowers/specs'],
    plans: ['docs/plans', 'docs/superpowers/plans'],
};

function collectMarkdownFiles(dirs, projectRoot) {
    const files = [];
    for (const dir of dirs) {
        const abs = path.join(projectRoot, dir);
        if (!fs.existsSync(abs)) continue;
        for (const entry of fs.readdirSync(abs)) {
            if (entry.endsWith('.md')) files.push(path.join(abs, entry));
        }
    }
    return files;
}

function scanPlanning(projectRoot) {
    const warnings = [];
    const sources = [];
    const specs = [];
    const plans = [];
    const tasks = [];

    // Specs
    const specFiles = collectMarkdownFiles(SCAN_DIRS.specs, projectRoot);
    if (specFiles.length === 0) {
        warnings.push({ level: 'info', rule: 'R003', message: 'No spec files found in docs/specs/' });
    }
    for (const filePath of specFiles) {
        const relPath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
        sources.push({ type: 'spec', path: relPath });
        try {
            const spec = parseSpecFile(filePath);
            if (spec) {
                spec.sourcePath = relPath;
                specs.push(spec);
            } else {
                warnings.push({ level: 'warning', message: `Skipped ${relPath}: missing id with spec: prefix` });
            }
        } catch (e) {
            warnings.push({ level: 'error', message: `Failed to parse ${relPath}: ${e.message}` });
        }
    }

    // Plans
    const planFiles = collectMarkdownFiles(SCAN_DIRS.plans, projectRoot);
    if (planFiles.length === 0) {
        warnings.push({ level: 'info', rule: 'R004', message: 'No plan files found in docs/plans/' });
    }
    for (const filePath of planFiles) {
        const relPath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
        sources.push({ type: 'plan', path: relPath });
        try {
            const plan = parsePlanFile(filePath);
            if (plan) {
                plan.sourcePath = relPath;
                plans.push({ id: plan.id, title: plan.title, status: plan.status, sourcePath: plan.sourcePath, linkedSpec: plan.linkedSpec, taskIds: plan.taskIds });
                for (const task of plan.tasks) {
                    tasks.push({
                        id: task.id,
                        title: task.title,
                        status: task.status,
                        phase: task.phase,
                        sourcePath: relPath,
                        linkedSpec: plan.linkedSpec || null,
                        linkedPlan: plan.id,
                        linkedFiles: task.linkedFiles || [],
                        verify: task.verify || [],
                        evidence: task.evidence || [],
                        confidence: task.status === 'implemented' ? 1.0 : 0.0,
                    });
                }
            } else {
                warnings.push({ level: 'warning', message: `Skipped ${relPath}: missing id with plan: prefix` });
            }
        } catch (e) {
            warnings.push({ level: 'error', message: `Failed to parse ${relPath}: ${e.message}` });
        }
    }

    return {
        version: 'evo-plan-ir@1',
        generatedAt: new Date().toISOString(),
        project: { name: path.basename(projectRoot), root: '.' },
        sources,
        specs,
        plans,
        tasks,
        warnings,
    };
}

function writePlanIR(ir, projectRoot) {
    const outDir = path.join(projectRoot, '.evo-lite', 'generated', 'planning');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'plan-ir.json');
    fs.writeFileSync(outPath, JSON.stringify(ir, null, 2), 'utf8');
    return outPath;
}

module.exports = { scanPlanning, writePlanIR };
