'use strict';

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
    if (!['draft', 'ready', 'merged'].includes(raw.phase)) {
        fail('PR_STATE_BLOCK_INVALID', 'phase must be draft, ready, or merged');
    }
    if (!['pending', 'success'].includes(raw.checks)) {
        fail('PR_STATE_BLOCK_INVALID', 'checks must be pending or success');
    }
    if (raw.phase === 'merged' && raw.checks !== 'success') {
        fail('PR_STATE_SEMANTIC_INVALID', 'phase merged requires checks success');
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

    return {
        schema: 1,
        base: raw.base,
        baseSha: raw.baseSha,
        head: raw.head,
        headSha: raw.headSha,
        commits: parseBoundedInteger(raw.commits, 'commits', 1),
        changedFiles: parseBoundedInteger(raw.changedFiles, 'changedFiles', 0),
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
    if (state === 'CLOSED' && draft === false && merged === true && typeof mergedAt === 'string' && mergedAt.length > 0) return 'merged';
    if (state === 'CLOSED' && draft === false && merged === false && mergedAt === null) return 'closed';
    fail('OBSERVED_PHASE_INVALID', 'PR lifecycle fields are contradictory');
}

function normalizeChecks(run) {
    if (!run || typeof run !== 'object' || typeof run.status !== 'string') {
        fail('WORKFLOW_RUN_RESPONSE_INVALID', 'workflow run status is malformed');
    }
    if ((run.status === 'queued' || run.status === 'in_progress') && run.conclusion === null) {
        return 'pending';
    }
    if (run.status === 'completed' && typeof run.conclusion === 'string' && run.conclusion.length > 0) {
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

module.exports = {
    PrStateError,
    validatePrNumber,
    parseExpectedBlock,
    normalizePhase,
    normalizeChecks,
    compareExpectedObserved,
    createReport,
};

