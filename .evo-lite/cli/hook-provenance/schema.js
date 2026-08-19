'use strict';
const crypto = require('crypto');

const KIND = 'evo-lite/hook-install-provenance';
const SCHEMA_VERSION = 1;

const PARTICIPATION = ['participating', 'non-participating'];

// C-2d: which producer authority may declare which participation.
const INTENT_SOURCES = {
    'scaffold-no-hooks': 'non-participating',
    'scaffold-default': 'participating',
    'hook-install-command': 'participating',
};

// There is deliberately no 'already-current': the installer always writes.
const INSTALL_REASONS = {
    realized: ['created-managed-hook', 'updated-managed-block', 'appended-managed-block'],
    unrealized: ['hooks-dir-missing', 'hooks-dir-not-directory', 'write-failed'],
    indeterminate: ['hooks-dir-unobservable', 'pre-write-observation-failed',
        'post-write-observation-failed'],
};

// chmod is present if and only if the write was ISSUED. These are the phase-1
// reasons — decided before any write was issued — so they carry none. Every other
// reason belongs to phase 2/3 and must carry one. Keying off the phase rather
// than off a list of "failure" reasons is the point: pre-write-observation-failed
// and post-write-observation-failed are both failures, and only the second
// followed a write.
const PRE_WRITE_REASONS = ['hooks-dir-missing', 'hooks-dir-not-directory',
    'hooks-dir-unobservable', 'pre-write-observation-failed'];
const LOCATOR_REASONS = {
    satisfied: [],
    'not-satisfied': ['active-hooks-dir-differs'],
    indeterminate: ['authority-query-unavailable', 'authority-query-failed', 'path-comparison-ambiguous'],
};
const EXECUTABLE_REASONS = {
    satisfied: [],
    'not-satisfied': ['predicate-reports-not-executable'],
    indeterminate: ['no-qualified-predicate', 'predicate-qualification-failed'],
};
const INTERPRETER_REASONS = {
    satisfied: [],
    'not-satisfied': ['incompatible-interpreter', 'syntax-rejected'],
    indeterminate: ['missing-shebang', 'ambiguous-interpreter', 'no-safe-parser'],
};
const COMPONENT_REASONS = {
    locator: LOCATOR_REASONS, executable: EXECUTABLE_REASONS, interpreter: INTERPRETER_REASONS,
};

const sha256 = (s) => 'sha256:' + crypto.createHash('sha256').update(s).digest('hex');
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;

// C-2b: the authoritative projection of `current` is participation ALONE.
// derivedFrom must not enter it — resultingCurrentDigest feeds event.id and
// derivedFrom equals event.id, so including it would close a cycle.
const currentDigest = (participation) => sha256(JSON.stringify([participation]));

const pick = (obj, ...keys) => {
    let cur = obj;
    for (const k of keys) {
        if (cur === null || cur === undefined) return null;
        cur = cur[k];
    }
    return cur === undefined ? null : cur;
};

// Fixed length, fixed order. Absent fields contribute null so the array length
// never varies with event kind. `id` and the whole of `diagnostic` are excluded.
function eventProjection(e) {
    return [
        KIND, SCHEMA_VERSION, pick(e, 'seq'), pick(e, 'recordedAt'),
        pick(e, 'intent', 'participation'), pick(e, 'intent', 'source'),
        pick(e, 'install', 'outcome'), pick(e, 'install', 'reason'),
        pick(e, 'install', 'targetPath'), pick(e, 'install', 'expectedBodyDigest'),
        pick(e, 'install', 'chmod', 'attempted'), pick(e, 'install', 'chmod', 'threw'),
        pick(e, 'runnability', 'verdict'),
        pick(e, 'runnability', 'locator', 'verdict'), pick(e, 'runnability', 'locator', 'reason'),
        pick(e, 'runnability', 'executable', 'verdict'), pick(e, 'runnability', 'executable', 'reason'),
        pick(e, 'runnability', 'interpreter', 'verdict'), pick(e, 'runnability', 'interpreter', 'reason'),
        pick(e, 'resultingCurrentDigest'),
    ];
}

const eventId = (e) => sha256(JSON.stringify(eventProjection(e)));

function aggregateRunnability(r) {
    const parts = [r.locator, r.executable, r.interpreter];
    if (parts.some(p => p && p.verdict === 'not-satisfied')) return 'not-satisfied';
    if (parts.some(p => !p || p.verdict === 'indeterminate')) return 'indeterminate';
    return 'satisfied';
}

function validateComponent(name, c, errors) {
    const allowed = COMPONENT_REASONS[name];
    if (!c || typeof c !== 'object') { errors.push(`${name} missing`); return; }
    if (!Object.prototype.hasOwnProperty.call(allowed, c.verdict)) {
        errors.push(`${name}.verdict invalid: ${c.verdict}`); return;
    }
    // reason is null if and only if the verdict is satisfied
    if (c.verdict === 'satisfied') {
        if (c.reason !== null) errors.push(`${name}.reason must be null when satisfied`);
        return;
    }
    if (!allowed[c.verdict].includes(c.reason)) {
        errors.push(`${name}.reason not permitted for ${c.verdict}: ${c.reason}`);
    }
}

