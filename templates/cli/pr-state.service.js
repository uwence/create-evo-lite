'use strict';

const { spawnSync } = require('child_process');

const BEGIN = '<!-- EVO-LITE:PR-STATE:BEGIN -->';
const END = '<!-- EVO-LITE:PR-STATE:END -->';
const SHA_RE = /^[0-9a-f]{40}$/;
const POSITIVE_DECIMAL_RE = /^[1-9][0-9]*$/;
const COUNT_DECIMAL_RE = /^(0|[1-9][0-9]*)$/;
const FIELD_ORDER = Object.freeze([
    'schema', 'base', 'baseSha', 'head', 'headSha',
    'commits', 'changedFiles', 'phase', 'checks',
]);
const CORE_FIELDS = Object.freeze([
    ['base', 'BASE_REF_DRIFT'],
    ['baseSha', 'BASE_SHA_DRIFT'],
    ['head', 'HEAD_REF_DRIFT'],
    ['headSha', 'HEAD_SHA_DRIFT'],
    ['commits', 'COMMIT_COUNT_DRIFT'],
    ['changedFiles', 'CHANGED_FILE_COUNT_DRIFT'],
    ['phase', 'PHASE_DRIFT'],
]);
const MAX_COUNT = 2147483647;

class PrStateError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'PrStateError';
        this.code = code;
        this.details = details;
    }
}

function fail(code, message, details) {
    throw new PrStateError(code, message, details);
}

function validatePrNumber(raw) {
    const text = raw === undefined || raw === null ? '' : String(raw);
    if (!POSITIVE_DECIMAL_RE.test(text)) {
        fail('PR_NUMBER_INVALID', 'PR number must be a canonical positive decimal integer');
    }
    const value = Number(text);
    if (!Number.isSafeInteger(value)) {
        fail('PR_NUMBER_INVALID', 'PR number exceeds the JavaScript safe-integer range');
    }
    return value;
}

function parseBoundedInteger(text, field, lowerBound) {
    const syntax = lowerBound === 0 ? COUNT_DECIMAL_RE : POSITIVE_DECIMAL_RE;
    if (!syntax.test(text)) {
        fail('PR_STATE_BLOCK_INVALID', `${field} must be a canonical decimal integer`);
    }
    const value = Number(text);
    if (!Number.isInteger(value) || value < lowerBound || value > MAX_COUNT) {
        fail('PR_STATE_BLOCK_INVALID', `${field} is outside the supported range`);
    }
    return value;
}

