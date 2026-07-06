'use strict';

// Drift engine — planning scope: R003-R006, R008-R012

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PLAN_SOURCE_PATHS = ['docs/specs', 'docs/plans', 'docs/superpowers/specs', 'docs/superpowers/plans'];
const ARCH_SOURCE_PATHS = [
    'templates/cli',
    'templates/.github',
    'templates/.codex',
    '.agents/rules',
    '.agents/workflows',
    'index.js',
    'bin/cli.js',
    'package.json',
    'docs/contracts',
    'docs/architecture',
];

function normalizePaths(list) {
    return list.map(item => item.replace(/\\/g, '/')).filter(Boolean);
}

function readChangedFilesFromEnv() {
    const raw = process.env.EVO_LITE_CHANGED_FILES;
    if (!raw) return null;
    const files = normalizePaths(raw.split(/\r?\n/).map(item => item.trim()));
    return files.length > 0 ? files : null;
}

function getChangedFiles(projectRoot, options = {}) {
    if (Array.isArray(options.changedFiles)) {
        return normalizePaths(options.changedFiles);
    }

    if (options.changedFilesFromEnv) {
        const envFiles = readChangedFilesFromEnv();
        if (envFiles) return envFiles;
    }

    try {
        const args = options.lastCommit
            ? ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', 'HEAD']
            : ['diff', '--name-only', 'HEAD'];
        const out = execFileSync('git', args, {
            cwd: projectRoot, encoding: 'utf8', timeout: 5000,
        }).trim();
        return out ? normalizePaths(out.split('\n')) : [];
    } catch {
        return [];
    }
}

// Root-level project-meta files that are not product code. Listed explicitly
// so the exemption stays a single, testable predicate rather than ad-hoc filters.
const ROOT_META_FILES = new Set([
    'CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 'RTK.md',
    '.gitignore', '.gitattributes', '.editorconfig',
    'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
]);

function isGovernanceInfraFile(file) {
    const f = String(file || '').replace(/\\/g, '/').replace(/^\.\//, '');
    // R006 is a business-code traceability rule. Evo-Lite runtime state,
    // host-adapter config, and project-meta files are governance / host
    // infrastructure, not product code, so they must not be reported as
    // unlinked product files. Runtime state is also covered by specialized
    // rules (archive-evidence backfill, freshness, runtime-lock verification).
    if (f === '.evo-lite' || f.startsWith('.evo-lite/')) return true; // runtime state + mirror
    if (f === '.claude' || f.startsWith('.claude/')) return true;     // host adapter: commands, settings, skills
    // Root-level meta only (no path separator → top of repo), so nested
    // product files like docs/README.md or src/foo.lock stay traceable.
    const base = f.includes('/') ? '' : f;
    if (!base) return false;
    if (ROOT_META_FILES.has(base)) return true;
    if (/^README[^/]*\.md$/i.test(base)) return true;                 // README.md, README.zh-CN.md, …
    if (/\.lock$/i.test(base)) return true;                           // *.lock lockfiles
    return false;
}

function normalizeBacklogItem(line) {
    return String(line || '')
        .trim()
        .replace(/^[-*]\s*/, '')
        .replace(/^\[[ xX]\]\s*/, '')
        .trim()
        .toLowerCase();
}

function isPlaceholderBacklogItem(item) {
    const normalized = String(item || '').trim();
    return normalized === '' ||
        /^暂无活跃任务[。.]?$/.test(normalized) ||
        /^(no active tasks?|none|empty|n\/a)[.]?$/.test(normalized);
}

function hasArchiveEvidence(task) {
    return (task.evidence || []).some(item =>
        /^(archive:|raw:|mem_)/i.test(item) || /raw_memory\//i.test(item)
    );
}

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

function checkR006(projectRoot, planIR, options = {}) {
    if (!planIR) return [];
    const changedFiles = getChangedFiles(projectRoot, options)
        .filter(f => !isGovernanceInfraFile(f));
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
            !t.planR008Exempt &&
            (t.status === 'implemented' || t.status === 'verified') &&
            !hasArchiveEvidence(t))
        .map(t => ({
            id: `R008:${t.id}`, rule: 'R008', scope: 'planning', level: 'warning',
            type: 'no-evidence',
            message: `Task ${t.id} (${t.status}) has no archive evidence`,
            evidence: [t.sourcePath],
            suggestedAction: `Run mem archive after completing ${t.id} to record evidence`,
        }));
}

