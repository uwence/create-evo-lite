'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SNAPSHOT_VERSION = 'evo-governance-snapshot@1';
const SNAPSHOT_RELATIVE_PATH = path.join('.evo-lite', 'generated', 'governance', 'snapshot.json');
const FINDING_ORDER = [
    'CONTEXT_HEAD_NOT_ANCESTOR',
    'CONTEXT_SYNC_COUNT_DRIFT',
    'TRAJECTORY_HEAD_DRIFT',
    'FOCUS_PLAN_DRIFT',
    'PORTFOLIO_SOURCE_DRIFT',
    'REMEDIATION_BUDGET_EXCEEDED',
];
const RECOMMENDATION_BY_FINDING = {
    CONTEXT_HEAD_NOT_ANCESTOR: 'refresh-context-baseline',
    CONTEXT_SYNC_COUNT_DRIFT: 'reconcile-context-sync-counts',
    TRAJECTORY_HEAD_DRIFT: 'record-current-trajectory-head',
    FOCUS_PLAN_DRIFT: 'reconcile-focus-with-plan',
    PORTFOLIO_SOURCE_DRIFT: 'repair-portfolio-source',
    REMEDIATION_BUDGET_EXCEEDED: 'choose-governance-disposition',
};
const TRANSITION_ORDER = [
    'branch-changed',
    'head-advanced',
    'merge-observed',
    'pr-phase-changed',
    'ci-state-changed',
    'freeze-added',
    'budget-crossed',
];
const DEFAULT_BUDGET_CONFIG = Object.freeze({
    windowCommits: 100,
    maxGovernanceRatio: 0.7,
    maxRemediationRatio: 0.5,
});
const BUDGET_CHOICES = Object.freeze([
    'continue-governance',
    'downgrade-nonblocking-debt',
    'resume-authorized-execution',
]);

function sha256(value) {
    return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function observedAt(options) {
    const value = typeof options.now === 'function' ? options.now() : new Date();
    return value && typeof value.toISOString === 'function' ? value.toISOString() : String(value);
}

function readJsonSafe(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return fallback;
    }
}

function readSection(markdown, name) {
    const begin = `<!-- BEGIN_${name} -->`;
    const end = `<!-- END_${name} -->`;
    const start = markdown.indexOf(begin);
    const finish = markdown.indexOf(end);
    if (start < 0 || finish < start) return '';
    return markdown.slice(start + begin.length, finish).trim();
}

function parseMeta(section) {
    const meta = {};
    for (const line of String(section || '').split(/\r?\n/)) {
        const match = line.match(/^\s*(?:>\s*)?([A-Za-z][A-Za-z0-9]*):\s*(.*?)\s*$/);
        if (match) meta[match[1]] = match[2];
    }
    return {
        headSha: meta.headSha || null,
        upstreamSha: meta.upstreamSha || null,
        ahead: /^\d+$/.test(meta.ahead || '') ? Number(meta.ahead) : null,
        behind: /^\d+$/.test(meta.behind || '') ? Number(meta.behind) : null,
    };
}

function parseActiveContextMarkdown(markdown) {
    const focus = readSection(markdown, 'FOCUS');
    const backlog = readSection(markdown, 'BACKLOG');
    const trajectory = readSection(markdown, 'TRAJECTORY');
    const backlogIds = [];
    for (const line of backlog.split(/\r?\n/)) {
        const match = line.match(/^\s*-\s+\[[ xX]\]\s+\[([A-Za-z0-9_-]{1,32})\]/);
        if (match) backlogIds.push(match[1]);
    }
    const trajectoryMatch = trajectory.match(/\[([0-9a-f]{7,40})\]/i);
    return {
        meta: parseMeta(readSection(markdown, 'META')),
        focus,
        backlogIds,
        trajectoryHead: trajectoryMatch ? trajectoryMatch[1].toLowerCase() : null,
    };
}

