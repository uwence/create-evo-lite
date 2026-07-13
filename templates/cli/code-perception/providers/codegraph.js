'use strict';

// CodeGraph adapter — skeleton + detection. create(options) builds a stateful
// provider instance (config + capabilityHealth Map); check() runs a
// detection ladder with a fingerprint identity lock (version range + help
// command set) so a same-named-but-foreign CLI is rejected rather than
// adapt-guessed; getStatus() translates the real `status --json` shape into
// a ProviderStatus. Query method bodies are STUBS here (Task cg-queries
// fills them) but are present so validateProvider passes.
//
// NEVER throws: every failure path returns a structured availability/status
// object instead. NEVER uses process.cwd() — the caller's context.projectRoot
// is the only root this module will spawn against. NO .codegraph DB access,
// NO auto-install, NO auto-index, NO project mutation.

const crypto = require('crypto');
const { FRESHNESS, DIRTY, COMPAT, INDEX, CAPABILITY_KEYS } = require('../provider-contract');
const { runCodegraph } = require('./codegraph-exec');

const PROVIDER_ID = 'provider:codegraph';
const PROVIDER_NAME = 'CodeGraph Provider';
const ADAPTER_VERSION = '0.1.0';
const MIN_PROVIDER_VERSION = '1.0.0';
const TESTED_PROVIDER_VERSIONS = Object.freeze(['1.4.1']);
// Renamed from the brief's bare `COMPAT` to avoid clashing with the
// COMPAT enum imported above.
const COMPAT_RANGE = Object.freeze({ min: '1.0.0', maxExclusive: '2.0.0' });
const REQUIRED_HELP_COMMANDS = Object.freeze([
    'status', 'files', 'query', 'explore', 'node', 'callers', 'callees', 'impact', 'affected',
]);

// Base (config-independent) capability truth table. modules=false: upstream
// 1.4.1 `files --json` carries no module membership (proven by cg-fixtures).
const BASE_CAPABILITIES = Object.freeze({
    files: true, symbols: true, source: true, callers: true, callees: true,
    impact: true, affectedTests: true,
    modules: false, semanticSearch: false, trace: false, flows: false,
    summaries: false, layers: false, tours: false, incrementalIndex: false,
});

function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function diag(code, message) {
    return { code, message: message || code };
}

function notImplementedDiag(method) {
    return diag('not-implemented', `${method} is filled by cg-queries`);
}

// Lenient semver extraction: tolerant of surrounding text/whitespace/leading
// 'v', as long as a #.#.# run is present somewhere in the string.
function parseSemver(text) {
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(text === undefined || text === null ? '' : text));
    if (!m) {
        return null;
    }
    return {
        major: parseInt(m[1], 10),
        minor: parseInt(m[2], 10),
        patch: parseInt(m[3], 10),
        raw: `${m[1]}.${m[2]}.${m[3]}`,
    };
}

function compareSemver(a, b) {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    return a.patch - b.patch;
}

// [min, maxExclusive)
function inCompatRange(parsedVersion) {
    const min = parseSemver(COMPAT_RANGE.min);
    const max = parseSemver(COMPAT_RANGE.maxExclusive);
    return compareSemver(parsedVersion, min) >= 0 && compareSemver(parsedVersion, max) < 0;
}

function buildCapabilities(capabilityHealth) {
    const capabilities = {};
    for (const key of CAPABILITY_KEYS) {
        const base = BASE_CAPABILITIES[key] === true;
        const health = capabilityHealth && typeof capabilityHealth.get === 'function'
            ? capabilityHealth.get(key)
            : undefined;
        const disabled = !!(health && health.disabled);
        capabilities[key] = base && !disabled;
    }
    return capabilities;
}

