'use strict';

// Drift engine — planning scope: R003-R006, R008-R010

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// --- R003 ---

function checkR003(projectRoot) {
    const dirs = ['docs/specs', 'docs/superpowers/specs'];
    const hasSpecs = dirs.some(d => {
        const abs = path.join(projectRoot, d);
        return fs.existsSync(abs) && fs.readdirSync(abs).some(f => f.endsWith('.md'));
    });
    if (hasSpecs) return [];
    return [{
        id: 'R003', rule: 'R003', scope: 'planning', level: 'info',
        type: 'no-specs',
        message: 'No spec files found in docs/specs/ or docs/superpowers/specs/',
        evidence: [],
        suggestedAction: 'Create a spec file in docs/specs/ with id: spec:<slug> frontmatter',
    }];
}

// --- R004 ---

function checkR004(projectRoot) {
    const dirs = ['docs/plans', 'docs/superpowers/plans'];
    const hasPlans = dirs.some(d => {
        const abs = path.join(projectRoot, d);
        return fs.existsSync(abs) && fs.readdirSync(abs).some(f => f.endsWith('.md'));
    });
    if (hasPlans) return [];
    return [{
        id: 'R004', rule: 'R004', scope: 'planning', level: 'info',
        type: 'no-plans',
        message: 'No plan files found in docs/plans/ or docs/superpowers/plans/',
        evidence: [],
        suggestedAction: 'Create a plan file in docs/plans/ with id: plan:<slug> frontmatter',
    }];
}

// --- R005 ---

function checkR005(planIR) {
    if (!planIR) return [];
    return (planIR.tasks || [])
        .filter(t => !t.readOnly && t.status !== 'planning-only' && (!t.linkedFiles || t.linkedFiles.length === 0))
        .map(t => ({
            id: `R005:${t.id}`, rule: 'R005', scope: 'planning', level: 'warning',
            type: 'no-linked-files',
            message: `Task ${t.id} has no linkedFiles`,
            evidence: [t.sourcePath],
            suggestedAction: `Add "- files: <path>" to task ${t.id} in ${t.sourcePath}`,
        }));
}

// --- R006 ---

function checkR006(projectRoot, planIR) {
    if (!planIR) return [];
    let changedFiles;
    try {
        const out = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
            cwd: projectRoot, encoding: 'utf8', timeout: 5000,
        }).trim();
        changedFiles = out ? out.split('\n').filter(Boolean) : [];
    } catch {
        return [];
    }
    if (changedFiles.length === 0) return [];

    const linkedFiles = new Set((planIR.tasks || []).flatMap(t => t.linkedFiles || []));
    return changedFiles
        .filter(f => !linkedFiles.has(f))
        .map(f => ({
            id: `R006:${f}`, rule: 'R006', scope: 'planning', level: 'warning',
            type: 'unlinked-file',
            message: `Changed file not linked to any task: ${f}`,
            evidence: [f],
            suggestedAction: `Link ${f} to a task in docs/plans/ or create a new task`,
        }));
}

// --- R008 ---

function checkR008(planIR) {
    if (!planIR) return [];
    return (planIR.tasks || [])
        .filter(t => !t.readOnly &&
            t.status === 'implemented' &&
            (!t.evidence || t.evidence.length === 0) &&
            (!t.linkedFiles || t.linkedFiles.length === 0))
        .map(t => ({
            id: `R008:${t.id}`, rule: 'R008', scope: 'planning', level: 'warning',
            type: 'no-evidence',
            message: `Task ${t.id} is implemented but has no archive evidence`,
            evidence: [t.sourcePath],
            suggestedAction: `Run mem archive after completing ${t.id} to record evidence`,
        }));
}

// --- R009 ---

