'use strict';

// CodeGraph adapter — skeleton, detection, and query methods. create(options)
// builds a stateful provider instance (config + capabilityHealth Map);
// check() runs a detection ladder with a fingerprint identity lock (version
// range + help command set) so a same-named-but-foreign CLI is rejected
// rather than adapt-guessed; getStatus() translates the real `status --json`
// shape into a ProviderStatus. The 8 query methods (getFiles/search/
// getCallers/getCallees/impact/getAffectedTests/getEntity/explore) each run
// one mapped CodeGraph command, apply an explicit per-command translator into
// ../normalize's unified shapes, and never throw. getEntity/explore are
// OPAQUE (raw text + only explicitly-marked file:line tokens — no
// synthesized structural edges). A schema-invalid JSON response disables
// only that one capability via capabilityHealth; a later valid parse
// re-enables it.
//
// NEVER throws: every failure path returns a structured availability/status/
// query object instead. NEVER uses process.cwd() — the caller's
// context.projectRoot is the only root this module will spawn against. NO
// direct index-database-file access (only the CodeGraph CLI is ever
// spawned), NO auto-install, NO auto-index, NO project mutation.

const crypto = require('crypto');
const path = require('path');
const { FRESHNESS, DIRTY, COMPAT, INDEX, CAPABILITY_KEYS } = require('../provider-contract');
const { runCodegraph, safeOperand } = require('./codegraph-exec');
const {
    normalizeReference, normalizeSearchResult, normalizeRelationship, normalizeImpactResult,
} = require('../normalize');

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

// Upstream node.kind -> CodeReference kind (proven by the pinned 1.4.1
// fixtures). Anything outside this map (variable/constant/...) degrades to
// 'unknown' rather than being invented.
const KIND_MAP = Object.freeze({
    function: 'function',
    method: 'method',
    class: 'class',
    interface: 'interface',
    file: 'file',
    module: 'module',
});

function mapKind(rawKind) {
    return Object.prototype.hasOwnProperty.call(KIND_MAP, rawKind) ? KIND_MAP[rawKind] : 'unknown';
}

// Shared provenance stamp for the provider-structural query results (files,
// search, callers, callees, impact, affected). getEntity's opaque-enrichment
// path builds its own provenance since it reads prose, not a structural query.
const REF_PROVENANCE = Object.freeze({ method: 'provider-structural', authority: 'structural', confidence: 1 });

// Builds a CodeReference snapshot from the current ProviderStatus so every
// reference this adapter emits carries the provider's freshness/dirty state.
function refSnapshotFromStatus(status) {
    return {
        dirty: status && typeof status.dirty === 'string' ? status.dirty : DIRTY.UNKNOWN,
        freshness: status && typeof status.freshness === 'string' ? status.freshness : FRESHNESS.UNKNOWN,
    };
}

function symbolNameOf(symbolOrRef) {
    return typeof symbolOrRef === 'string'
        ? symbolOrRef
        : (symbolOrRef && (symbolOrRef.name || symbolOrRef.providerEntityId)) || '';
}

// The `symbol` arg becomes the SOURCE/target reference for callers/callees/
// impact. Upstream carries no id for the symbol itself in these commands, so
// providerEntityId falls back to the symbol name.
function buildSymbolRaw(symbolOrRef, snapshot) {
    const name = symbolNameOf(symbolOrRef);
    return { providerEntityId: name, name, kind: 'unknown', snapshot, provenance: { ...REF_PROVENANCE } };
}

// callers/callees/impact rows carry NO upstream id (proven by the pinned
// fixtures) — synthesize a stable providerEntityId from filePath+name so
// distinct rows still get distinct provider-scoped reference ids.
function buildRowRaw(row, snapshot) {
    const r = isPlainObject(row) ? row : {};
    const lineRange = Number.isFinite(r.startLine) ? [r.startLine, r.startLine] : undefined;
    return {
        providerEntityId: `${r.filePath}::${r.name}`,
        name: r.name,
        kind: mapKind(r.kind),
        filePath: r.filePath,
        lineRange,
        snapshot,
        provenance: { ...REF_PROVENANCE },
    };
}