function validateBareValue(value, field) {
    if (!value || value !== value.trim() || /[\r\n\t]/.test(value)) {
        fail('PR_STATE_BLOCK_INVALID', `${field} must contain one bare, non-empty scalar`);
    }
    if (/^["']|["']$/.test(value) || value.startsWith('#') || value.includes(' #')) {
        fail('PR_STATE_BLOCK_INVALID', `${field} may not use comments or quoted-scalar syntax`);
    }
}

function parseExpectedBlock(body, { checkRefName } = {}) {
    if (typeof body !== 'string') {
        fail('PR_STATE_BLOCK_INVALID', 'PR body must be text');
    }
    const lines = body.split('\n').map(line => line.endsWith('\r') ? line.slice(0, -1) : line);
    const beginIndexes = [];
    const endIndexes = [];
    lines.forEach((line, index) => {
        if (line === BEGIN) beginIndexes.push(index);
        if (line === END) endIndexes.push(index);
    });
    if (beginIndexes.length !== 1 || endIndexes.length !== 1) {
        fail('PR_STATE_BLOCK_INVALID', 'PR body must contain exactly one standalone state-block marker pair');
    }
    const begin = beginIndexes[0];
    const end = endIndexes[0];
    if (begin >= end) {
        fail('PR_STATE_BLOCK_INVALID', 'PR state block markers are reversed');
    }
    const fieldLines = lines.slice(begin + 1, end);
    if (fieldLines.length !== FIELD_ORDER.length) {
        fail('PR_STATE_BLOCK_INVALID', 'PR state block must contain exactly nine field lines');
    }

    const raw = {};
    FIELD_ORDER.forEach((field, index) => {
        const line = fieldLines[index];
        if (!line || line.includes('\t') || line.startsWith('#')) {
            fail('PR_STATE_BLOCK_INVALID', `invalid ${field} line`);
        }
        const prefix = `${field}: `;
        if (!line.startsWith(prefix) || line.indexOf(': ') !== field.length) {
            fail('PR_STATE_BLOCK_INVALID', `expected field ${field} in frozen order`);
        }
        const value = line.slice(prefix.length);
        validateBareValue(value, field);
        raw[field] = value;
    });

    if (raw.schema !== '1') {
        fail('PR_STATE_BLOCK_INVALID', 'schema must be canonical decimal 1');
    }
    if (!SHA_RE.test(raw.baseSha) || !SHA_RE.test(raw.headSha)) {
        fail('PR_STATE_BLOCK_INVALID', 'baseSha and headSha must be full lowercase SHA-1 values');
    }
    const commits = parseBoundedInteger(raw.commits, 'commits', 1);
    const changedFiles = parseBoundedInteger(raw.changedFiles, 'changedFiles', 0);
    if (!['draft', 'ready', 'merged'].includes(raw.phase)) {
        fail('PR_STATE_BLOCK_INVALID', 'phase must be draft, ready, or merged');
    }
    if (!['pending', 'success'].includes(raw.checks)) {
        fail('PR_STATE_BLOCK_INVALID', 'checks must be pending or success');
    }

    if (typeof checkRefName === 'function') {
        for (const field of ['base', 'head']) {
            let valid = false;
            try {
                valid = checkRefName(raw[field]) === true;
            } catch (error) {
                valid = false;
            }
            if (!valid) {
                fail('PR_STATE_REF_INVALID', `${field} is not a valid branch name`, { field, value: raw[field] });
            }
        }
    }
    if (raw.phase === 'merged' && raw.checks !== 'success') {
        fail('PR_STATE_SEMANTIC_INVALID', 'phase merged requires checks success');
    }

    return {
        schema: 1,
        base: raw.base,
        baseSha: raw.baseSha,
        head: raw.head,
        headSha: raw.headSha,
        commits,
        changedFiles,
        phase: raw.phase,
        checks: raw.checks,
    };
}

function normalizePhase(pr) {
    if (!pr || typeof pr !== 'object') {
        fail('OBSERVED_PHASE_INVALID', 'PR lifecycle response is missing');
    }
    const state = typeof pr.state === 'string' ? pr.state.toUpperCase() : '';
    const { draft, merged, merged_at: mergedAt } = pr;
    if (typeof draft !== 'boolean' || typeof merged !== 'boolean') {
        fail('OBSERVED_PHASE_INVALID', 'PR lifecycle booleans are malformed');
    }
    if (state === 'OPEN' && draft === true && merged === false && mergedAt === null) return 'draft';
    if (state === 'OPEN' && draft === false && merged === false && mergedAt === null) return 'ready';
    if (state === 'CLOSED' && merged === true && typeof mergedAt === 'string' && mergedAt.length > 0) return 'merged';
    if (state === 'CLOSED' && merged === false && mergedAt === null) return 'closed';
    fail('OBSERVED_PHASE_INVALID', 'PR lifecycle fields are contradictory');
}

function normalizeChecks(run) {
    const completedConclusions = new Set([
        'success',
        'failure',
        'neutral',
        'cancelled',
        'skipped',
        'timed_out',
        'action_required',
        'stale',
        'startup_failure',
    ]);
    if (!run || typeof run !== 'object' || typeof run.status !== 'string') {
        fail('WORKFLOW_RUN_RESPONSE_INVALID', 'workflow run status is malformed');
    }
    if (['requested', 'queued', 'waiting', 'pending', 'in_progress'].includes(run.status) && run.conclusion === null) {
        return 'pending';
    }
    if (run.status === 'completed' && completedConclusions.has(run.conclusion)) {
        return run.conclusion === 'success' ? 'success' : 'failed';
    }
    fail('WORKFLOW_RUN_RESPONSE_INVALID', 'workflow run status/conclusion combination is invalid');
}

function finding(code, field, expected, observed) {
    return { code, field, expected, observed };
}

function compareExpectedObserved(expected, observed) {
    const findings = [];
    for (const [field, code] of CORE_FIELDS) {
        if (expected[field] !== observed[field]) {
            findings.push(finding(code, field, expected[field], observed[field]));
        }
    }
    if (observed.checks === 'missing') {
        findings.push(finding('CHECKS_MISSING', 'checks', expected.checks, observed.checks));
    } else if (observed.checks === 'failed') {
        findings.push(finding('CHECKS_FAILED', 'checks', expected.checks, observed.checks));
    } else if (observed.checks === 'pending' && expected.checks === 'success') {
        findings.push(finding('CHECKS_PENDING', 'checks', expected.checks, observed.checks));
    } else if (observed.checks === 'success' && expected.checks === 'pending') {
        findings.push(finding('CHECKS_EXPECTATION_DRIFT', 'checks', expected.checks, observed.checks));
    }
    return findings;
}

function createReport() {
    return {
        schema: 1,
        result: 'error',
        pr: {},
        expected: {},
        observed: {},
        findings: [],
        errors: [],
    };
}

function createDefaultCommandRunner() {
    return (executable, args, options = {}) => {
        const result = spawnSync(executable, args, {
            cwd: options.cwd,
            encoding: 'utf8',
            timeout: options.timeoutMs || 30000,
            windowsHide: true,
            shell: false,
        });
        return {
            status: result.status,
            stdout: result.stdout || '',
            stderr: result.stderr || '',
            error: result.error,
            signal: result.signal,
        };
    };
}

function runText(runCommand, executable, args, options, errorCode, acceptedStatuses = [0]) {
    let result;
    try {
        result = runCommand(executable, args, options);
    } catch (error) {
        throw new PrStateError(errorCode, error && error.message ? error.message : `${executable} failed`);
    }
    if (!result || typeof result !== 'object') {
        fail(errorCode, `${executable} returned no process result`);
    }
    if (result.error) {
        fail(errorCode, result.error.message || `${executable} failed to start`);
    }
    if (result.signal) {
        fail(errorCode, `${executable} terminated by signal ${result.signal}`);
    }
    if (!acceptedStatuses.includes(result.status)) {
        const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
        fail(errorCode, stderr || `${executable} exited with status ${result.status}`);
    }
    if (typeof result.stdout !== 'string') {
        fail(errorCode, `${executable} returned malformed stdout`);
    }
    return result.stdout.trim();
}

function runJson(runCommand, executable, args, options, errorCode, acceptedStatuses = [0]) {
    const text = runText(runCommand, executable, args, options, errorCode, acceptedStatuses);
    try {
        return JSON.parse(text);
    } catch (error) {
        fail(errorCode, `${executable} returned malformed JSON`);
    }
}

function validateRepositoryShape(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || typeof value.nameWithOwner !== 'string'
        || !/^[^/\s]+\/[^/\s]+$/.test(value.nameWithOwner)) {
        fail('GIT_REPOSITORY_REQUIRED', 'GitHub repository identity is malformed');
    }
    return value.nameWithOwner;
}

