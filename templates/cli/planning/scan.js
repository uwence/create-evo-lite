'use strict';

const fs = require('fs');
const path = require('path');
const { parseSpecFile, parsePlanFile, parseFrontmatter } = require('./parse-markdown');
const { getEvoConfig } = require('../runtime');
const { validateProvider } = require('../architecture/provider-contract');

const SCAN_DIRS = {
    specs: ['docs/specs', 'docs/superpowers/specs'],
    plans: ['docs/plans', 'docs/superpowers/plans'],
};

function loadPlanningProviders(projectRoot, warnings) {
    const config = getEvoConfig();
    const providerPaths = Array.isArray(config.providers) ? config.providers : [];
    const loaded = [];

    for (const relPath of providerPaths) {
        let provider;
        try {
            provider = require(path.resolve(projectRoot, relPath));
        } catch (e) {
            warnings.push({ level: 'warning', rule: 'P001', message: `Planning provider load failed (${relPath}): ${e.message}` });
            continue;
        }

        const v = validateProvider(provider);
        if (!v.valid) {
            warnings.push({ level: 'warning', rule: 'P001', message: `Provider at ${relPath} invalid contract: ${v.error}` });
            continue;
        }

        if (typeof provider.scanPlanning !== 'function') continue;

        let available = false;
        try { available = provider.check(); } catch (_) {}
        if (!available) {
            warnings.push({ level: 'info', rule: 'P002', message: `Provider ${provider.id} not available (check() false)` });
            continue;
        }

        loaded.push(provider);
    }

    return loaded;
}

function mergePlanningProviderResult(ir, enriched, warnings) {
    if (!enriched || !Array.isArray(enriched.tasks)) return;
    const taskMap = new Map(ir.tasks.map(t => [t.id, t]));
    for (const et of enriched.tasks) {
        if (taskMap.has(et.id)) {
            taskMap.set(et.id, Object.assign({}, taskMap.get(et.id), et));
        }
    }
    ir.tasks = Array.from(taskMap.values());
}

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

function diagnosePlanParseFailure(content) {
    const reasons = [];
    const fixes = [];
    const { frontmatter } = parseFrontmatter(content);

    if (!frontmatter.id) {
        reasons.push('no id: plan:* frontmatter');
        fixes.push('add id: plan:<slug>');
    } else if (!frontmatter.id.startsWith('plan:')) {
        reasons.push(`invalid id "${frontmatter.id}" (expected plan:*)`);
        fixes.push('rename id to plan:<slug>');
    }

    if (/^##\s+Task\s+\d+:/m.test(content) && !/^###\s+Task\s+\d+:/m.test(content)) {
        reasons.push('found "## Task N:" but expected "### Task N:"');
        fixes.push('use ### Task N: headings');
    }

    if (/^-\s+\[[xX ]\]\s+\*\*Step/m.test(content) && !/^###\s+Task\s+\d+:/m.test(content)) {
        reasons.push('found Step checkboxes but no valid "### Task N:" heading');
        fixes.push('add a Task heading before Step checkboxes');
    }

    if (frontmatter.linkedSpec && (!frontmatter.id || !frontmatter.id.startsWith('plan:'))) {
        reasons.push('has linkedSpec but no valid plan id');
    }

    if (reasons.length === 0) {
        reasons.push('missing id with plan: prefix');
        fixes.push('add id: plan:<slug>');
    }

    return `Skipped plan file. Reason: ${reasons.join('; ')}. Fix: ${fixes.join('; ')}`;
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
            const content = fs.readFileSync(filePath, 'utf8');
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
                        readOnly: task.readOnly || false,
                        confidence: task.status === 'implemented' ? 1.0 : 0.0,
                    });
                }
            } else {
                warnings.push({ level: 'warning', message: `Skipped ${relPath}: ${diagnosePlanParseFailure(content)}` });
            }
        } catch (e) {
            warnings.push({ level: 'error', message: `Failed to parse ${relPath}: ${e.message}` });
        }
    }

    // Cross-validate spec↔plan links
    const planIdSet = new Set(plans.map(p => p.id));
    const specIdSet = new Set(specs.map(s => s.id));
    for (const spec of specs) {
        for (const linkedPlanId of (spec.linkedPlans || [])) {
            if (!planIdSet.has(linkedPlanId)) {
                warnings.push({ level: 'warning', message: `spec ${spec.id} references ${linkedPlanId} but no such plan found` });
            }
        }
    }
    for (const plan of plans) {
        if (plan.linkedSpec && !specIdSet.has(plan.linkedSpec)) {
            warnings.push({ level: 'warning', message: `plan ${plan.id} references ${plan.linkedSpec} but no such spec found` });
        }
    }

    const ir = {
        version: 'evo-plan-ir@1',
        generatedAt: new Date().toISOString(),
        project: { name: path.basename(projectRoot), root: '.' },
        sources,
        specs,
        plans,
        tasks,
        warnings,
    };

    // Apply optional planning providers declared in .evo-lite/config.json
    const planningProviders = loadPlanningProviders(projectRoot, ir.warnings);
    for (const provider of planningProviders) {
        try {
            const enriched = provider.scanPlanning(projectRoot, ir);
            mergePlanningProviderResult(ir, enriched, ir.warnings);
        } catch (e) {
            ir.warnings.push({ level: 'warning', rule: 'P003', message: `Provider ${provider.id} scanPlanning() threw: ${e.message}` });
        }
    }

    return ir;
}

function writePlanIR(ir, projectRoot) {
    const outDir = path.join(projectRoot, '.evo-lite', 'generated', 'planning');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'plan-ir.json');
    fs.writeFileSync(outPath, JSON.stringify(ir, null, 2), 'utf8');
    return outPath;
}

module.exports = { scanPlanning, writePlanIR };