// Extracts ONLY explicitly-marked file:line tokens from opaque prose. Never
// synthesizes structural edges from the text — this is the sole extraction
// rule for getEntity/explore.
const FILE_LINE_RE = /([^\s:]+):(\d+)/;
const FILE_LINE_RE_GLOBAL = /([^\s:]+):(\d+)/g;

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

    // Resolves the spawn-time config (executable/prefixArgs/timeoutMs/
    // allowNetwork + cwd) for a single call. Every query method below routes
    // through this so config resolution stays in one place. `cwd` is always
    // context.projectRoot — this module never uses process.cwd().
    function spawnBaseFor(context) {
        const projectRoot = context && context.projectRoot;
        const cfg = resolveConfig(config, explicitKeys, context);
        return {
            executable: cfg.executable, prefixArgs: cfg.prefixArgs, cwd: projectRoot,
            timeoutMs: cfg.timeoutMs, allowNetwork: cfg.allowNetwork,
        };
    }

    // Shared translator for getCallers/getCallees: both run against a
    // `{ symbol, callers|callees: [{name,kind,filePath,startLine}] }` shape
    // with NO row id, and both return `{ relationships, diagnostics }` —
    // symmetric with getFiles/search/impact's diagnostics channel. Never
    // throws — a schema-invalid response, spawn failure, or unsafe operand
    // all degrade to an empty relationships array with a diagnostic (the
    // schema-invalid case additionally disables the capability; a later
    // valid parse re-enables it).
    async function fetchCallersOrCallees(context, symbolOrRef, subcommand, capabilityKey, relKind) {
        try {
            const symName = symbolNameOf(symbolOrRef);
            const operand = safeOperand(symName);
            if (!operand.ok) {
                return { relationships: [], diagnostics: [diag('unsafe-argument', `unsafe ${subcommand} operand`)] };
            }
            const base = spawnBaseFor(context);
            const result = await runCodegraph({ ...base, subcommand, args: ['--json', '--', operand.value] });
            let parsed = null;
            if (result.ok) {
                try { parsed = JSON.parse(result.stdout); } catch (err) { parsed = null; }
            }
            const rows = (result.ok && isPlainObject(parsed) && Array.isArray(parsed[subcommand]))
                ? parsed[subcommand] : null;
            if (!rows) {
                const diagnostic = diag('schema-invalid', `${subcommand} response missing a ${subcommand} array`);
                capabilityHealth.set(capabilityKey, {
                    disabled: true, schemaFingerprint: null,
                    diagnostic,
                });
                return { relationships: [], diagnostics: [diagnostic] };
            }
            capabilityHealth.set(capabilityKey, { disabled: false });
            const status = await provider.getStatus(context);
            const snapshot = refSnapshotFromStatus(status);
            const symRaw = buildSymbolRaw(symbolOrRef, snapshot);
            const relationships = rows.map((row) => normalizeRelationship(PROVIDER_ID, symRaw, buildRowRaw(row, snapshot), relKind, 1));
            return { relationships, diagnostics: [] };
        } catch (err) {
            return { relationships: [], diagnostics: [diag('unexpected-error', err && err.message ? err.message : String(err))] };
        }
    }

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

        // getFiles(context, query) — `files --json -- <root>` returns
        // [{path,language,nodeCount,size}] with NO module membership
        // (modules=false, so moduleId is always null here). `query` is
        // accepted but unused — upstream `files` takes no filter operand.
        async getFiles(context) {
            try {
                const projectRoot = context && context.projectRoot;
                const base = spawnBaseFor(context);
                const result = await runCodegraph({ ...base, subcommand: 'files', args: ['--json', '--', String(projectRoot)] });
                let parsed = null;
                if (result.ok) {
                    try { parsed = JSON.parse(result.stdout); } catch (err) { parsed = null; }
                }
                if (!result.ok || !Array.isArray(parsed)) {
                    capabilityHealth.set('files', {
                        disabled: true, schemaFingerprint: null,
                        diagnostic: diag('schema-invalid', 'files response was not a JSON array'),
                    });
                    const status = await provider.getStatus(context);
                    return { provider: status, files: [], diagnostics: [diag('schema-invalid', 'files response was not a JSON array')] };
                }
                capabilityHealth.set('files', { disabled: false });
                const status = await provider.getStatus(context);
                const snapshot = refSnapshotFromStatus(status);
                const files = parsed.map((f) => {
                    const filePath = f && f.path;
                    const raw = {
                        providerEntityId: filePath, name: path.basename(String(filePath || '')), kind: 'file',
                        filePath, snapshot, provenance: { ...REF_PROVENANCE },
                    };
                    return {
                        reference: normalizeReference(PROVIDER_ID, raw),
                        moduleId: null,
                        declaredByTaskIds: [],
                        changed: false,
                    };
                });
                return { provider: status, files, diagnostics: [] };
            } catch (err) {
                return { provider: null, files: [], diagnostics: [diag('unexpected-error', err && err.message ? err.message : String(err))] };
            }
        },

        // search(context, query) — `query --json -- <query>` returns
        // [{node:{id,kind,name,qualifiedName,filePath,startLine,endLine,signature,...},score,highlights}].
        // The upstream node id is preserved as providerEntityId so distinct
        // nodes hash to distinct reference ids.
        async search(context, query) {
            const q = typeof query === 'string' ? query : '';
            try {
                const operand = safeOperand(q);
                if (!operand.ok) {
                    const status = await provider.getStatus(context);
                    return normalizeSearchResult(status, {
                        query: q, matches: [], diagnostics: [diag('unsafe-argument', 'unsafe search operand')],
                    });
                }
                const base = spawnBaseFor(context);
                const result = await runCodegraph({ ...base, subcommand: 'query', args: ['--json', '--', operand.value] });
                let parsed = null;
                if (result.ok) {
                    try { parsed = JSON.parse(result.stdout); } catch (err) { parsed = null; }
                }
                if (!result.ok || !Array.isArray(parsed)) {
                    capabilityHealth.set('symbols', {
                        disabled: true, schemaFingerprint: null,
                        diagnostic: diag('schema-invalid', 'query response was not a JSON array'),
                    });
                    const status = await provider.getStatus(context);
                    return normalizeSearchResult(status, {
                        query: q, matches: [], diagnostics: [diag('schema-invalid', 'query response was not a JSON array')],
                    });
                }
                capabilityHealth.set('symbols', { disabled: false });
                const status = await provider.getStatus(context);
                const snapshot = refSnapshotFromStatus(status);
                const raws = parsed.map((entry) => {
                    const node = isPlainObject(entry) && isPlainObject(entry.node) ? entry.node : {};
                    const lineRange = (Number.isFinite(node.startLine) && Number.isFinite(node.endLine))
                        ? [node.startLine, node.endLine] : undefined;
                    return {
                        providerEntityId: node.id, name: node.name, qualifiedName: node.qualifiedName,
                        kind: mapKind(node.kind), filePath: node.filePath, lineRange,
                        signature: node.signature, snapshot, provenance: { ...REF_PROVENANCE },
                    };
                });
                return normalizeSearchResult(status, { query: q, matches: raws, diagnostics: [] });
            } catch (err) {
                return { query: q, provider: null, matches: [], diagnostics: [diag('unexpected-error', err && err.message ? err.message : String(err))] };
            }
        },

        // getCallers/getCallees(context, symbolOrRef) — see fetchCallersOrCallees.
        async getCallers(context, symbolOrRef) {
            return fetchCallersOrCallees(context, symbolOrRef, 'callers', 'callers', 'called_by');
        },
        async getCallees(context, symbolOrRef) {
            return fetchCallersOrCallees(context, symbolOrRef, 'callees', 'callees', 'calls');
        },

        // impact(context, symbolOrRef) — `impact --json -- <symbol>` returns
        // {symbol,depth,nodeCount,edgeCount,affected:[{name,kind,filePath,startLine}]}.
        // CodeGraph's impact command gives downstream dependents only —
        // upstream and affectedTests are not part of this command and stay
        // empty (affectedTests comes from getAffectedTests()).
        async impact(context, symbolOrRef) {
            try {
                const symName = symbolNameOf(symbolOrRef);
                const operand = safeOperand(symName);
                if (!operand.ok) {
                    const status = await provider.getStatus(context);
                    return normalizeImpactResult(status, {
                        target: null, upstream: [], downstream: [], affectedTests: [],
                        diagnostics: [diag('unsafe-argument', 'unsafe impact operand')],
                    });
                }
                const base = spawnBaseFor(context);
                const result = await runCodegraph({ ...base, subcommand: 'impact', args: ['--json', '--', operand.value] });
                let parsed = null;
                if (result.ok) {
                    try { parsed = JSON.parse(result.stdout); } catch (err) { parsed = null; }
                }
                if (!result.ok || !isPlainObject(parsed) || !Array.isArray(parsed.affected)) {
                    capabilityHealth.set('impact', {
                        disabled: true, schemaFingerprint: null,
                        diagnostic: diag('schema-invalid', 'impact response missing an affected array'),
                    });
                    const status = await provider.getStatus(context);
                    return normalizeImpactResult(status, {
                        target: null, upstream: [], downstream: [], affectedTests: [],
                        diagnostics: [diag('schema-invalid', 'impact response missing an affected array')],
                    });
                }
                capabilityHealth.set('impact', { disabled: false });
                const status = await provider.getStatus(context);
                const snapshot = refSnapshotFromStatus(status);
                const targetRaw = buildSymbolRaw(symbolOrRef, snapshot);
                const downstreamRaws = parsed.affected.map((row) => buildRowRaw(row, snapshot));
                return normalizeImpactResult(status, {
                    target: targetRaw, upstream: [], downstream: downstreamRaws, affectedTests: [],
                    depth: parsed.depth, risk: 'unknown', diagnostics: [],
                });
            } catch (err) {
                return {
                    target: null, provider: null, upstream: [], downstream: [], affectedTests: [],
                    risk: 'unknown', diagnostics: [diag('unexpected-error', err && err.message ? err.message : String(err))],
                };
            }
        },

        // getAffectedTests(context, {files}) — `affected --json -- <files...>`
        // returns {changedFiles,affectedTests,totalDependentsTraversed}.
        // INDEPENDENT of impact(): runs its own `affected` command, never
        // calls `impact`. Returns `{ tests, diagnostics }` — symmetric with
        // getFiles/search/impact's diagnostics channel.
        async getAffectedTests(context, args) {
            try {
                const files = (args && Array.isArray(args.files)) ? args.files : [];
                const operands = [];
                for (const f of files) {
                    const operand = safeOperand(f);
                    if (!operand.ok) {
                        return { tests: [], diagnostics: [diag('unsafe-argument', 'unsafe affected-tests operand')] };
                    }
                    operands.push(operand.value);
                }
                const base = spawnBaseFor(context);
                const result = await runCodegraph({ ...base, subcommand: 'affected', args: ['--json', '--', ...operands] });
                let parsed = null;
                if (result.ok) {
                    try { parsed = JSON.parse(result.stdout); } catch (err) { parsed = null; }
                }
                if (!result.ok || !isPlainObject(parsed) || !Array.isArray(parsed.affectedTests)) {
                    const diagnostic = diag('schema-invalid', 'affected response missing an affectedTests array');
                    capabilityHealth.set('affectedTests', {
                        disabled: true, schemaFingerprint: null,
                        diagnostic,
                    });
                    return { tests: [], diagnostics: [diagnostic] };
                }
                capabilityHealth.set('affectedTests', { disabled: false });
                const status = await provider.getStatus(context);
                const snapshot = refSnapshotFromStatus(status);
                const tests = parsed.affectedTests.map((p) => normalizeReference(PROVIDER_ID, {
                    providerEntityId: p, name: path.basename(String(p)), kind: 'test', filePath: p,
                    snapshot, provenance: { ...REF_PROVENANCE },
                }));
                return { tests, diagnostics: [] };
            } catch (err) {
                return { tests: [], diagnostics: [diag('unexpected-error', err && err.message ? err.message : String(err))] };
            }
        },

        // getEntity(context, {entity}) — `node -- <entity>` is OPAQUE text (no
        // --json). Extracts ONLY the first explicitly-marked file:line token;
        // never synthesizes structural edges from the prose; never overrides
        // JSON results (this is the sole caller of the `node` command).
        async getEntity(context, args) {
            const entityName = args && typeof args.entity === 'string'
                ? args.entity : (typeof args === 'string' ? args : '');
            try {
                const operand = safeOperand(entityName);
                if (!operand.ok) {
                    return { reference: null, content: '', truncated: false, diagnostics: [diag('unsafe-argument', 'unsafe entity operand')] };
                }
                const base = spawnBaseFor(context);
                const result = await runCodegraph({ ...base, subcommand: 'node', args: ['--', operand.value] });
                if (!result.ok) {
                    return { reference: null, content: '', truncated: false, diagnostics: [diag('command-failed', 'node command failed')] };
                }
                const content = result.stdout;
                const match = FILE_LINE_RE.exec(content);
                const status = await provider.getStatus(context);
                const snapshot = refSnapshotFromStatus(status);
                const enrichmentProvenance = { method: 'provider-enrichment', authority: 'enrichment', confidence: REF_PROVENANCE.confidence };
                const raw = match
                    ? {
                        providerEntityId: entityName, name: entityName, kind: 'unknown',
                        filePath: match[1], lineRange: [parseInt(match[2], 10), parseInt(match[2], 10)],
                        snapshot, provenance: enrichmentProvenance,
                    }
                    : {
                        providerEntityId: entityName, name: entityName, kind: 'unknown',
                        snapshot, provenance: enrichmentProvenance,
                    };
                return {
                    reference: normalizeReference(PROVIDER_ID, raw),
                    content,
                    truncated: result.truncated === true,
                    diagnostics: [],
                };
            } catch (err) {
                return { reference: null, content: '', truncated: false, diagnostics: [diag('unexpected-error', err && err.message ? err.message : String(err))] };
            }
        },

        // explore(context, {query}) — `explore -- <query>` is OPAQUE text (no
        // --json). `extracted` collects EVERY explicitly-marked file:line
        // token; no CodeReference/relationship synthesis beyond that
        // metadata; never overrides JSON results (this is the sole caller of
        // the `explore` command).
        async explore(context, args) {
            const q = args && typeof args.query === 'string' ? args.query : (typeof args === 'string' ? args : '');
            try {
                const operand = safeOperand(q);
                if (!operand.ok) {
                    return { opaqueText: '', extracted: [], diagnostics: [diag('unsafe-argument', 'unsafe explore operand')] };
                }
                const base = spawnBaseFor(context);
                const result = await runCodegraph({ ...base, subcommand: 'explore', args: ['--', operand.value] });
                if (!result.ok) {
                    return { opaqueText: '', extracted: [], diagnostics: [diag('command-failed', 'explore command failed')] };
                }
                const opaqueText = result.stdout;
                const extracted = [];
                FILE_LINE_RE_GLOBAL.lastIndex = 0;
                let match;
                while ((match = FILE_LINE_RE_GLOBAL.exec(opaqueText)) !== null) {
                    extracted.push({ filePath: match[1], lineRange: [parseInt(match[2], 10), parseInt(match[2], 10)] });
                }
                return { opaqueText, extracted, diagnostics: [] };
            } catch (err) {
                return { opaqueText: '', extracted: [], diagnostics: [diag('unexpected-error', err && err.message ? err.message : String(err))] };
            }
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
