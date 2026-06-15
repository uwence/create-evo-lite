'use strict';

const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot } = require('./runtime');

function formatIRSummary(ir) {
    const lines = [];
    lines.push(`Planning IR  ${ir.version}  (${ir.specs.length} specs, ${ir.plans.length} plans, ${ir.tasks.length} tasks)`);

    for (const spec of ir.specs) {
        lines.push(`\n  spec  ${spec.id}  [${spec.status}]`);
        lines.push(`        ${spec.sourcePath}`);
        for (const p of spec.linkedPlans) {
            lines.push(`        ↳ ${p}`);
        }
    }

    for (const plan of ir.plans) {
        const doneCount = ir.tasks.filter(t => t.linkedPlan === plan.id && t.status === 'implemented').length;
        const totalCount = ir.tasks.filter(t => t.linkedPlan === plan.id).length;
        lines.push(`\n  plan  ${plan.id}  [${plan.status}]  ${doneCount}/${totalCount} tasks done`);
        lines.push(`        ${plan.sourcePath}`);
    }

    if (ir.warnings.length > 0) {
        lines.push('\nWarnings:');
        for (const w of ir.warnings) {
            lines.push(`  [${w.level || 'warn'}] ${w.message}`);
        }
    }

    return lines.join('\n');
}

function registerPlanCommands(program) {
    const projectRoot = getWorkspaceRoot();
    const plan = program.command('plan').description('Planning IR commands.');

    plan.command('status')
        .description('Show planning status (cached IR or quick scan).')
        .action(async () => {
            const irPath = path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json');
            if (fs.existsSync(irPath)) {
                const ir = JSON.parse(fs.readFileSync(irPath, 'utf8'));
                console.log(formatIRSummary(ir));
                console.log(`\n  cached: ${irPath}`);
                console.log('  refresh: mem plan scan');
            } else {
                console.log('No plan-ir.json found. Running quick scan...\n');
                const { scanPlanning } = require('./planning/scan');
                const ir = scanPlanning(projectRoot);
                console.log(formatIRSummary(ir));
                console.log('\n  save results: mem plan scan');
            }
        });

    plan.command('scan')
        .description('Scan docs/specs/ and docs/plans/, write plan-ir.json.')
        .action(async () => {
            const { scanPlanning, writePlanIR } = require('./planning/scan');
            console.log('Scanning planning documents...\n');
            const ir = scanPlanning(projectRoot);
            const outPath = writePlanIR(ir, projectRoot);
            console.log(formatIRSummary(ir));
            console.log(`\nWritten: ${outPath}`);
        });
}

module.exports = { registerPlanCommands };