// Stored create()-time options are primary. context.providerConfig may only
// fill in fields the caller did NOT explicitly pass to create() — it never
// overrides an explicit create() option.
function resolveConfig(config, explicitKeys, context) {
    const override = context && isPlainObject(context.providerConfig) ? context.providerConfig : {};
    return {
        executable: !explicitKeys.has('executable') && typeof override.executable === 'string'
            ? override.executable : config.executable,
        prefixArgs: !explicitKeys.has('prefixArgs') && Array.isArray(override.prefixArgs)
            ? override.prefixArgs : config.prefixArgs,
        timeoutMs: !explicitKeys.has('timeoutMs') && typeof override.timeoutMs === 'number'
            ? override.timeoutMs : config.timeoutMs,
        allowNetwork: !explicitKeys.has('allowNetwork') && typeof override.allowNetwork === 'boolean'
            ? override.allowNetwork : config.allowNetwork,
    };
}

function safeUnavailable(overrides) {
    return Object.assign({
        available: false,
        ready: false,
        installed: false,
        indexState: INDEX.UNKNOWN,
    }, overrides);
}

function safeUnknownStatus(capabilities, diagnostics) {
    return {
        providerId: PROVIDER_ID,
        adapterVersion: ADAPTER_VERSION,
        available: false,
        ready: false,
        indexState: INDEX.UNKNOWN,
        dirty: DIRTY.UNKNOWN,
        freshness: FRESHNESS.UNKNOWN,
        compatibility: COMPAT.UNKNOWN,
        capabilities,
        diagnostics: diagnostics || [],
    };
}

// --- check() detection ladder -----------------------------------------

async function runCheck(config, explicitKeys, context) {
    try {
        const projectRoot = context && context.projectRoot;
        const cfg = resolveConfig(config, explicitKeys, context);
        const spawnBase = {
            executable: cfg.executable, prefixArgs: cfg.prefixArgs,
            cwd: projectRoot, timeoutMs: cfg.timeoutMs, allowNetwork: cfg.allowNetwork,
        };

        // Step 1: version probe. A spawn failure (missing exe) is the
        // "not installed" case; any other version-command failure is still
        // treated as not-installed/unavailable since identity can't be
        // established.
        const versionResult = await runCodegraph({ ...spawnBase, subcommand: 'version', args: [] });
        if (!versionResult.ok) {
            const spawnFailed = versionResult.diagnostics.some((d) => d.code === 'spawn-failed');
            return safeUnavailable({
                installed: !spawnFailed,
                indexState: INDEX.MISSING,
                reason: spawnFailed ? 'codegraph executable not found or failed to run' : 'codegraph version command failed',
                suggestedAction: 'install @colbymchenry/codegraph@1.x',
                diagnostics: versionResult.diagnostics,
            });
        }

        // Step 2: parse a semver out of the version output.
        const parsedVersion = parseSemver(versionResult.stdout);
        if (!parsedVersion) {
            return safeUnavailable({
                installed: true,
                indexState: INDEX.UNKNOWN,
                reason: 'codegraph version unrecognized',
            });
        }

        // Step 3: fingerprint identity lock — version range. NO adapt-guess.
        if (!inCompatRange(parsedVersion)) {
            return safeUnavailable({
                installed: true,
                indexState: INDEX.UNKNOWN,
                reason: 'codegraph identity/version mismatch',
                providerVersion: parsedVersion.raw,
            });
        }

        // Step 4: fingerprint identity lock — help command set.
        const helpResult = await runCodegraph({ ...spawnBase, subcommand: 'help', args: [] });
        const helpOk = helpResult.ok && REQUIRED_HELP_COMMANDS.every((cmd) => helpResult.stdout.includes(cmd));
        if (!helpOk) {
            return safeUnavailable({
                installed: true,
                indexState: INDEX.UNKNOWN,
                reason: 'codegraph identity/version mismatch (help command set)',
                providerVersion: parsedVersion.raw,
            });
        }

        // Step 5: status probe — index presence, never DB access.
        const statusResult = await runCodegraph({
            ...spawnBase, subcommand: 'status', args: [String(projectRoot), '--json'],
        });
        let statusJson = null;
        if (statusResult.ok) {
            try {
                statusJson = JSON.parse(statusResult.stdout);
            } catch (err) {
                statusJson = null;
            }
        }
        if (!statusResult.ok || !isPlainObject(statusJson) || statusJson.initialized !== true || !isPlainObject(statusJson.index)) {
            return {
                available: true,
                ready: false,
                installed: true,
                indexState: INDEX.MISSING,
                providerVersion: parsedVersion.raw,
                suggestedAction: 'run: codegraph init',
            };
        }

        // Step 6: valid, indexed status.
        return {
            available: true,
            ready: true,
            installed: true,
            indexState: INDEX.READY,
            providerVersion: parsedVersion.raw,
        };
    } catch (err) {
        return safeUnavailable({
            reason: 'unexpected error during check',
            diagnostics: [diag('check-failed', err && err.message ? err.message : String(err))],
        });
    }
}

