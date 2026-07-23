'use strict';

// Orchestrator (design §1/§6). Deterministic given (inputs snapshot, headSha,
// injected clock). No network access. Output dir is wiped and rebuilt.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createPageMap } = require('./page-map');
const { loadWikiGroups } = require('./groups');
const { buildProjection } = require('./projection');
const { validateEdges, renderIndex, renderModulePage } = require('./render');
const { generateSourcePages } = require('./source-pages');

function readJson(file) {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function defaultGitLog(projectRoot) {
    try {
        const out = execFileSync('git', ['log', '-10', '--pretty=format:%H%x00%s', '--name-only'],
            { cwd: projectRoot, encoding: 'utf8' });
        const commits = [];
        let current = null;
        for (const line of out.split('\n')) {
            if (line.includes('\x00')) {
                const [sha, subject] = line.split('\x00');
                current = { sha, subject, files: [] };
                commits.push(current);
            } else if (line.trim() && current) current.files.push(line.trim());
        }
        return commits;
    } catch { return null; }  // 非 git 环境 → null(上层记 warning,用 [])
}

function defaultDeps() {
    return {
        // projectRoot MUST be forwarded: exploreCode falls back to the HOST
        // workspace when options.projectRoot is unset, which would leak the
        // mother repo's focus/IR into a child-project build (P0-3).
        explore: async projectRoot => {
            const svc = require('../code-perception');
            return svc.exploreCode('', { projectRoot, includeSource: false, includeImpact: false });
        },
        verifySummary: projectRoot => {
            const d = require('../dashboard-data');
            return d.buildDashboardData(projectRoot).verify;
        },
        gitLog: defaultGitLog,
    };
}

async function buildWiki({ projectRoot, now, deps }) {
    const clock = now || (() => new Date().toISOString());
    const d = { ...defaultDeps(), ...(deps || {}) };
    const warnings = [];
    const gen = path.join(projectRoot, '.evo-lite', 'generated');

    const architectureIR = readJson(path.join(gen, 'architecture', 'architecture-ir.json'));
    if (!architectureIR) return { ok: false, error: 'architecture IR missing — run: mem architecture scan' };
    const planIR = readJson(path.join(gen, 'planning', 'plan-ir.json'));
    if (!planIR) return { ok: false, error: 'planning IR missing — run: mem plan scan' };
    const driftReport = readJson(path.join(gen, 'architecture', 'drift-report.json')) || { findings: [], summary: {} };

    let exploreResult;
    try { exploreResult = await d.explore(projectRoot); }
    catch (e) { exploreResult = { focus: { entityId: null, taskId: null, resolved: false } }; warnings.push(`explore unavailable: ${e.message}`); }
    let verifySummary = null;
    try { verifySummary = d.verifySummary(projectRoot); }
    catch (e) { warnings.push(`verify summary unavailable: ${e.message}`); }
    let recentCommits = d.gitLog(projectRoot);
    if (!recentCommits) { recentCommits = []; warnings.push('git log unavailable — recent changes omitted'); }

    const knownIds = (architectureIR.modules || []).map(m => m.id);
    const groupsRes = loadWikiGroups(projectRoot, knownIds);
    if (!groupsRes.ok) return { ok: false, invalidConfig: true, error: `wiki-groups.json invalid:\n  ${groupsRes.errors.join('\n  ')}` };

    const edgeRes = validateEdges(architectureIR.edges, knownIds);
    warnings.push(...edgeRes.warnings);

    const projection = buildProjection({ architectureIR, planIR, exploreResult, driftReport, verifySummary, recentCommits });
    warnings.push(...projection.warnings);
    projection.validEdges = edgeRes.valid;

    let headSha = 'unknown';
    try { headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim(); }
    catch { warnings.push('git HEAD unavailable'); }
    const meta = {
        generatedAt: clock(),
        headSha,
        // scanArchitecture writes project as { name, root } (scan-native.js:185) —
        // guard the shape so a raw object can never reach the templates.
        projectName: architectureIR.project && typeof architectureIR.project.name === 'string'
            ? architectureIR.project.name
            : path.basename(path.resolve(projectRoot)),
    };

    // deterministic page assignment order: modules by id, then source files sorted
    const pageMap = createPageMap();
    for (const m of projection.modules) pageMap.modulePage(m.moduleId);
    const allFiles = [...new Set(projection.modules.flatMap(m => m.files))].sort();
    const src = generateSourcePages({ projectRoot, files: allFiles, pageMap, meta });
    warnings.push(...src.warnings);
    const skippedByPath = new Map(src.skipped.map(s => [s.path, s.reason]));
    const pageByPath = new Map(src.pages.map(p => [allFiles.find(f => pageMap.sourcePage(f) === p.page), p.page]));
    const sourcePageFor = f => pageByPath.has(f) ? { page: pageByPath.get(f) }
        : { reason: skippedByPath.get(f) || '未生成' };

    const outDir = path.join(gen, 'wiki');
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    const written = [];
    const writePage = (rel, html) => {
        const abs = path.join(outDir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, html);
        written.push(rel.replace(/\\/g, '/'));
    };

    writePage('index.html', renderIndex({ projection, groupsConfig: groupsRes.config, pageMap, meta }));
    for (const mp of projection.modules) {
        writePage(pageMap.modulePage(mp.moduleId), renderModulePage({ mp, pageMap, meta, sourcePageFor, groupsConfig: groupsRes.config }));
    }
    for (const p of src.pages) writePage(p.page, p.html);

    const manifest = {
        version: 'evo-architecture-wiki@1',
        generatedAt: meta.generatedAt,
        headSha,
        architectureIrGeneratedAt: architectureIR.generatedAt || null,
        planningIrGeneratedAt: planIR.generatedAt || null,
        inputFreshness: projection.project.inputFreshness,
        knownEdgeCount: edgeRes.valid.length,
        pages: [...written].sort(),
        modulePages: pageMap.modulePages(),
        warnings: [...warnings].sort(),
    };
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    return { ok: true, outDir, manifest, warnings };
}

module.exports = { buildWiki };