function validatePrShape(value) {
    const validSha = item => typeof item === 'string' && SHA_RE.test(item);
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !Number.isSafeInteger(value.number) || value.number < 1
        || typeof value.html_url !== 'string' || value.html_url.length === 0
        || typeof value.body !== 'string'
        || typeof value.state !== 'string'
        || typeof value.draft !== 'boolean'
        || typeof value.merged !== 'boolean'
        || !(value.merged_at === null || (typeof value.merged_at === 'string' && value.merged_at.length > 0))
        || !value.base || typeof value.base !== 'object'
        || typeof value.base.ref !== 'string' || !validSha(value.base.sha)
        || !value.head || typeof value.head !== 'object'
        || typeof value.head.ref !== 'string' || !validSha(value.head.sha)
        || !Number.isSafeInteger(value.commits) || value.commits < 1
        || !Number.isSafeInteger(value.changed_files) || value.changed_files < 0) {
        fail('PR_RESPONSE_INVALID', 'pull request response is malformed or incomplete');
    }
    return value;
}

function resolvePrWebIdentity(pr, repository, prNumber) {
    let url;
    try {
        url = new URL(pr.html_url);
    } catch (error) {
        fail('PR_RESPONSE_INVALID', 'pull request html_url is malformed');
    }
    const expectedPath = `/${repository}/pull/${prNumber}`;
    if (url.protocol !== 'https:'
        || url.username !== ''
        || url.password !== ''
        || url.search !== ''
        || url.hash !== ''
        || url.pathname !== expectedPath
        || !url.hostname) {
        fail('PR_RESPONSE_INVALID', 'pull request html_url does not match the resolved repository and PR');
    }
    return {
        githubHost: url.host,
        repositoryArg: `${url.host}/${repository}`,
    };
}