// --- getStatus() STATUS translator --------------------------------------

function computeIndexState(s) {
    const hasIndex = isPlainObject(s.index);
    if (s.initialized !== true || !hasIndex) {
        return INDEX.MISSING;
    }
    if (s.index.state === 'complete' && !s.index.reindexRecommended) {
        return INDEX.READY;
    }
    if (s.index.reindexRecommended || s.index.state === 'stale') {
        return INDEX.STALE;
    }
    return INDEX.UNKNOWN;
}

function computeFreshness(s) {
    const hasIndex = isPlainObject(s.index);
    if (!hasIndex) {
        return FRESHNESS.UNKNOWN;
    }
    if (s.index.reindexRecommended || s.worktreeMismatch || s.index.state !== 'complete') {
        return FRESHNESS.STALE;
    }
    return FRESHNESS.FRESH;
}

function computeDirty(s) {
    if (!isPlainObject(s.pendingChanges)) {
        return DIRTY.UNKNOWN;
    }
    const { added = 0, modified = 0, removed = 0 } = s.pendingChanges;
    const total = (Number(added) || 0) + (Number(modified) || 0) + (Number(removed) || 0);
    return total > 0 ? DIRTY.DIRTY : DIRTY.CLEAN;
}

function computeCompatibility(rawVersion) {
    const parsed = parseSemver(rawVersion);
    if (!parsed) {
        return COMPAT.UNKNOWN;
    }
    if (TESTED_PROVIDER_VERSIONS.includes(parsed.raw)) {
        return COMPAT.SUPPORTED;
    }
    if (inCompatRange(parsed)) {
        return COMPAT.UNTESTED;
    }
    return COMPAT.UNSUPPORTED;
}

function computeSymbolCount(s) {
    if (!isPlainObject(s.nodesByKind)) {
        return undefined;
    }
    let sum = 0;
    for (const [kind, count] of Object.entries(s.nodesByKind)) {
        if (kind === 'file') continue;
        if (typeof count === 'number' && Number.isFinite(count)) sum += count;
    }
    return sum;
}

function schemaFingerprint(s) {
    const keys = Object.keys(s).sort();
    return crypto.createHash('sha256').update(JSON.stringify(keys)).digest('hex');
}

