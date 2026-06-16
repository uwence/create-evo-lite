'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { getWorkspaceRoot } = require('./runtime');
const { PLAN_SOURCE_PATHS, ARCH_SOURCE_PATHS } = require('./planning/gaps');

function readJson(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { return null; }
}

function hasManagedPostCommitHook(projectRoot) {
    const hookPath = path.join(projectRoot, '.git', 'hooks', 'post-commit');
    if (!fs.existsSync(hookPath)) return false;
    try {
        return fs.readFileSync(hookPath, 'utf8').includes('# BEGIN evo-lite-hook');
    } catch {
        return false;
    }
}

function computeFreshness(projectRoot) {
    const genDir = path.join(projectRoot, '.evo-lite', 'generated');
    const planIrPath = path.join(genDir, 'planning', 'plan-ir.json');
    const archIrPath = path.join(genDir, 'architecture', 'architecture-ir.json');
    const nowMs = Date.now();

    function ageSecs(p) {
        if (!fs.existsSync(p)) return null;
        return Math.round((nowMs - fs.statSync(p).mtimeMs) / 1000);
    }

    function newestSourceMtime(sourcePaths) {
        let newest = null;

        function visit(absPath) {
            if (!fs.existsSync(absPath)) return;
            const stat = fs.statSync(absPath);
            if (stat.isFile()) {
                newest = newest === null ? stat.mtimeMs : Math.max(newest, stat.mtimeMs);
                return;
            }
            for (const entry of fs.readdirSync(absPath, { withFileTypes: true })) {
                visit(path.join(absPath, entry.name));
            }
        }

        for (const relPath of sourcePaths) {
            visit(path.resolve(projectRoot, relPath));
        }
        return newest;
    }

    let lastCommitAge = null;
    try {
        const ts = execFileSync('git', ['log', '-1', '--format=%ct'], {
            cwd: projectRoot, encoding: 'utf8', timeout: 3000,
        }).trim();
        if (ts) lastCommitAge = Math.round((nowMs - parseInt(ts, 10) * 1000) / 1000);
    } catch (_) {}

    const planIrAge = ageSecs(planIrPath);
    const archIrAge = ageSecs(archIrPath);
    const planSourceMtime = newestSourceMtime(PLAN_SOURCE_PATHS);
    const archSourceMtime = newestSourceMtime(ARCH_SOURCE_PATHS);
    const planIrMtime = fs.existsSync(planIrPath) ? fs.statSync(planIrPath).mtimeMs : null;
    const archIrMtime = fs.existsSync(archIrPath) ? fs.statSync(archIrPath).mtimeMs : null;

    return {
        planIrAge,
        archIrAge,
        lastCommitAge,
        planStale: planIrMtime !== null && planSourceMtime !== null && planSourceMtime > planIrMtime,
        archStale: archIrMtime !== null && archSourceMtime !== null && archSourceMtime > archIrMtime,
    };
}

function buildGovernanceSummary(projectRoot, freshness) {
    const reportPath = path.join(projectRoot, '.evo-lite', 'generated', 'governance', 'post-commit-last-run.json');
    const governance = {
        status: 'missing',
        hookInstalled: hasManagedPostCommitHook(projectRoot),
        stale: Boolean(freshness && (freshness.planStale || freshness.archStale)),
        reportPath,
        lastRun: {
            exists: false,
            ok: null,
            commit: null,
            changedFiles: [],
            categories: [],
            commandCount: 0,
            failedCommands: [],
        },
    };

    if (!fs.existsSync(reportPath)) {
        return governance;
    }

    try {
        const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        const commands = Array.isArray(report.commands) ? report.commands : [];
        const failedCommands = commands
            .filter(command => command && command.ok === false)
            .map(command => command.name || 'unknown');
        const ok = failedCommands.length === 0;

        return {
            ...governance,
            status: ok ? 'healthy' : 'failed-last-run',
            lastRun: {
                exists: true,
                ok,
                commit: report.commit || null,
                changedFiles: Array.isArray(report.changedFiles) ? report.changedFiles : [],
                categories: Array.isArray(report.categories) ? report.categories : [],
                commandCount: commands.length,
                failedCommands,
            },
        };
    } catch (error) {
        return {
            ...governance,
            status: 'error',
            error: error.message,
            lastRun: {
                ...governance.lastRun,
                exists: true,
            },
        };
    }
}

function buildDashboardData(projectRoot) {
    const genDir = path.join(projectRoot, '.evo-lite', 'generated');
    const planIR = readJson(path.join(genDir, 'planning', 'plan-ir.json'));
    const progressReport = readJson(path.join(genDir, 'planning', 'progress-report.json'));
    const archIR = readJson(path.join(genDir, 'architecture', 'architecture-ir.json'));
    const driftReport = readJson(path.join(genDir, 'architecture', 'drift-report.json'));

    const progressMap = progressReport
        ? new Map(progressReport.tasks.map(t => [t.id, t]))
        : new Map();

    const enrichedTasks = planIR ? planIR.tasks.map(t => {
        const pr = progressMap.get(t.id);
        return pr ? { ...t, derivedStatus: pr.derivedStatus, confidence: pr.confidence } : t;
    }) : [];

    const planning = planIR ? {
        version: planIR.version,
        specs: planIR.specs,
        plans: planIR.plans,
        tasks: enrichedTasks,
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

    // memory: quick snapshot from raw_memory/ and active_context.md
    const rawMemDir = path.join(projectRoot, '.evo-lite', 'raw_memory');
    const archiveFiles = fs.existsSync(rawMemDir)
        ? fs.readdirSync(rawMemDir).filter(f => f.endsWith('.md')).length
        : 0;

    function extractSection(text, marker) {
        const m = text.match(new RegExp(`<!-- BEGIN_${marker} -->([\\s\\S]*?)<!-- END_${marker} -->`));
        return m ? m[1].trim() : '';
    }

    const ctxPath = path.join(projectRoot, '.evo-lite', 'active_context.md');
    const ctxText = fs.existsSync(ctxPath) ? fs.readFileSync(ctxPath, 'utf8') : '';
    const memory = {
        archiveFiles,
        activeContextFocus: extractSection(ctxText, 'FOCUS'),
        activeContextTrajectory: extractSection(ctxText, 'TRAJECTORY'),
    };

    // verify: lightweight summary from already-loaded IR (no extra scans)
    const r009 = driftReport ? (driftReport.findings || []).filter(f => f.rule === 'R009') : [];
    const verify = {
        planScan: planIR ? {
            exists: true,
            taskCount: planIR.tasks.length,
            implemented: planIR.tasks.filter(t => t.status === 'implemented').length,
        } : { exists: false },
        architectureScan: archIR ? {
            exists: true,
            moduleCount: archIR.modules.length,
        } : { exists: false },
        drift: driftReport ? driftReport.summary : null,
        generatedDataFresh: r009.length === 0,
    };

    const freshness = computeFreshness(projectRoot);

    return {
        version: 'evo-dashboard@1',
        generatedAt: new Date().toISOString(),
        project: { name: path.basename(projectRoot), root: '.' },
        planning,
        architecture,
        drift,
        memory,
        verify,
        freshness,
        governance: buildGovernanceSummary(projectRoot, freshness),
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