function checkR009(projectRoot) {
    const findings = [];

    function check(irPath, sourceDirs, label) {
        if (!fs.existsSync(irPath)) return;
        const irMtime = fs.statSync(irPath).mtimeMs;
        for (const dir of sourceDirs) {
            const abs = path.join(projectRoot, dir);
            if (!fs.existsSync(abs)) continue;
            for (const entry of fs.readdirSync(abs)) {
                const filePath = path.join(abs, entry);
                if (fs.statSync(filePath).isFile() && fs.statSync(filePath).mtimeMs > irMtime) {
                    findings.push({
                        id: `R009:${label}`, rule: 'R009', scope: 'planning', level: 'info',
                        type: 'stale-ir',
                        message: `${label} IR is stale — ${path.relative(projectRoot, filePath).replace(/\\/g, '/')} is newer`,
                        evidence: [path.relative(projectRoot, irPath).replace(/\\/g, '/')],
                        suggestedAction: label === 'plan' ? 'Run: mem plan scan' : 'Run: mem architecture scan',
                    });
                    return;
                }
            }
        }
    }

    check(
        path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json'),
        ['docs/specs', 'docs/plans'],
        'plan'
    );
    check(
        path.join(projectRoot, '.evo-lite', 'generated', 'architecture', 'architecture-ir.json'),
        ['templates/cli'],
        'architecture'
    );
    return findings;
}

// --- R010 ---

function checkR010(projectRoot, planIR) {
    if (!planIR) return [];
    const ctxPath = path.join(projectRoot, '.evo-lite', 'active_context.md');
    if (!fs.existsSync(ctxPath)) return [];

    const content = fs.readFileSync(ctxPath, 'utf8');
    const section = content.match(/<!-- BEGIN_BACKLOG -->([\s\S]*?)<!-- END_BACKLOG -->/);
    if (!section) return [];

    const backlogItems = section[1].split('\n')
        .map(l => l.trim()).filter(l => l.startsWith('-'))
        .map(l => l.replace(/^-\s*/, '').toLowerCase());
    if (backlogItems.length === 0) return [];

    const taskTitles = (planIR.tasks || []).map(t => t.title.toLowerCase());
    const taskIds = (planIR.tasks || []).map(t => t.id.toLowerCase());

    return backlogItems
        .filter(item => {
            return !taskTitles.some(t => item.includes(t) || t.includes(item)) &&
                   !taskIds.some(id => item.includes(id));
        })
        .map(item => ({
            id: `R010:${item.slice(0, 40)}`, rule: 'R010', scope: 'planning', level: 'info',
            type: 'untracked-backlog',
            message: `Backlog item not in Planning IR: "${item.slice(0, 80)}"`,
            evidence: ['.evo-lite/active_context.md'],
            suggestedAction: 'Add a task to docs/plans/ that covers this backlog item',
        }));
}

// --- R011 ---

function checkR011(planIR) {
    if (!planIR) return [];
    const specMap = new Map((planIR.specs || []).map(s => [s.id, s]));
    const findings = [];

    for (const plan of (planIR.plans || [])) {
        if (!plan.linkedSpec) continue;
        const spec = specMap.get(plan.linkedSpec);
        if (!spec || spec.status === 'done') continue;

        const planTasks = (planIR.tasks || []).filter(t => t.linkedPlan === plan.id);
        if (planTasks.length === 0) continue;
        if (!planTasks.every(t => t.readOnly || t.status === 'implemented')) continue;

        findings.push({
            id: `R011:${spec.id}`,
            rule: 'R011',
            scope: 'planning',
            level: 'warning',
            type: 'spec-status-drift',
            message: `Spec ${spec.id} is [${spec.status}] but linked plan ${plan.id} has all tasks implemented`,
            evidence: [spec.sourcePath],
            suggestedAction: `Update status in ${spec.sourcePath} to: status: done`,
        });
    }
    return findings;
}

// --- Public ---

function runPlanningDrift(projectRoot, planIR) {
    return [
        ...checkR003(projectRoot),
        ...checkR004(projectRoot),
        ...checkR005(planIR),
        ...checkR006(projectRoot, planIR),
        ...checkR008(planIR),
        ...checkR009(projectRoot),
        ...checkR010(projectRoot, planIR),
        ...checkR011(planIR),
    ];
}

module.exports = { runPlanningDrift };