function validateWorkflowShape(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !Number.isSafeInteger(value.id) || value.id < 1
        || typeof value.path !== 'string') {
        fail('WORKFLOW_IDENTITY_INVALID', 'workflow response is malformed');
    }
    return value;
}

function validateRunShape(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !Number.isSafeInteger(value.id) || value.id < 1
        || typeof value.event !== 'string'
        || typeof value.head_sha !== 'string' || !SHA_RE.test(value.head_sha)
        || typeof value.status !== 'string'
        || !(value.conclusion === null || typeof value.conclusion === 'string')) {
        fail('WORKFLOW_RUN_RESPONSE_INVALID', 'workflow run response is malformed');
    }
    normalizeChecks(value);
    return value;
}

function validatePrCheckRows(value) {
    const fields = ['bucket', 'event', 'link', 'name', 'state', 'workflow'];
    if (!Array.isArray(value)
        || value.some(row => !row || typeof row !== 'object' || Array.isArray(row)
            || fields.some(field => typeof row[field] !== 'string'))) {
        fail('PR_CHECKS_RESPONSE_INVALID', 'pull request checks response is malformed');
    }
    return value;
}

function parseCanonicalPositiveInteger(value) {
    if (!/^[1-9][0-9]*$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

function extractPrScopedRunIds(rows, githubHost, repository) {
    const escapedRepository = repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pathPattern = new RegExp(`^/${escapedRepository}/actions/runs/([1-9][0-9]*)(?:/job/([1-9][0-9]*))?$`);
    const ids = new Set();
    for (const row of rows) {
        let url;
        try {
            url = new URL(row.link);
        } catch (error) {
            continue;
        }
        if (url.protocol !== 'https:'
            || url.username !== ''
            || url.password !== ''
            || url.host !== githubHost
            || url.search !== ''
            || url.hash !== '') continue;
        const match = pathPattern.exec(url.pathname);
        if (!match) continue;
        const runId = parseCanonicalPositiveInteger(match[1]);
        const jobId = match[2] === undefined ? 1 : parseCanonicalPositiveInteger(match[2]);
        if (runId !== null && jobId !== null) ids.add(runId);
    }
    return ids;
}

function resolveRepository(runCommand, cwd) {
    runText(runCommand, 'git', ['rev-parse', '--show-toplevel'], { cwd }, 'GIT_REPOSITORY_REQUIRED');
    const value = runJson(
        runCommand,
        'gh',
        ['repo', 'view', '--json', 'nameWithOwner'],
        { cwd },
        'GIT_REPOSITORY_REQUIRED'
    );
    return validateRepositoryShape(value);
}

function resolvePrNumber(prArg, repository, runCommand, cwd) {
    if (prArg !== undefined && prArg !== null && prArg !== '') {
        return validatePrNumber(prArg);
    }
    const branch = runText(
        runCommand,
        'git',
        ['symbolic-ref', '--quiet', '--short', 'HEAD'],
        { cwd },
        'PR_RESOLUTION_FAILED'
    );
    if (!branch) fail('PR_RESOLUTION_FAILED', 'current HEAD is detached');
    const value = runJson(
        runCommand,
        'gh',
        ['pr', 'view', branch, '--repo', repository, '--json', 'number'],
        { cwd },
        'PR_RESOLUTION_FAILED'
    );
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isSafeInteger(value.number)) {
        fail('PR_RESOLUTION_FAILED', 'current branch does not resolve to exactly one pull request');
    }
    try {
        return validatePrNumber(String(value.number));
    } catch (error) {
        fail('PR_RESOLUTION_FAILED', 'resolved pull request number is invalid');
    }
}

function observeCore(pr) {
    return {
        base: pr.base.ref,
        baseSha: pr.base.sha,
        head: pr.head.ref,
        headSha: pr.head.sha,
        commits: pr.commits,
        changedFiles: pr.changed_files,
        phase: normalizePhase(pr),
    };
}

function validateRunPage(value, expectedTotal) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !Number.isSafeInteger(value.total_count) || value.total_count < 0
        || !Array.isArray(value.workflow_runs)
        || (expectedTotal !== undefined && value.total_count !== expectedTotal)) {
        fail('WORKFLOW_RUN_RESPONSE_INVALID', 'workflow run pagination response is inconsistent');
    }
    value.workflow_runs.forEach(validateRunShape);
    return value;
}