async function runGetStatus(instance, config, explicitKeys, context) {
    const capabilities = buildCapabilities(instance.capabilityHealth);
    try {
        const projectRoot = context && context.projectRoot;
        const cfg = resolveConfig(config, explicitKeys, context);

        const statusResult = await runCodegraph({
            executable: cfg.executable, prefixArgs: cfg.prefixArgs, subcommand: 'status',
            args: [String(projectRoot), '--json'], cwd: projectRoot,
            timeoutMs: cfg.timeoutMs, allowNetwork: cfg.allowNetwork,
        });

        let s = null;
        if (statusResult.ok) {
            try {
                s = JSON.parse(statusResult.stdout);
            } catch (err) {
                s = null;
            }
        }

        if (!statusResult.ok || !isPlainObject(s)) {
            return safeUnknownStatus(capabilities, [diag('status-failed', 'codegraph status probe failed or returned invalid JSON')]);
        }

        const fingerprint = schemaFingerprint(s);
        instance.observedSchemaFingerprint = fingerprint;

        const indexState = computeIndexState(s);
        const status = {
            providerId: PROVIDER_ID,
            adapterVersion: ADAPTER_VERSION,
            providerVersion: s.version,
            available: !!s.initialized,
            ready: s.initialized === true && isPlainObject(s.index) && s.index.state === 'complete',
            indexState,
            dirty: computeDirty(s),
            freshness: computeFreshness(s),
            compatibility: computeCompatibility(s.version),
            fileCount: s.fileCount,
            edgeCount: s.edgeCount,
            lastIndexedAt: s.lastIndexed,
            capabilities,
            observedSchemaFingerprint: fingerprint,
            diagnostics: [],
        };
        const symbolCount = computeSymbolCount(s);
        if (symbolCount !== undefined) {
            status.symbolCount = symbolCount;
        }
        return status;
    } catch (err) {
        return safeUnknownStatus(capabilities, [diag('status-failed', err && err.message ? err.message : String(err))]);
    }
}

// --- create() ------------------------------------------------------------

function create(options) {
    const opts = isPlainObject(options) ? options : {};
    const explicitKeys = new Set(Object.keys(opts));
    const config = {
        executable: typeof opts.executable === 'string' ? opts.executable : 'codegraph',
        prefixArgs: Array.isArray(opts.prefixArgs) ? opts.prefixArgs : [],
        timeoutMs: typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 15000,
        allowNetwork: opts.allowNetwork === true,
    };
    const capabilityHealth = new Map();
    const capabilities = buildCapabilities(capabilityHealth);

    const provider = {
        id: PROVIDER_ID,
        name: PROVIDER_NAME,
        adapterVersion: ADAPTER_VERSION,
        capabilities,
        capabilityHealth,
        observedSchemaFingerprint: null,

        async check(context) {
            return runCheck(config, explicitKeys, context);
        },

        async getStatus(context) {
            return runGetStatus(provider, config, explicitKeys, context);
        },

        // --- STUBS: filled by Task cg-queries. Present only so
        // validateProvider's capability-method-presence check passes. Each
        // returns a minimal empty normalized shape + a not-implemented
        // diagnostic, and never throws.
        async getFiles() {
            return { files: [], diagnostics: [notImplementedDiag('getFiles')] };
        },
        async search(context, query) {
            return { query: typeof query === 'string' ? query : '', matches: [], diagnostics: [notImplementedDiag('search')] };
        },
        async getEntity() {
            return { entity: null, diagnostics: [notImplementedDiag('getEntity')] };
        },
        async getCallers() {
            return { relationships: [], diagnostics: [notImplementedDiag('getCallers')] };
        },
        async getCallees() {
            return { relationships: [], diagnostics: [notImplementedDiag('getCallees')] };
        },
        async impact() {
            return {
                target: null, upstream: [], downstream: [], affectedTests: [],
                risk: 'unknown', diagnostics: [notImplementedDiag('impact')],
            };
        },
        async getAffectedTests() {
            return { affectedTests: [], diagnostics: [notImplementedDiag('getAffectedTests')] };
        },
        async explore() {
            return { results: [], diagnostics: [notImplementedDiag('explore')] };
        },
    };

    return provider;
}

module.exports = {
    create,
    PROVIDER_ID,
    ADAPTER_VERSION,
    MIN_PROVIDER_VERSION,
    TESTED_PROVIDER_VERSIONS,
    COMPAT_RANGE,
    REQUIRED_HELP_COMMANDS,
};
