'use strict';

const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot } = require('./runtime');

function readJson(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { return null; }
}

function buildDashboardData(projectRoot) {
    const genDir = path.join(projectRoot, '.evo-lite', 'generated');
    const planIR = readJson(path.join(genDir, 'planning', 'plan-ir.json'));
    const progressReport = readJson(path.join(genDir, 'planning', 'progress-report.json'));
    const archIR = readJson(path.join(genDir, 'architecture', 'architecture-ir.json'));
    const driftReport = readJson(path.join(genDir, 'architecture', 'drift-report.json'));

    const planning = planIR ? {
        version: planIR.version,
        specs: planIR.specs,
        plans: planIR.plans,
        tasks: planIR.tasks,
        warnings: planIR.warnings,
        summary: {
            specs: planIR.specs.length,
            plans: planIR.plans.length,
            tasks: planIR.tasks.length,
            implemented: planIR.tasks.filter(t => t.status === 'implemented').length,
        },
        progress: progressReport ? { summary: progressReport.summary, byPlan: progressReport.byPlan } : null,
    } : { missing: true, hint: 'Run: mem plan scan' };

    const architecture = archIR ? {
        version: archIR.version,
        provider: archIR.provider,
        modules: archIR.modules,
        files: archIR.files,
        warnings: archIR.warnings,
        summary: {
            modules: archIR.modules.length,
            files: archIR.files.length,
        },
    } : { missing: true, hint: 'Run: mem architecture scan' };

    const drift = driftReport ? {
        version: driftReport.version,
        findings: driftReport.findings,
        summary: driftReport.summary,
    } : { missing: true, hint: 'Run: mem architecture diff && mem plan gaps' };

    return {
        version: 'evo-dashboard@1',
        generatedAt: new Date().toISOString(),
        project: { name: path.basename(projectRoot), root: '.' },
        planning,
        architecture,
        drift,
    };
}

function writeDashboardData(data, projectRoot) {
    const outDir = path.join(projectRoot, '.evo-lite', 'generated', 'dashboard');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'dashboard-data.json');
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8');
    return outPath;
}

function registerDashboardCommands(program) {
    const projectRoot = getWorkspaceRoot();
    const dash = program.command('dashboard').description('Dashboard data commands.');

    dash.command('build')
        .description('Aggregate plan-ir, architecture-ir, and drift-report into dashboard-data.json.')
        .action(async () => {
            console.log('Building dashboard data...\n');
            const data = buildDashboardData(projectRoot);
            const outPath = writeDashboardData(data, projectRoot);

            const p = data.planning;
            const a = data.architecture;
            const d = data.drift;

            if (!p.missing) {
                console.log(`  planning:     ${p.summary.implemented}/${p.summary.tasks} tasks done  (${p.summary.specs} specs, ${p.summary.plans} plans)`);
            } else {
                console.log(`  planning:     ${p.hint}`);
            }
            if (!a.missing) {
                console.log(`  architecture: ${a.summary.modules} modules, ${a.summary.files} files`);
            } else {
                console.log(`  architecture: ${a.hint}`);
            }
            if (!d.missing && d.summary) {
                console.log(`  drift:        ${d.summary.total} findings (${d.summary.warnings} warnings, ${d.summary.errors} errors, ${d.summary.info} info)`);
            } else if (!d.missing) {
                console.log(`  drift:        (summary unavailable)`);
            } else {
                console.log(`  drift:        ${d.hint}`);
            }

            console.log(`\nWritten: ${outPath}`);
        });
}

module.exports = { buildDashboardData, writeDashboardData, registerDashboardCommands };