// --- R009 ---

function checkR009(projectRoot) {
    const findings = [];

    function checkNewerThan(irMtime, absPath) {
        if (!fs.existsSync(absPath)) return false;
        const stat = fs.statSync(absPath);
        if (stat.isFile()) return stat.mtimeMs > irMtime;
        for (const entry of fs.readdirSync(absPath, { withFileTypes: true })) {
            if (checkNewerThan(irMtime, path.join(absPath, entry.name))) return true;
        }
        return false;
    }

    function check(irPath, sourcePaths, label) {
        if (!fs.existsSync(irPath)) return;
        const irMtime = fs.statSync(irPath).mtimeMs;
        for (const src of sourcePaths) {
            const abs = path.resolve(projectRoot, src);
            if (checkNewerThan(irMtime, abs)) {
                findings.push({
                    id: `R009:${label}`, rule: 'R009', scope: 'planning', level: 'info',
                    type: 'stale-ir',
                    message: `${label} IR is stale — ${src} is newer`,
                    evidence: [path.relative(projectRoot, irPath).replace(/\\/g, '/')],
                    suggestedAction: label === 'plan' ? 'Run: mem plan scan' : 'Run: mem architecture scan',
                });
                return;
            }
        }
    }

    check(
        path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json'),
        PLAN_SOURCE_PATHS,
        'plan'
    );
    check(
        path.join(projectRoot, '.evo-lite', 'generated', 'architecture', 'architecture-ir.json'),
        ARCH_SOURCE_PATHS,
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
        .map(normalizeBacklogItem)
        .filter(item => !isPlaceholderBacklogItem(item));
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

// --- R012 ---

// Squash to alphanumerics so "Phase 1" (prose) matches "phase1" (slug) and
// punctuation/spacing differences never break the focus → plan resolution.
function squashForMatch(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function readFocusText(projectRoot) {
    const focusPath = path.join(projectRoot, '.evo-lite', 'active_context.md');
    if (!fs.existsSync(focusPath)) return '';
    const md = fs.readFileSync(focusPath, 'utf8');
    const m = md.match(/<!--\s*BEGIN_FOCUS\s*-->([\s\S]*?)<!--\s*END_FOCUS\s*-->/);
    return m ? m[1].trim() : '';
}

// R012 — phantom focus: the current focus points at a plan that has not really
// started (status: draft, or 0 tasks done). The >24h staleness alert only
// caught this indirectly; this names the plan and its task count directly.
function checkR012(projectRoot, planIR, options = {}) {
    if (!planIR) return [];
    const focusText = options.focusText != null ? options.focusText : readFocusText(projectRoot);
    if (!focusText) return [];
    const squashedFocus = squashForMatch(focusText);
    if (!squashedFocus) return [];

    const findings = [];
    for (const plan of (planIR.plans || [])) {
        const slug = String(plan.id || '').replace(/^plan:/, '');
        const squashedSlug = squashForMatch(slug);
        const squashedTitle = squashForMatch(plan.title);
        const referenced =
            (plan.id && focusText.includes(plan.id)) ||                       // literal plan:<slug>
            (squashedSlug && squashedFocus.includes(squashedSlug)) ||         // slug words in prose
            (squashedTitle && squashedFocus.includes(squashedTitle));         // plan title in prose
        if (!referenced) continue;

        const planTasks = (planIR.tasks || []).filter(t => t.linkedPlan === plan.id);
        const total = planTasks.length;
        const done = planTasks.filter(t => t.status === 'implemented' || t.status === 'verified').length;
        const unstarted = plan.status === 'draft' || done === 0;
        if (!unstarted) continue; // focus points at a started/advanced plan — healthy

        findings.push({
            id: `R012:${plan.id}`,
            rule: 'R012',
            scope: 'planning',
            level: 'warning',
            type: 'phantom-focus',
            message: `Focus points at plan ${plan.id} [${plan.status}] with ${done}/${total} tasks done — it is not a started, active plan`,
            evidence: [plan.sourcePath].filter(Boolean),
            suggestedAction: `Advance focus to a started plan (mem focus), or begin ${plan.id}`,
        });
    }
    return findings;
}

// --- R013 ---

// Read the structured META git fields from active_context.md. These are the ONLY
// machine-checkable git-state source R013 trusts — FOCUS prose is never parsed.
function readMetaGitState(projectRoot) {
    const p = path.join(projectRoot, '.evo-lite', 'active_context.md');
    if (!fs.existsSync(p)) return null;
    const md = fs.readFileSync(p, 'utf8');
    const m = md.match(/<!--\s*BEGIN_META\s*-->([\s\S]*?)<!--\s*END_META\s*-->/);
    if (!m) return null;
    const block = m[1];
    const field = (name) => {
        const fm = block.match(new RegExp(`${name}:\\s*(\\S+)`, 'i'));
        return fm ? fm[1] : null;
    };
    return { headSha: field('headSha'), ahead: field('ahead'), behind: field('behind') };
}

// Read live git state via argv-form git (never string-interpolated). Injectable
// via options.gitState for tests.
function liveGitState(projectRoot) {
    const git = (args) => String(execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' })).trim();
    try {
        const headSha = git(['rev-parse', 'HEAD']);
        let hasUpstream = true, ahead = 0, behind = 0;
        try {
            const lr = git(['rev-list', '--left-right', '--count', '@{u}...HEAD']).split(/\s+/);
            behind = parseInt(lr[0], 10) || 0; ahead = parseInt(lr[1], 10) || 0;
        } catch (_) { hasUpstream = false; }
        return {
            headSha, ahead, behind, hasUpstream,
            isAncestorOfHead: (sha) => {
                if (sha === headSha) return true;
                try { execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: projectRoot }); return true; }
                catch (_) { return false; }
            },
        };
    } catch (_) {
        return null; // not a git repo — R013 cannot check, stays silent
    }
}

function checkR013(projectRoot, options = {}) {
    const meta = options.metaState != null ? options.metaState : readMetaGitState(projectRoot);
    if (!meta || !meta.headSha) return []; // no structured state to check
    const git = options.gitState != null ? options.gitState : liveGitState(projectRoot);
    if (!git) return [];
    const findings = [];
    if (!git.isAncestorOfHead(meta.headSha)) {
        findings.push({
            id: 'R013:head', rule: 'R013', scope: 'planning', level: 'warning', type: 'active-context-remote-drift',
            message: `active_context META headSha ${meta.headSha} is not HEAD (${git.headSha}) nor an ancestor — the recorded project position is stale`,
            evidence: ['.evo-lite/active_context.md'],
            suggestedAction: 'Run `mem commit` / `context track` to refresh the META git fields, or update focus',
        });
    }
    if (git.hasUpstream) {
        const metaAhead = meta.ahead == null ? null : parseInt(meta.ahead, 10);
        const metaBehind = meta.behind == null ? null : parseInt(meta.behind, 10);
        if ((metaAhead != null && metaAhead !== git.ahead) || (metaBehind != null && metaBehind !== git.behind)) {
            findings.push({
                id: 'R013:sync', rule: 'R013', scope: 'planning', level: 'warning', type: 'active-context-remote-drift',
                message: `active_context META ahead/behind (${meta.ahead}/${meta.behind}) disagrees with git (${git.ahead}/${git.behind})`,
                evidence: ['.evo-lite/active_context.md'],
                suggestedAction: 'Refresh META via `mem commit` / `context track`',
            });
        }
    }
    return findings;
}

// --- Public ---

function runPlanningDrift(projectRoot, planIR, options = {}) {
    return [
        ...checkR003(projectRoot),
        ...checkR004(projectRoot),
        ...checkR005(planIR),
        ...checkR006(projectRoot, planIR, options),
        ...checkR008(planIR),
        ...checkR009(projectRoot),
        ...checkR010(projectRoot, planIR),
        ...checkR011(planIR),
        ...checkR012(projectRoot, planIR, options),
        ...checkR013(projectRoot, options),
    ];
}

module.exports = {
    runPlanningDrift,
    checkR006,
    checkR008,
    checkR009,
    checkR012,
    checkR013,
    getChangedFiles,
    hasArchiveEvidence,
    isGovernanceInfraFile,
    normalizeBacklogItem,
    isPlaceholderBacklogItem,
    PLAN_SOURCE_PATHS,
    ARCH_SOURCE_PATHS,
};