function observeChecks({ repository, repositoryArg, githubHost, prNumber, headSha, runCommand, cwd }) {
    const workflow = validateWorkflowShape(runJson(
        runCommand,
        'gh',
        ['api', '--method', 'GET', `repos/${repository}/actions/workflows/release-gate.yml`],
        { cwd },
        'WORKFLOW_QUERY_FAILED'
    ));
    if (workflow.path !== '.github/workflows/release-gate.yml') {
        fail('WORKFLOW_IDENTITY_INVALID', 'release-gate workflow path does not match the frozen identity');
    }

    let page = 1;
    let totalCount;
    let fetched = 0;
    const runs = [];
    while (totalCount === undefined || fetched < totalCount) {
        const value = validateRunPage(runJson(
            runCommand,
            'gh',
            [
                'api', '--method', 'GET', `repos/${repository}/actions/workflows/${workflow.id}/runs`,
                '-f', 'event=pull_request', '-f', `head_sha=${headSha}`,
                '-f', 'per_page=100', '-f', `page=${page}`,
            ],
            { cwd },
            'WORKFLOW_RUN_QUERY_FAILED'
        ), totalCount);
        if (totalCount === undefined) totalCount = value.total_count;
        if (value.workflow_runs.length === 0 && fetched < totalCount) {
            fail('WORKFLOW_RUN_RESPONSE_INVALID', 'workflow run pagination ended before total_count');
        }
        runs.push(...value.workflow_runs);
        fetched += value.workflow_runs.length;
        if (fetched > totalCount) {
            fail('WORKFLOW_RUN_RESPONSE_INVALID', 'workflow run pagination exceeded total_count');
        }
        page += 1;
    }

    const candidates = runs.filter(run =>
        run.event === 'pull_request'
        && run.head_sha === headSha
    );
    if (candidates.length === 0) {
        return {
            checks: 'missing',
            diagnostics: { workflowId: workflow.id, workflowPath: workflow.path },
        };
    }

    const checkRows = validatePrCheckRows(runJson(
        runCommand,
        'gh',
        [
            'pr', 'checks', String(prNumber),
            '--repo', repositoryArg,
            '--json', 'bucket,event,link,name,state,workflow',
        ],
        { cwd },
        'PR_CHECKS_QUERY_FAILED',
        [0, 8]
    ));
    const prScopedRunIds = extractPrScopedRunIds(checkRows, githubHost, repository);
    const matching = candidates.filter(run => prScopedRunIds.has(run.id));
    const newest = matching.reduce((best, item) => !best || item.id > best.id ? item : best, null);
    if (!newest) {
        return {
            checks: 'missing',
            diagnostics: { workflowId: workflow.id, workflowPath: workflow.path },
        };
    }
    return {
        checks: normalizeChecks(newest),
        diagnostics: {
            workflowId: workflow.id,
            workflowPath: workflow.path,
            runId: newest.id,
            runUrl: typeof newest.html_url === 'string' ? newest.html_url : null,
            status: newest.status,
            conclusion: newest.conclusion,
            createdAt: typeof newest.created_at === 'string' ? newest.created_at : null,
            updatedAt: typeof newest.updated_at === 'string' ? newest.updated_at : null,
        },
    };
}

