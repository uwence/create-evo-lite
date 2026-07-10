'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseSpecFile, parseFrontmatter } = require('./planning/parse-markdown');

const SIZE_THRESHOLDS = Object.freeze({ acCount: 8, phaseCount: 3, dependsOnCount: 12, chars: 40000 });
const DEFAULT_AGING_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function readJsonSafe(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return null;
    }
}

function loadAgingDays(projectRoot) {
    const config = readJsonSafe(path.join(projectRoot, '.evo-lite', 'config.json'));
    const days = config && config.specPortfolio && config.specPortfolio.agingDays;
    return typeof days === 'number' && days > 0 ? days : DEFAULT_AGING_DAYS;
}

function loadPlanIR(projectRoot) {
    const ir = readJsonSafe(path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json'));
    if (!ir || !Array.isArray(ir.plans)) return { plans: [] };
    return ir;
}

function listSpecFiles(projectRoot) {
    const dir = path.join(projectRoot, 'docs', 'specs');
    if (!fs.existsSync(dir)) return [];
    try {
        return fs.readdirSync(dir)
            .filter(f => f.endsWith('.md'))
            .map(f => path.join(dir, f));
    } catch (_) {
        return [];
    }
}

function gitLastCommitISO(projectRoot, relFile) {
    try {
        const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', relFile], {
            cwd: projectRoot, encoding: 'utf8', timeout: 5000,
        }).trim();
        return out || null;
    } catch (_) {
        return null;
    }
}

function mtimeISO(absPath) {
    try {
        return fs.statSync(absPath).mtime.toISOString();
    } catch (_) {
        return null;
    }
}

// lastTouchedAt = max of `git log -1 --format=%cI -- <file>` across the spec file and
// each linked plan file; falls back to file mtime when git is unavailable/file untracked.
// Never throws.
function resolveLastTouchedAt(projectRoot, relFiles) {
    let max = null;
    for (const relFile of relFiles) {
        if (!relFile) continue;
        const posixRel = relFile.replace(/\\/g, '/');
        let iso = gitLastCommitISO(projectRoot, posixRel);
        if (!iso) {
            iso = mtimeISO(path.join(projectRoot, relFile));
        }
        if (iso && (!max || iso > max)) max = iso;
    }
    return max;
}

// The LAST ```json fenced block in the file that contains a `"criteria"` key.
function extractLastCriteriaArray(content) {
    const re = /```json\s*\n([\s\S]*?)```/g;
    let match;
    let lastBlock = null;
    while ((match = re.exec(content)) !== null) {
        if (match[1].includes('"criteria"')) lastBlock = match[1];
    }
    if (!lastBlock) return [];
    try {
        const parsed = JSON.parse(lastBlock);
        return Array.isArray(parsed.criteria) ? parsed.criteria : [];
    } catch (_) {
        return [];
    }
}