// The ONE shape contract, used by producer and reader alike. A split contract
// lets a writer publish a document its own reader rejects
// (templates/cli/takeover-install.js:281).
//
// Scope is exactly three regions: top level, current, and the LAST event.
// Interior events are not inspected at all — tampering there degrades the audit
// trail by design and must not change the reader's state.
function validateHookProvenanceV1(raw) {
    const errors = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, errors: ['document is not an object'] };
    }
    if (raw.kind !== KIND) errors.push(`kind invalid: ${raw.kind}`);
    if (raw.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion invalid: ${raw.schemaVersion}`);

    const cur = raw.current;
    if (!cur || typeof cur !== 'object') errors.push('current missing');
    else {
        if (!PARTICIPATION.includes(cur.participation)) errors.push(`current.participation invalid: ${cur.participation}`);
        if (typeof cur.derivedFrom !== 'string' || !SHA256_RE.test(cur.derivedFrom)) errors.push('current.derivedFrom invalid');
        // The design deliberately DELETED current.digest: the reader recomputes
        // it from current.participation, and storing it would create a third
        // representation of one value with no new information and one new way to
        // disagree. Accepting it here would let that third representation back in
        // through the one component both writer and reader trust.
        if (cur.digest !== undefined) errors.push('current.digest must not exist');
    }

    if (!Array.isArray(raw.events) || raw.events.length === 0) {
        errors.push('events must be a non-empty array');
        return { ok: false, errors };
    }
    const last = raw.events[raw.events.length - 1];
    if (!last || typeof last !== 'object') {
        errors.push('last event is not an object');
        return { ok: false, errors };
    }

    if (!Number.isSafeInteger(last.seq) || last.seq < 1) errors.push(`seq invalid: ${last.seq}`);
    if (typeof last.recordedAt !== 'string') errors.push('recordedAt invalid');

    const intent = last.intent;
    if (!intent || typeof intent !== 'object') errors.push('intent missing');
    else {
        if (!PARTICIPATION.includes(intent.participation)) errors.push(`intent.participation invalid: ${intent.participation}`);
        if (!Object.prototype.hasOwnProperty.call(INTENT_SOURCES, intent.source)) {
            errors.push(`intent.source invalid: ${intent.source}`);
        } else if (INTENT_SOURCES[intent.source] !== intent.participation) {
            // C-2d
            errors.push(`intent incoherent: ${intent.source} cannot declare ${intent.participation}`);
        }
    }

    const participating = intent && intent.participation === 'participating';
    const inst = last.install;
    if (!participating) {
        if (inst !== undefined) errors.push('non-participating event must carry no install');
        if (last.runnability !== undefined) errors.push('non-participating event must carry no runnability');
    } else if (!inst || typeof inst !== 'object') {
        errors.push('participating event must carry install');
    } else {
        if (!Object.prototype.hasOwnProperty.call(INSTALL_REASONS, inst.outcome)) {
            errors.push(`install.outcome invalid: ${inst.outcome}`);
        } else if (!INSTALL_REASONS[inst.outcome].includes(inst.reason)) {
            errors.push(`install.reason not permitted for ${inst.outcome}: ${inst.reason}`);
        }
        if (typeof inst.targetPath !== 'string' || inst.targetPath.length === 0) {
            errors.push('install.targetPath required on every outcome');
        }
        // chmod is present if and only if the write was ISSUED — not "attempted".
        // An observation that fails before the write is reached has attempted
        // nothing, so pre-write-observation-failed belongs on the absent side.
        const preWrite = PRE_WRITE_REASONS.includes(inst.reason);
        if (preWrite) {
            if (inst.chmod !== undefined) errors.push(`install.chmod must be absent for ${inst.reason}`);
        } else if (!inst.chmod || typeof inst.chmod !== 'object') {
            errors.push('install.chmod required when the hook write was issued');
        } else if (inst.chmod.attempted !== true || typeof inst.chmod.threw !== 'boolean') {
            errors.push('install.chmod must be { attempted: true, threw: boolean }');
        }
        if (inst.outcome === 'realized') {
            if (typeof inst.expectedBodyDigest !== 'string' || !SHA256_RE.test(inst.expectedBodyDigest)) {
                errors.push('install.expectedBodyDigest required when realized');
            }
            if (!last.runnability || typeof last.runnability !== 'object') {
                errors.push('realized event must carry runnability');
            }
        } else if (last.runnability !== undefined) {
            errors.push(`${inst.outcome} event must carry no runnability`);
        }
        if (inst.expectedBodyDigest !== undefined && inst.outcome !== 'realized') {
            errors.push('install.expectedBodyDigest only when realized');
        }
    }

    if (last.runnability && typeof last.runnability === 'object') {
        // No top-level reason: the verdict is a mechanical aggregation, so any
        // top-level reason would duplicate whichever component drove it.
        if (last.runnability.reason !== undefined) errors.push('runnability must have no top-level reason');
        for (const name of ['locator', 'executable', 'interpreter']) {
            validateComponent(name, last.runnability[name], errors);
        }
        if (errors.length === 0 && last.runnability.verdict !== aggregateRunnability(last.runnability)) {
            // A stored verdict must never overrule the rule that produced it.
            errors.push('runnability.verdict does not equal the aggregation of its components');
        }
    }

    if (errors.length === 0) {
        if (last.id !== eventId(last)) errors.push('last event id does not recompute');
        if (cur.derivedFrom !== last.id) errors.push('C-2a: derivedFrom != last event id');
        if (last.resultingCurrentDigest !== currentDigest(cur.participation)) {
            errors.push('C-2b: resultingCurrentDigest != digest(current.participation)');
        }
        if (cur.participation !== intent.participation) {
            errors.push('C-2c: current.participation != last event intent.participation');
        }
    }

    return errors.length === 0 ? { ok: true, doc: raw } : { ok: false, errors };
}

module.exports = {
    KIND, SCHEMA_VERSION, PARTICIPATION, INTENT_SOURCES,
    INSTALL_REASONS, LOCATOR_REASONS, EXECUTABLE_REASONS, INTERPRETER_REASONS,
    currentDigest, eventProjection, eventId, aggregateRunnability, validateHookProvenanceV1,
};