function errorEntry(error) {
    return {
        code: error instanceof PrStateError ? error.code : 'PR_STATE_UNEXPECTED_ERROR',
        message: error && error.message ? String(error.message) : 'unknown pr-state error',
    };
}

function finalizeReport(report) {
    report.result = report.errors.length > 0
        ? 'error'
        : report.findings.length > 0 ? 'drift' : 'pass';
    return report;
}

function validatePrState(prArg, options = {}) {
    const report = createReport();
    const cwd = options.cwd || process.cwd();
    const runCommand = options.runCommand || createDefaultCommandRunner();
    let validatedPrArg = prArg;
    try {
        if (prArg !== undefined && prArg !== null && prArg !== '') {
            validatedPrArg = String(validatePrNumber(prArg));
        }
        const repository = resolveRepository(runCommand, cwd);
        const prNumber = resolvePrNumber(validatedPrArg, repository, runCommand, cwd);
        const pr = validatePrShape(runJson(
            runCommand,
            'gh',
            ['api', '--method', 'GET', `repos/${repository}/pulls/${prNumber}`],
            { cwd },
            'PR_QUERY_FAILED'
        ));
        if (pr.number !== prNumber) {
            fail('PR_RESPONSE_INVALID', 'pull request response number does not match the target');
        }
        report.pr = { repository, number: prNumber, url: pr.html_url };
        report.expected = parseExpectedBlock(pr.body, {
            checkRefName(value) {
                let result;
                try {
                    result = runCommand('git', ['check-ref-format', '--branch', value], { cwd });
                } catch (error) {
                    return false;
                }
                return Boolean(result && result.status === 0 && !result.error && !result.signal);
            },
        });
        report.observed = observeCore(pr);
        report.findings = compareExpectedObserved(report.expected, {
            ...report.observed,
            checks: report.expected.checks,
        });

        try {
            const prWebIdentity = resolvePrWebIdentity(pr, repository, prNumber);
            const checks = observeChecks({
                repository,
                repositoryArg: prWebIdentity.repositoryArg,
                githubHost: prWebIdentity.githubHost,
                prNumber,
                headSha: report.observed.headSha,
                runCommand,
                cwd,
            });
            report.observed.checks = checks.checks;
            report.observed.diagnostics = checks.diagnostics;
            report.findings = compareExpectedObserved(report.expected, report.observed);
        } catch (error) {
            report.errors.push(errorEntry(error));
        }
    } catch (error) {
        report.errors.push(errorEntry(error));
    }
    return finalizeReport(report);
}


module.exports = {
    PrStateError,
    validatePrNumber,
    parseExpectedBlock,
    normalizePhase,
    normalizeChecks,
    compareExpectedObserved,
    createReport,
    createDefaultCommandRunner,
    validatePrState,
};
