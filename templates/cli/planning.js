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
                // Not-applicable, not a failure: a project with no docs/plans/ has no IR.
                // The post-commit hook runs `plan progress` unconditionally, so exiting 1
                // here recorded ok:false and surfaced as verify last_run=failed-last-run on
                // every fresh scaffold. Degrade to a no-op (and write NO report — never
                // fabricate evidence for plans that do not exist). Mirrors `plan gaps`.
                console.log('No plan-ir.json found — no plans to evaluate yet. Run: mem plan scan first.');
                return;
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

    plan.command('new <slug>')
        .description('Scaffold a spec + plan stub under docs/superpowers/. Use this when /evo says "no active plan but in-flight edits".')
        .option('--from-diff', 'Prefill the Linked Files block from `git status --porcelain` so R006 stops firing on the in-flight edits.')
        .action((slug, options) => {
            const result = scaffoldPlanStubs(projectRoot, slug, !!options.fromDiff);
            console.log(`Spec stub: ${result.specPath}`);
            console.log(`Plan stub: ${result.planPath}`);
            if (result.linkedFiles.length > 0) {
                console.log(`Linked ${result.linkedFiles.length} file(s) from current diff.`);
            }
            console.log('Next: edit the stubs, fill task steps, then `mem plan scan` to register.');
        });

    plan.command('archive-evidence')
        .description('Scan .evo-lite/raw_memory/ and link archives to tasks by id heuristic. Writes archive-evidence.json consumed by plan scan.')
        .option('--backfill', 'Generate the evidence map (default behavior; flag kept for clarity).')
        .option('--json', 'Emit JSON output.')
        .action(options => {
            const { backfillArchiveEvidence } = require('./planning/backfill-evidence');
            const result = backfillArchiveEvidence(projectRoot);
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
                return;
            }
            const taskCount = Object.keys(result.taskIdToArchives).length;
            console.log(`Scanned ${result.archivesScanned} archive(s).`);
            console.log(`Matched ${result.archivesMatched} archive(s) to ${taskCount} unique task id(s).`);
            if (result.outPath) {
                console.log(`Written: ${path.relative(projectRoot, result.outPath).replace(/\\/g, '/')}`);
                console.log('Re-run `mem plan scan` to merge archive evidence into the planning IR.');
            }
        });
}

function scaffoldPlanStubs(projectRoot, slug, fromDiff) {
    const normalizedSlug = String(slug || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!normalizedSlug) {
        throw new Error('plan new requires a slug like `kebab-case-name`.');
    }
    const date = new Date().toISOString().split('T')[0];
    const specDir = path.join(projectRoot, 'docs', 'superpowers', 'specs');
    const planDir = path.join(projectRoot, 'docs', 'superpowers', 'plans');
    fs.mkdirSync(specDir, { recursive: true });
    fs.mkdirSync(planDir, { recursive: true });

    let linkedFiles = [];
    if (fromDiff) {
        try {
            const porcelain = require('child_process').execFileSync('git', ['status', '--porcelain'], {
                cwd: projectRoot, encoding: 'utf8', timeout: 5000,
            });
            linkedFiles = String(porcelain).split(/\r?\n/)
                .map(line => line.slice(3).trim())
                .filter(Boolean)
                .filter(file => !file.startsWith('.evo-lite/generated/'));
        } catch (_) {
            linkedFiles = [];
        }
    }

    const specPath = path.join(specDir, `${date}-${normalizedSlug}.md`);
    const planPath = path.join(planDir, `${date}-${normalizedSlug}.md`);

    if (!fs.existsSync(specPath)) {
        const specBody = `---\nid: spec:${normalizedSlug}\nstatus: draft\ncreated: ${date}\nlinkedPlan: plan:${normalizedSlug}\n---\n\n# ${normalizedSlug} — Spec\n\n## Problem\n\nTODO\n\n## Goal\n\nTODO\n\n## Requirements\n\n### R1\n\nTODO\n\n## Verification\n\nTODO\n`;
        fs.writeFileSync(specPath, specBody);
    }

    if (!fs.existsSync(planPath)) {
        const filesBlock = linkedFiles.length > 0
            ? `\n**Files:**\n${linkedFiles.map(f => `- Modify: \`${f}\``).join('\n')}\n`
            : '\n**Files:**\n- Modify: `TODO`\n';
        const planBody = `---\nid: plan:${normalizedSlug}\nlinkedSpec: spec:${normalizedSlug}\nformat: superpowers\nstatus: draft\n---\n\n# ${normalizedSlug} — Implementation Plan\n\n### Task 1: TODO\n${filesBlock}\n- [ ] **Step 1:** TODO\n`;
        fs.writeFileSync(planPath, planBody);
    }

    return {
        specPath: path.relative(projectRoot, specPath).replace(/\\/g, '/'),
        planPath: path.relative(projectRoot, planPath).replace(/\\/g, '/'),
        linkedFiles,
    };
}

module.exports = { registerPlanCommands, scaffoldPlanStubs };