function runGit(projectRoot, args, options = {}) {
    if (typeof options.git === 'function') return String(options.git(args) || '').trim();
    return childProcess.execFileSync('git', args, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

function readGitState(projectRoot, options = {}) {
    if (options.gitState) return {
        head: options.gitState.head || null,
        branch: options.gitState.branch || null,
        upstream: options.gitState.upstream || null,
        ahead: Number(options.gitState.ahead || 0),
        behind: Number(options.gitState.behind || 0),
        dirty: Boolean(options.gitState.dirty),
        merge: Boolean(options.gitState.merge),
    };
    const head = runGit(projectRoot, ['rev-parse', 'HEAD'], options);
    const branch = runGit(projectRoot, ['branch', '--show-current'], options) || '(detached)';
    let upstream = null;
    let ahead = 0;
    let behind = 0;
    try {
        upstream = runGit(projectRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], options);
        const counts = runGit(projectRoot, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`], options)
            .split(/\s+/).map(Number);
        behind = counts[0] || 0;
        ahead = counts[1] || 0;
    } catch {
        upstream = null;
    }
    const parents = runGit(projectRoot, ['rev-list', '--parents', '-n', '1', 'HEAD'], options).split(/\s+/);
    return {
        head,
        branch,
        upstream,
        ahead,
        behind,
        dirty: runGit(projectRoot, ['status', '--porcelain'], options).length > 0,
        merge: parents.length > 2,
    };
}

// `git merge-base --is-ancestor` exits 0 (yes), 1 (no), and anything else means
// it could not answer. Collapsing that third case into "no" reports a failed
// probe as a divergence, so it is returned distinctly and each caller decides
// what to do with not knowing.
function probeAncestry(projectRoot, ancestor, head) {
    if (!ancestor || !head) return 'unknown';
    const result = childProcess.spawnSync('git', ['merge-base', '--is-ancestor', ancestor, head], {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: 'ignore',
    });
    if (result.error) return 'unknown';
    if (result.status === 0) return 'ancestor';
    if (result.status === 1) return 'not-ancestor';
    return 'unknown';
}

// Behaviour unchanged for the observer, which has always treated "cannot tell"
// the same as "not an ancestor" when raising CONTEXT_HEAD_NOT_ANCESTOR.
function defaultIsAncestor(projectRoot, ancestor, head) {
    return probeAncestry(projectRoot, ancestor, head) === 'ancestor';
}

function readActiveContext(projectRoot, options = {}) {
    if (options.activeContext) return options.activeContext;
    const filePath = path.join(projectRoot, '.evo-lite', 'active_context.md');
    if (!fs.existsSync(filePath)) {
        return { meta: {}, focus: '', backlogIds: [], trajectoryHead: null };
    }
    return parseActiveContextMarkdown(fs.readFileSync(filePath, 'utf8'));
}

function readPlanIR(projectRoot, options = {}) {
    if (options.planIR) return options.planIR;
    return readJsonSafe(
        path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json'),
        { specs: [], plans: [], tasks: [], findings: [], warnings: [] },
    );
}

function readPortfolio(projectRoot, options = {}) {
    if (options.portfolio) return options.portfolio;
    try {
        return require('./spec-portfolio').buildSpecRegistry(projectRoot, { now: options.now });
    } catch {
        return { source: { portfolioSourceDrift: true } };
    }
}

function readFreezeLedger(projectRoot, options = {}) {
    if (options.freezeLedger) return options.freezeLedger;
    try {
        return require('./planning/freeze-ledger').inspectFreezeLedger(projectRoot);
    } catch {
        return { entries: [] };
    }
}

function invalidBudgetConfig(message) {
    const error = new Error(message);
    error.code = 'GOVERNANCE_BUDGET_CONFIG_INVALID';
    return error;
}

function loadGovernanceBudgetConfig(projectRoot) {
    const configPath = path.join(projectRoot, '.evo-lite', 'config.json');
    let config = {};
    if (fs.existsSync(configPath)) {
        try {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (error) {
            throw invalidBudgetConfig(`invalid JSON in ${configPath}: ${error.message}`);
        }
    }
    const configured = config && config.governance && config.governance.budget;
    if (configured !== undefined && (
        configured === null
        || typeof configured !== 'object'
        || Array.isArray(configured)
    )) {
        throw invalidBudgetConfig('governance.budget must be an object');
    }
    const result = { ...DEFAULT_BUDGET_CONFIG, ...(configured || {}) };
    if (!Number.isInteger(result.windowCommits) || result.windowCommits < 1 || result.windowCommits > 2147483647) {
        throw invalidBudgetConfig('governance.budget.windowCommits must be an integer in 1..2147483647');
    }
    for (const key of ['maxGovernanceRatio', 'maxRemediationRatio']) {
        if (!Number.isFinite(result[key]) || result[key] < 0 || result[key] > 1) {
            throw invalidBudgetConfig(`governance.budget.${key} must be a number in 0..1`);
        }
    }
    return result;
}

function isGovernanceOnlyPath(relativePath) {
    const value = String(relativePath || '').replace(/\\/g, '/');
    return value.startsWith('docs/')
        || value.startsWith('.agents/')
        || /(^|\/)(test|tests|__tests__)(\/|$)/.test(value)
        || value === '.evo-lite/active_context.md'
        || value === '.evo-lite/config.json'
        || value.startsWith('.evo-lite/raw_memory/')
        || value.startsWith('.evo-lite/index_memory/')
        || value.startsWith('.evo-lite/generated/')
        || value.startsWith('.evo-lite/governance/')
        || value.startsWith('.evo-lite/hive/');
}

function classifyCommitFiles(files) {
    const normalized = (files || []).filter(Boolean);
    if (normalized.length === 0) return 'governance';
    const governance = normalized.filter(isGovernanceOnlyPath).length;
    if (governance === normalized.length) return 'governance';
    if (governance === 0) return 'delivery';
    return 'mixed';
}

function buildGovernanceBudget(projectRoot, options = {}) {
    const config = options.config || loadGovernanceBudgetConfig(projectRoot);
    const head = runGit(projectRoot, ['rev-parse', 'HEAD'], options);
    const revisionArgs = options.since
        ? ['rev-list', '--reverse', '--topo-order', `${options.since}..HEAD`]
        : ['rev-list', `--max-count=${config.windowCommits}`, '--reverse', 'HEAD'];
    const commits = runGit(projectRoot, revisionArgs, options).split(/\r?\n/).filter(Boolean);
    const counts = { delivery: 0, governance: 0, mixed: 0, merge: 0, primary: 0 };
    const commitTimes = [];
    for (const commit of commits) {
        commitTimes.push(Number(runGit(projectRoot, ['show', '-s', '--format=%ct', commit], options)));
        const identity = runGit(projectRoot, ['rev-list', '--parents', '-n', '1', commit], options).split(/\s+/);
        if (identity.length > 2) {
            counts.merge += 1;
            continue;
        }
        const files = runGit(projectRoot, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', commit], options)
            .split(/\r?\n/).filter(Boolean);
        const classification = classifyCommitFiles(files);
        counts[classification] += 1;
        counts.primary += 1;
    }
    const freezeLedger = readFreezeLedger(projectRoot, options);
    const remediationCommits = (freezeLedger.entries || []).reduce(
        (total, entry) => total + Number(entry && entry.remediation && entry.remediation.used || 0),
        0,
    );
    const governanceRatio = counts.primary > 0 ? counts.governance / counts.primary : 0;
    const remediationRatio = counts.primary > 0 ? remediationCommits / counts.primary : 0;
    const exceeded = governanceRatio > config.maxGovernanceRatio
        || remediationRatio > config.maxRemediationRatio;
    const finiteTimes = commitTimes.filter(Number.isFinite);
    return {
        version: 'evo-governance-budget@1',
        since: options.since || null,
        head,
        windowCommits: config.windowCommits,
        elapsedSeconds: finiteTimes.length > 1 ? Math.max(...finiteTimes) - Math.min(...finiteTimes) : 0,
        counts,
        remediationCommits,
        governanceRatio,
        remediationRatio,
        thresholds: {
            maxGovernanceRatio: config.maxGovernanceRatio,
            maxRemediationRatio: config.maxRemediationRatio,
        },
        status: exceeded ? 'budget-exceeded' : 'within-budget',
        choices: exceeded ? [...BUDGET_CHOICES] : [],
    };
}

function findingCodes(planIR) {
    const values = [...(planIR.findings || []), ...(planIR.warnings || [])];
    const codes = new Set();
    for (const value of values) {
        const text = typeof value === 'string' ? value : String(value && value.code || '');
        const match = text.match(/\bR\d{3}\b/);
        if (match) codes.add(match[0]);
    }
    return [...codes].sort();
}

function detectFocusPlanDrift(focus, planIR, explicit) {
    if (typeof explicit === 'boolean') return explicit;
    const tasks = planIR.tasks || [];
    const active = (planIR.plans || [])
        .filter(plan => plan && plan.status === 'active' && typeof plan.id === 'string'
            && tasks.some(task => task && task.linkedPlan === plan.id
                && (task.status === 'implemented' || task.status === 'verified')))
        .map(plan => plan.id.replace(/^plan:/, ''));
    return active.length > 0 && active.some(id => !String(focus || '').includes(id));
}

function sanitizePrState(prState) {
    if (!prState) return null;
    return {
        number: Number.isInteger(prState.number) ? prState.number : null,
        base: typeof prState.base === 'string' ? prState.base : null,
        head: typeof prState.head === 'string' ? prState.head : null,
        phase: typeof prState.phase === 'string' ? prState.phase : null,
        checks: typeof prState.checks === 'string' ? prState.checks : null,
        runId: Number.isInteger(prState.runId) ? prState.runId : null,
    };
}

function sanitizeBudget(budget) {
    if (!budget) return {
        status: 'within-budget',
        governanceRatio: 0,
        remediationRatio: 0,
    };
    return {
        status: budget.status === 'budget-exceeded' ? 'budget-exceeded' : 'within-budget',
        governanceRatio: Number.isFinite(budget.governanceRatio) ? budget.governanceRatio : 0,
        remediationRatio: Number.isFinite(budget.remediationRatio) ? budget.remediationRatio : 0,
    };
}

function buildGovernanceSnapshot(projectRoot, options = {}) {
    const git = readGitState(projectRoot, options);
    const active = readActiveContext(projectRoot, options);
    const planIR = readPlanIR(projectRoot, options);
    const portfolio = readPortfolio(projectRoot, options);
    const freezeLedger = readFreezeLedger(projectRoot, options);
    const budget = sanitizeBudget(options.budget);
    const isAncestor = typeof options.isAncestor === 'function'
        ? options.isAncestor(active.meta && active.meta.headSha, git.head)
        : defaultIsAncestor(projectRoot, active.meta && active.meta.headSha, git.head);
    const freezeEntries = Array.isArray(freezeLedger.entries) ? freezeLedger.entries : [];
    const freeze = {
        withinBudget: freezeEntries.filter(entry => entry && entry.remediation && entry.remediation.status !== 'budget-exceeded').length,
        exceeded: freezeEntries.filter(entry => entry && entry.remediation && entry.remediation.status === 'budget-exceeded').length,
    };
    const semantic = new Set();
    if (active.meta && active.meta.headSha && !isAncestor) semantic.add('CONTEXT_HEAD_NOT_ANCESTOR');
    if (active.meta && (
        active.meta.ahead !== null && active.meta.ahead !== git.ahead
        || active.meta.behind !== null && active.meta.behind !== git.behind
    )) semantic.add('CONTEXT_SYNC_COUNT_DRIFT');
    if (active.trajectoryHead && active.meta && active.meta.headSha
        && !String(active.meta.headSha).toLowerCase().startsWith(String(active.trajectoryHead).toLowerCase())) {
        semantic.add('TRAJECTORY_HEAD_DRIFT');
    }
    if (detectFocusPlanDrift(active.focus, planIR, options.focusPlanDrift)) semantic.add('FOCUS_PLAN_DRIFT');
    if (portfolio && portfolio.source && portfolio.source.portfolioSourceDrift) semantic.add('PORTFOLIO_SOURCE_DRIFT');
    if (freeze.exceeded > 0 || budget.status === 'budget-exceeded') semantic.add('REMEDIATION_BUDGET_EXCEEDED');
    const semanticFindings = FINDING_ORDER.filter(code => semantic.has(code));
    return {
        version: SNAPSHOT_VERSION,
        observedAt: observedAt(options),
        git,
        context: {
            meta: {
                headSha: active.meta && active.meta.headSha || null,
                upstreamSha: active.meta && active.meta.upstreamSha || null,
                ahead: active.meta && Number.isInteger(active.meta.ahead) ? active.meta.ahead : null,
                behind: active.meta && Number.isInteger(active.meta.behind) ? active.meta.behind : null,
            },
            headAncestor: Boolean(isAncestor),
            focusDigest: sha256(active.focus),
            backlogIds: Array.isArray(active.backlogIds) ? [...active.backlogIds] : [],
            trajectoryHead: active.trajectoryHead || null,
        },
        planning: {
            specs: Array.isArray(planIR.specs) ? planIR.specs.length : 0,
            plans: Array.isArray(planIR.plans) ? planIR.plans.length : 0,
            tasks: Array.isArray(planIR.tasks) ? planIR.tasks.length : 0,
            findingCodes: findingCodes(planIR),
            portfolioSourceDrift: Boolean(portfolio && portfolio.source && portfolio.source.portfolioSourceDrift),
        },
        freeze,
        pr: sanitizePrState(options.prState),
        budget,
        semanticFindings,
        transitions: [],
        recommendations: semanticFindings.map(code => RECOMMENDATION_BY_FINDING[code]),
    };
}

function transition(code, from, to) {
    return { code, from: from === undefined ? null : from, to: to === undefined ? null : to };
}

function compareGovernanceSnapshots(previous, current) {
    if (!previous || !current) return [];
    const found = new Map();
    if (previous.git && current.git && previous.git.branch !== current.git.branch) {
        found.set('branch-changed', transition('branch-changed', previous.git.branch, current.git.branch));
    }
    if (previous.git && current.git && previous.git.head !== current.git.head) {
        found.set('head-advanced', transition('head-advanced', previous.git.head, current.git.head));
    }
    if (current.git && current.git.merge && !(previous.git && previous.git.merge)) {
        found.set('merge-observed', transition('merge-observed', false, true));
    }
    if ((previous.pr && previous.pr.phase) !== (current.pr && current.pr.phase)) {
        found.set('pr-phase-changed', transition(
            'pr-phase-changed',
            previous.pr && previous.pr.phase,
            current.pr && current.pr.phase,
        ));
    }
    if ((previous.pr && previous.pr.checks) !== (current.pr && current.pr.checks)) {
        found.set('ci-state-changed', transition(
            'ci-state-changed',
            previous.pr && previous.pr.checks,
            current.pr && current.pr.checks,
        ));
    }
    const previousFreeze = Number(previous.freeze && previous.freeze.withinBudget || 0)
        + Number(previous.freeze && previous.freeze.exceeded || 0);
    const currentFreeze = Number(current.freeze && current.freeze.withinBudget || 0)
        + Number(current.freeze && current.freeze.exceeded || 0);
    if (currentFreeze > previousFreeze) {
        found.set('freeze-added', transition('freeze-added', previousFreeze, currentFreeze));
    }
    if (previous.budget && current.budget
        && previous.budget.status !== 'budget-exceeded'
        && current.budget.status === 'budget-exceeded') {
        found.set('budget-crossed', transition('budget-crossed', previous.budget.status, current.budget.status));
    }
    return TRANSITION_ORDER.filter(code => found.has(code)).map(code => found.get(code));
}

function writeGovernanceSnapshot(projectRoot, snapshot, options = {}) {
    const snapshotPath = path.join(projectRoot, SNAPSHOT_RELATIVE_PATH);
    try {
        (options.mkdir || fs.mkdirSync)(path.dirname(snapshotPath), { recursive: true });
        (options.writeFile || fs.writeFileSync)(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
        return { ok: true, path: snapshotPath };
    } catch (error) {
        return { ok: false, error: error && error.message ? error.message : String(error) };
    }
}

function recordGovernanceSnapshot(projectRoot, options = {}) {
    const snapshotPath = path.join(projectRoot, SNAPSHOT_RELATIVE_PATH);
    const previous = readJsonSafe(snapshotPath, null);
    const snapshot = buildGovernanceSnapshot(projectRoot, options);
    snapshot.transitions = compareGovernanceSnapshots(previous, snapshot);
    const write = writeGovernanceSnapshot(projectRoot, snapshot, options);
    return { snapshot, write };
}

module.exports = {
    SNAPSHOT_VERSION,
    SNAPSHOT_RELATIVE_PATH,
    DEFAULT_BUDGET_CONFIG,
    buildGovernanceSnapshot,
    compareGovernanceSnapshots,
    writeGovernanceSnapshot,
    recordGovernanceSnapshot,
    loadGovernanceBudgetConfig,
    buildGovernanceBudget,
    // The ONE live-git reader and the ONE ancestry probe. The takeover collector
    // imports these rather than growing a second implementation that could
    // disagree with the observer about what "in sync" means.
    readGitState,
    probeAncestry,
};
