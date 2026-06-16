'use strict';

const fs = require('fs');
const path = require('path');

function buildTraceability(projectRoot) {
    const irPath = path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json');
    if (!fs.existsSync(irPath)) return null;

    const planIR = JSON.parse(fs.readFileSync(irPath, 'utf8'));

    // Build spec → plan → task → file chains
    const chains = [];
    for (const spec of planIR.specs) {
        for (const planId of spec.linkedPlans) {
            const planTasks = planIR.tasks.filter(t => t.linkedPlan === planId);
            for (const task of planTasks) {
                chains.push({
                    spec: spec.id,
                    plan: planId,
                    task: task.id,
                    taskTitle: task.title,
                    taskStatus: task.status,
                    linkedFiles: task.linkedFiles || [],
                    evidence: task.evidence || [],
                });
            }
        }
    }

    // Tasks with no spec chain (plan not linked to any spec, or spec has no linkedPlans entry)
    const linkedTaskIds = new Set(chains.map(c => c.task));
    const unlinkedTasks = planIR.tasks
        .filter(t => !linkedTaskIds.has(t.id))
        .map(t => ({
            task: t.id,
            title: t.title,
            status: t.status,
            plan: t.linkedPlan || null,
            linkedFiles: t.linkedFiles || [],
        }));

    const tasksWithFiles = chains.filter(c => c.linkedFiles.length > 0).length;
    const tasksWithEvidence = chains.filter(c => c.evidence.length > 0).length;

    return {
        version: 'evo-trace@1',
        generatedAt: new Date().toISOString(),
        planIrPath: path.relative(projectRoot, irPath).replace(/\\/g, '/'),
        summary: {
            specCount: planIR.specs.length,
            planCount: planIR.plans.length,
            taskCount: planIR.tasks.length,
            chainCount: chains.length,
            unlinkedTaskCount: unlinkedTasks.length,
            tasksWithFiles,
            tasksWithEvidence,
        },
        chains,
        unlinkedTasks,
    };
}

function writeTraceability(report, projectRoot) {
    const outDir = path.join(projectRoot, '.evo-lite', 'generated', 'planning');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'traceability.json');
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    return outPath;
}

module.exports = { buildTraceability, writeTraceability };
