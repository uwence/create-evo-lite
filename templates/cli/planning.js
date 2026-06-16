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

    plan.command('gaps')
        .description('Run planning drift checks (R003–R011), write drift-report.json.')
        .option('--last-commit', 'Evaluate changed files from the last commit instead of the working tree.')
        .option('--changed-files-from-env', 'Read changed files from EVO_LITE_CHANGED_FILES before falling back to git.')
        .action(async (options) => {
            const { runPlanningDrift } = require('./planning/gaps');
            const { loadReport, saveReport, mergeFindings } = require('./architecture/diff');
            const irPath = path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json');
            const planIR = fs.existsSync(irPath) ? JSON.parse(fs.readFileSync(irPath, 'utf8')) : null;
            if (!planIR) console.log('No plan-ir.json found. Run: mem plan scan first.\n');

            console.log('Running planning drift checks...\n');
            const newFindings = runPlanningDrift(projectRoot, planIR, {
                lastCommit: !!options.lastCommit,
                changedFilesFromEnv: !!options.changedFilesFromEnv,
            });

            const existing = loadReport(projectRoot);
            existing.findings = mergeFindings(existing.findings, newFindings, 'planning');
            existing.project = { name: path.basename(projectRoot), root: '.' };
            const outPath = saveReport(projectRoot, existing);

            if (newFindings.length === 0) {
                console.log('No planning drift findings.');
            } else {
                for (const f of newFindings) {
                    console.log(`[${f.level}] ${f.rule}: ${f.message}`);
                    if (f.suggestedAction) console.log(`  → ${f.suggestedAction}`);
                }
            }
            console.log(`\nWritten: ${outPath}`);
        });

    plan.command('progress')
        .description('Evaluate task evidence (git refs, files, archive), write progress-report.json.')
        .action(async () => {
            const irPath = path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json');
            if (!fs.existsSync(irPath)) {
                console.error('No plan-ir.json found. Run: mem plan scan first.');
                process.exit(1);
            }
            const { evaluateProgress, writeProgressReport } = require('./planning/progress');
            console.log('Evaluating task evidence...\n');
            const report = evaluateProgress(projectRoot);
            if (!report) {
                console.error('Failed to evaluate progress: plan-ir.json may be corrupt. Run: mem plan scan first.');
                process.exit(1);
            }
            const outPath = writeProgressReport(report, projectRoot);
            const s = report.summary;
            console.log(`  total: ${s.total}  verified: ${s.verified}  implemented: ${s.implemented}  in_progress: ${s.in_progress}  todo: ${s.todo}`);
            console.log(`\nWritten: ${outPath}`);
        });
    plan.command('trace')
        .description('Build traceability matrix (spec→plan→task→file), write traceability.json.')
        .action(async () => {
            const irPath = path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json');
            if (!fs.existsSync(irPath)) {
                console.error('No plan-ir.json found. Run: mem plan scan first.');
                process.exit(1);
            }
            const { buildTraceability, writeTraceability } = require('./planning/traceability');
            console.log('Building traceability matrix...\n');
            const report = buildTraceability(projectRoot);
            if (!report) {
                console.error('Failed to build traceability. Run: mem plan scan first.');
                process.exit(1);
            }
            const outPath = writeTraceability(report, projectRoot);
            const s = report.summary;
            console.log(`  specs: ${s.specCount}  plans: ${s.planCount}  tasks: ${s.taskCount}`);
            console.log(`  chains: ${s.chainCount}  unlinked tasks: ${s.unlinkedTaskCount}`);
            console.log(`  tasks with files: ${s.tasksWithFiles}  tasks with evidence: ${s.tasksWithEvidence}`);
            console.log(`\nWritten: ${outPath}`);
        });

    plan.command('lint')
        .description('Check plan files for missing frontmatter / linkedSpec.')
        .option('--fix', 'Auto-inject minimal frontmatter into plans that have none.')
        .action(async (options) => {
            const { lintPlans } = require('./planning/lint');
            const results = lintPlans(projectRoot, !!options.fix);
            if (results.issues.length === 0) {
                console.log('All plan files have valid frontmatter.');
            } else {
                for (const issue of results.issues) {
                    console.log(`[${issue.level}] ${issue.file}: ${issue.message}`);
                }
            }
            if (options.fix && results.fixed > 0) {
                console.log(`\nFixed: ${results.fixed} file(s) — frontmatter injected.`);
            }
            const remaining = options.fix ? results.issues.length - results.fixed : results.issues.length;
            process.exitCode = remaining > 0 ? 1 : 0;
        });
}

module.exports = { registerPlanCommands };