function computeSizeMetrics(content, body) {
    const criteria = extractLastCriteriaArray(content);
    const acCount = criteria.length;

    let phaseCount = (body.match(/^### Phase /gm) || []).length;
    if (phaseCount === 0) {
        phaseCount = (body.match(/^#{2,3} .*Phase/gmi) || []).length;
    }

    const dependsOnSet = new Set();
    for (const criterion of criteria) {
        if (criterion && Array.isArray(criterion.dependsOn)) {
            for (const dep of criterion.dependsOn) dependsOnSet.add(dep);
        }
    }

    return {
        acCount,
        phaseCount,
        dependsOnCount: dependsOnSet.size,
        chars: content.length,
    };
}

function isSizeExceeded(size) {
    return size.acCount > SIZE_THRESHOLDS.acCount
        || size.phaseCount > SIZE_THRESHOLDS.phaseCount
        || size.dependsOnCount > SIZE_THRESHOLDS.dependsOnCount
        || size.chars > SIZE_THRESHOLDS.chars;
}

function parseRelations(frontmatter) {
    if (!frontmatter || !frontmatter.relations) return [];
    try {
        const parsed = JSON.parse(frontmatter.relations);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

// buildSpecRegistry(projectRoot, opts) never throws for normal degradation
// (no git, no docs/specs dir, no plan-ir) — it returns a registry with an
// empty specs array / null lastTouchedAt per entry instead.
function buildSpecRegistry(projectRoot, opts = {}) {
    const write = opts.write !== false;
    const agingDays = loadAgingDays(projectRoot);
    const ir = loadPlanIR(projectRoot);
    const plansById = new Map();
    for (const plan of ir.plans) {
        if (plan && plan.id) plansById.set(plan.id, plan);
    }

    const specs = [];
    for (const absPath of listSpecFiles(projectRoot)) {
        let parsed = null;
        try {
            parsed = parseSpecFile(absPath);
        } catch (_) {
            parsed = null;
        }
        if (!parsed) continue;

        let content = '';
        try {
            content = fs.readFileSync(absPath, 'utf8');
        } catch (_) {
            content = '';
        }
        const { frontmatter, body } = parseFrontmatter(content);
        const relSpecPath = path.relative(projectRoot, absPath).replace(/\\/g, '/');

        // Bidirectional linked-plan resolution: spec-declared linkedPlans UNION
        // plans in plan-ir whose linkedSpec points back at this spec.
        const linkedSet = new Set(parsed.linkedPlans || []);
        for (const plan of ir.plans) {
            if (plan && plan.linkedSpec === parsed.id && plan.id) linkedSet.add(plan.id);
        }
        const linkedPlans = Array.from(linkedSet).sort();

        // A referenced plan absent from plan-ir is conservatively treated as not-done.
        const notDonePlans = linkedPlans.filter(planId => {
            const plan = plansById.get(planId);
            return !plan || plan.status !== 'done';
        });
        const anyPlanNotDone = notDonePlans.length > 0;

        const touchFiles = [relSpecPath];
        for (const planId of linkedPlans) {
            const plan = plansById.get(planId);
            if (plan && plan.sourcePath) touchFiles.push(plan.sourcePath);
        }
        const lastTouchedAt = resolveLastTouchedAt(projectRoot, touchFiles);
        const idleDays = lastTouchedAt ? Math.floor((Date.now() - Date.parse(lastTouchedAt)) / DAY_MS) : 0;

        const size = computeSizeMetrics(content, body);
        const sizeExceeded = isSizeExceeded(size);
        const sizeWaiver = (frontmatter && frontmatter.sizeWaiver) || null;

        const status = (frontmatter && frontmatter.status) || parsed.status;
        const warnings = [];
        let state;

        if (status === 'done') {
            state = 'shipped';
        } else if (status === 'parked') {
            state = 'parked';
            if (linkedPlans.length > 0 && anyPlanNotDone) warnings.push('zombie-plan');
        } else if (linkedPlans.length === 0) {
            state = 'adopted';
            if (idleDays > agingDays) warnings.push('aging-no-plan');
        } else {
            state = 'active';
            if (anyPlanNotDone && idleDays > agingDays) warnings.push('aging-inactive');
        }

        if (sizeExceeded && !sizeWaiver) warnings.push('size-exceeded');

        specs.push({
            id: parsed.id,
            file: relSpecPath,
            state,
            linkedPlans,
            lastTouchedAt,
            idleDays,
            size,
            sizeExceeded,
            sizeWaiver,
            relations: parseRelations(frontmatter),
            notDonePlans,
            warnings,
        });
    }

    const registry = {
        version: 'evo-spec-registry@1',
        generatedAt: new Date().toISOString(),
        agingDays,
        specs,
    };

    if (write) {
        try {
            const outPath = path.join(projectRoot, '.evo-lite', 'generated', 'spec-registry.json');
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, JSON.stringify(registry, null, 2), 'utf8');
        } catch (_) {
            // Registry write is best-effort; never throw for normal degradation.
        }
    }

    return registry;
}

function formatWarningLine(spec, warning) {
    if (warning === 'aging-no-plan' || warning === 'aging-inactive') {
        return `⚠️ ${spec.id} 已 ${spec.idleDays} 天无活动 (${spec.state}) — 请表态: mem spec park|reactivate`;
    }
    if (warning === 'size-exceeded') {
        return `⚠️ ${spec.id} 体量超标 (AC=${spec.size.acCount}, Phase=${spec.size.phaseCount}) — 建议拆分或在 frontmatter 声明 sizeWaiver`;
    }
    if (warning === 'zombie-plan') {
        // Only the not-done plans are "仍活跃" — a done plan must never be named here.
        const plans = (spec.notDonePlans || spec.linkedPlans || []).join(', ');
        return `⚠️ ${spec.id} 已 parked 但关联 plan 仍活跃 (${plans}) — zombie plan`;
    }
    return `⚠️ ${spec.id} ${warning}`;
}

function formatPortfolioReport(registry) {
    if (!registry) return [];

    const counts = { adopted: 0, active: 0, parked: 0, shipped: 0 };
    const specs = Array.isArray(registry.specs) ? registry.specs : [];
    for (const spec of specs) {
        if (Object.prototype.hasOwnProperty.call(counts, spec.state)) counts[spec.state]++;
    }

    const lines = [
        `📋 [Spec Portfolio]: adopted=${counts.adopted} active=${counts.active} parked=${counts.parked} shipped=${counts.shipped}`,
    ];
    for (const spec of specs) {
        for (const warning of (spec.warnings || [])) {
            lines.push(formatWarningLine(spec, warning));
        }
    }
    return lines;
}

module.exports = {
    SIZE_THRESHOLDS,
    DEFAULT_AGING_DAYS,
    buildSpecRegistry,
    formatPortfolioReport,
};
