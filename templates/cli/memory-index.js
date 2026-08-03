'use strict';

const {
    DEFAULT_ENGINE,
    DEFAULT_NAMESPACE,
    closeDb,
    getDb,
    getNamespaceCounts,
    getNamespaces,
    initDB,
    isValidNamespace,
    tableExists,
} = require('./db');
const { getLogPath, getDbPath } = require('./runtime');
const { generateSnippet } = require('./memory-index-util');
// Both are zvec-free by construction — requiring them here must not pull in the
// native binding, or the containment decision would happen after the hazard.
const { zvecPaths } = require('./zvec-collection-path');
const { classifyCollectionPath } = require('./zvec-path-containment');
const {
    readContainmentState, writeContainmentState, clearContainmentState,
} = require('./zvec-containment-state');

const fs = require('fs');
const path = require('path');

const LOG_PATH = getLogPath();

// Private logger — identical shape to memory.service.js appendLog. Kept local
// (not imported from the service) to avoid a memory-index ↔ memory.service
// circular require. Both resolve the same path via runtime.getLogPath().
function appendLog(action, content) {
    try {
        fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${action}: ${content}\n`, 'utf8');
    } catch (_) {}
}

// Recall-only helpers, moved verbatim from memory.service.js.
function generateTrigramQuery(query) {
    if (!query) {
        return query;
    }

    const tokens = query
        .replace(/[^\w\s一-龥]/gi, ' ')
        .split(/\s+/)
        .map(token => token.trim())
        .filter(Boolean);

    if (tokens.length === 0) {
        return query;
    }

    return tokens.map(token => {
        if (token.length <= 3) {
            return token;
        }
        const chars = Array.from(token);
        const parts = [];
        for (let i = 0; i < chars.length - 2; i += 1) {
            parts.push(chars[i] + chars[i + 1] + chars[i + 2]);
        }
        return parts.length > 0 ? `(${parts.join(' AND ')})` : token;
    }).join(' AND ');
}

function bm25RankToScore(rank) {
    return 1 / (1 + Math.exp(rank));
}

// SqliteFtsIndex — default (and today only) MemoryIndex implementation.
// Owns all direct raw_memory / raw_memory_fts access for memory documents.
class SqliteFtsIndex {
    initialize() {
        initDB();
    }

    get engine() {
        return DEFAULT_ENGINE;
    }

    searchText(query, options = {}) {
        const topK = options.topK || 5;
        const db = getDb();
        const scope = options.scope || 'all';
        const namespaces = scope === 'all'
            ? getNamespaces()
            : [scope].filter(namespace => isValidNamespace(namespace));

        if (tableExists(db, 'raw_memory_fts')) {
            const params = [generateTrigramQuery(query)];
            let sql = `
            SELECT
                f.rowid AS id,
                r.content,
                r.namespace,
                r.timestamp,
                bm25(raw_memory_fts, 1.0, 0.0) AS bm25_rank
            FROM raw_memory_fts f
            JOIN raw_memory r ON f.rowid = r.id
            WHERE raw_memory_fts MATCH ?
        `;

            if (scope !== 'all' && namespaces.length > 0) {
                sql += ` AND r.namespace IN (${namespaces.map(() => '?').join(',')})`;
                params.push(...namespaces);
            }

            sql += ' ORDER BY bm25_rank ASC LIMIT ?';
            params.push(topK);

            try {
                const rows = db.prepare(sql).all(...params);
                if (rows.length > 0) {
                    appendLog('RECALL_FTS', `Queried "${query}" scope=${scope}, returned ${rows.length} trigram matches.`);
                    return rows.map(row => ({
                        ...row,
                        score: bm25RankToScore(row.bm25_rank),
                        snippet: generateSnippet(row.content, query),
                        match_source: 'fts',
                    }));
                }
            } catch (error) {
                appendLog('RECALL_FTS_ERROR', `${query} | ${error.message}`);
            }
        }

        const likeResults = db.prepare('SELECT id, content, namespace, timestamp FROM raw_memory WHERE content LIKE ? LIMIT ?').all(`%${query}%`, topK);
        appendLog('RECALL_FALLBACK', `Queried "${query}" scope=${scope}, returned ${likeResults.length} LIKE matches.`);
        return likeResults.map(row => ({
            ...row,
            snippet: generateSnippet(row.content, query),
            match_source: 'like',
        }));
    }

    upsert(doc = {}) {
        const db = getDb();
        const rawMemoryId = db.prepare('INSERT INTO raw_memory (content, namespace, timestamp) VALUES (?, ?, ?)').run(
            doc.content,
            doc.namespace,
            doc.timestamp
        ).lastInsertRowid;
        return { id: Number(rawMemoryId) };
    }

    delete(id) {
        const db = getDb();
        const info = db.prepare('DELETE FROM raw_memory WHERE id = ?').run(id);
        return { changes: info.changes };
    }

    stats() {
        const db = getDb();
        const namespaceCounts = getNamespaceCounts(db);
        let totalChunks = 0;
        for (const ns of Object.keys(namespaceCounts)) {
            totalChunks += namespaceCounts[ns].chunks || 0;
        }
        return {
            chunks: totalChunks,
            count: db.prepare('SELECT COUNT(*) AS count FROM raw_memory').get().count,
            namespaces: namespaceCounts,
            ...db.prepare('SELECT MIN(timestamp) AS first, MAX(timestamp) AS last FROM raw_memory').get(),
        };
    }

    list() {
        return getDb().prepare('SELECT id, content, namespace, timestamp FROM raw_memory ORDER BY id ASC').all();
    }

    close() {
        closeDb();
    }
}

const DEFAULT_ENGINE_CHOICE = 'zvec';

function resolveEngine() {
    const env = process.env.EVO_LITE_MEMORY_ENGINE;
    if (env) return env;
    try {
        const cfgPath = path.join(path.dirname(getDbPath()), 'memory-engine.json');
        if (fs.existsSync(cfgPath)) {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            if (cfg && typeof cfg.engine === 'string') return cfg.engine;
        }
    } catch (_) {}
    return DEFAULT_ENGINE_CHOICE;
}

// loadZvecIndex: () => ZvecMemoryIndex class | null. Injected so tests can
// simulate "@zvec/zvec unavailable" without touching the module system.
function defaultLoadZvecIndex() {
    try {
        require('@zvec/zvec');                       // fail fast if the optional dep is absent
        return require('./memory-index-zvec').ZvecMemoryIndex;
    } catch (_) {
        return null;
    }
}

// [zvec-win-unicode-containment] AC3 — ONE decision, consumed twice.
//
// Diagnosis (resolveActiveImpl) and instantiation (getMemoryIndex → selectEngine)
// used to reach loadZvecIndex() independently, and defaultLoadZvecIndex()'s first
// statement is require('@zvec/zvec'). On Windows, some non-ASCII collection paths
// make the native side terminate the process with 0xC0000409, which no try/catch
// can contain — so the load itself is what must not happen (spec I1). Guarding
// only one of the two consumers would have left the runtime unprotected.
//
// resolveEngineDecision() therefore classifies the collection path BEFORE any
// load and, when the verdict is not SAFE, returns a sqlite decision without ever
// calling loadZvecIndex. The zero-load property is the single most important
// executable guarantee in this spec (§6.2) and is asserted by T-zwuc-T6.
//
// Nothing here opens or creates a collection: on a non-SAFE path ZvecIndex stays
// null, so ZvecMemoryIndex — which is what mkdirs the directory and calls
// ZVecOpen/ZVecCreateAndOpen in initialize() — is never constructed.
//
// Every input is read ONCE into a snapshot. The decision, its cache key and the
// paths handed to the engine all come from that single read, so a verdict can
// never describe one path while the instance uses another.
function collectDecisionInputs(options = {}) {
    const inputs = {
        choice: options.choice === undefined ? resolveEngine() : options.choice,
        platform: options.platform === undefined ? process.platform : options.platform,
        loadZvecIndex: options.loadZvecIndex || defaultLoadZvecIndex,
        classifyPath: options.classifyPath || classifyCollectionPath,
        fsOps: options.fsOps,
        paths: null,
        pathError: null,
        markerDir: null,
        marker: null,
    };
    if (options.paths) {
        inputs.paths = options.paths;
    } else if (options.collectionPath !== undefined) {
        inputs.paths = { rootPath: path.dirname(options.collectionPath), collectionPath: options.collectionPath };
    } else {
        try {
            inputs.paths = zvecPaths();
        } catch (err) {
            inputs.pathError = err;
        }
    }

    // The marker is READ here, in the input snapshot, so the resolver below can
    // stay a pure function of its inputs (§7.4 M3.1). Reading it inside the
    // resolver would make the one function that must be injectable and
    // deterministic depend on the filesystem.
    //
    // It lives beside the db, NOT inside the zvec dir: a recovery rebuild
    // discards that whole directory, and a debt record that a rebuild deletes
    // records nothing.
    // A decision asked about an INJECTED path is a hypothetical: "what would you
    // decide for THIS string?". The marker belongs to the ambient project, not
    // to that string, so for a hypothetical it applies in neither direction:
    //
    //   write — a test simulating a contained path would otherwise record a real
    //           debt in the ambient project and degrade it for good; the
    //           diagnostic would become the defect.
    //   read  — a hypothetical about a SAFE path would otherwise inherit the
    //           ambient project's debt and answer "recovery pending" about a
    //           project it was never asked about.
    //
    // Production never injects: sharedEngineDecision() always resolves ambient
    // paths, so the contract is unchanged where it matters. A caller that wants
    // the marker to participate passes markerDir explicitly, which scopes both
    // the read and the write to that directory.
    // Two separate questions, deliberately not one boolean:
    //
    //   markerApplies     — does a marker participate in this decision at all?
    //   markerPersistable — may this decision WRITE one?
    //
    // Supplying a `marker` snapshot answers the first without granting the
    // second: a caller can ask "what would you decide with this state?" without
    // that question acquiring the right to touch a disk. Only an explicit
    // markerDir — a directory the caller has scoped on purpose — grants writes.
    const pathInjected = options.paths !== undefined || options.collectionPath !== undefined;
    const markerContextExplicit = options.marker !== undefined || options.markerDir !== undefined;
    inputs.markerApplies = !pathInjected || markerContextExplicit;
    inputs.markerPersistable = !pathInjected || options.markerDir !== undefined;

    inputs.markerDir = options.markerDir !== undefined ? options.markerDir
        : (inputs.markerApplies ? ambientMarkerDir() : null);
    if (options.marker !== undefined) {
        inputs.marker = options.marker;
    } else if (inputs.markerApplies) {
        inputs.marker = readContainmentState(inputs.markerDir, { fsOps: options.markerFsOps });
    } else {
        // No debt is KNOWN for a path this runtime has never run on. 'absent' is
        // the honest answer, not a convenient one — and crucially, nothing on
        // disk was consulted to produce it.
        inputs.marker = { status: 'absent', markerPath: null, state: null, errorCode: null, detail: null };
    }
    return inputs;
}

// Where the marker lives: beside the db, NOT inside the zvec directory — a
// recovery rebuild discards that whole directory, and a debt record a rebuild
// deletes records nothing.
function ambientMarkerDir() {
    try {
        return path.dirname(getDbPath());
    } catch (_) {
        return null;
    }
}

// Fail-closed degradation must stay diagnosable. `code` covers environment
// errors (EACCES, ENOENT); `name` covers programmer errors (TypeError), which
// would otherwise degrade the engine silently under a generic "ERROR" and look
// like an environment problem. This exact case bit during development.
function errorTag(err) {
    return (err && (err.code || err.name)) || 'ERROR';
}

function decisionKeyOf(inputs) {
    const colPath = inputs.paths ? inputs.paths.collectionPath : '<unresolvable>';
    // The marker status is deliberately NOT part of this key.
    //
    // An earlier version included it, on the theory that a cached verdict about a
    // state no longer in play is the direction that must never happen. But the
    // decision WRITES the marker: a contained path resolves with the marker
    // absent, persists it, and the very next call then reads 'present' — a
    // different key, a recomputed decision, and the §6.1 guarantee that
    // diagnosis and instantiation share ONE decision object quietly broken. A
    // key that the keyed operation itself invalidates is not a cache.
    //
    // Nothing is lost. The marker can only change under a live process in two
    // ways: this process degrades (already reflected in the decision it just
    // took) or a recovery clears it — and recovery calls resetMemoryIndex(),
    // which drops the cache outright.
    return `${inputs.choice} ${colPath} ${inputs.platform}`;
}

function resolveEngineDecisionFromInputs(inputs) {
    const base = {
        choice: inputs.choice, ZvecIndex: null, paths: inputs.paths,
        collectionPath: inputs.paths ? inputs.paths.collectionPath : null,
        markerAction: 'none',
    };

    if (inputs.choice !== 'zvec') {
        // An explicit sqlite pin is a user decision, not a containment
        // degradation, so it must not mint a trust debt (§7.4 M8). An existing
        // marker still stands — pinning away and back is not a way to clear it.
        return { ...base, impl: 'sqlite', degraded: false, containment: null, reason: 'engine-choice' };
    }
    if (!inputs.paths) {
        // Cannot even name the path, so it cannot be classified. Fail closed.
        // markerAction stays 'ensure-present' so the write layer converts an
        // unrecordable debt into a coded failure rather than a quiet success
        // (§7.4 M6.1).
        return {
            ...base, impl: 'sqlite', degraded: true, reason: 'containment',
            markerAction: 'ensure-present',
            containment: {
                verdict: 'UNKNOWN', layer: 'path',
                reason: `path:collection-path-unresolvable:${errorTag(inputs.pathError)}`,
            },
        };
    }

    // A classifier that throws must degrade, not take the process down with it.
    // The evaluator already turns probe errors into UNKNOWN, so reaching here
    // means the classifier itself misbehaved — an unusable answer, which is
    // still an answer this side of the boundary: fail closed and keep going, so
    // archive and the SQLite path stay available.
    let containment;
    try {
        containment = inputs.classifyPath(inputs.paths.collectionPath, {
            platform: inputs.platform,
            fsOps: inputs.fsOps,
        });
    } catch (err) {
        containment = {
            verdict: 'UNKNOWN', layer: 'classifier',
            reason: `classifier:failed:${errorTag(err)}`,
        };
    }
    if (!containment || typeof containment !== 'object' || typeof containment.verdict !== 'string') {
        containment = { verdict: 'UNKNOWN', layer: 'classifier', reason: 'classifier:unusable-result' };
    }
    if (containment.verdict !== 'SAFE') {
        // loadZvecIndex is deliberately NOT called on this branch.
        return {
            ...base, impl: 'sqlite', degraded: true, containment, reason: 'containment',
            markerAction: 'ensure-present',
        };
    }

    // SAFE, but the debt may still be outstanding. A path that stopped being
    // dangerous says nothing about the collection lying on it, so the marker —
    // and only an explicit rebuild — decides when Zvec becomes available again
    // (§7.3, §7.4 M3). loadZvecIndex is NOT called here either: there is no
    // reason to load a binding this process has already decided not to use.
    const markerStatus = inputs.marker ? inputs.marker.status : 'absent';
    if (markerStatus !== 'absent') {
        return {
            ...base, impl: 'sqlite', degraded: true, containment,
            reason: 'containment-recovery-pending',
            recovery: {
                required: true,
                markerStatus,
                markerPath: inputs.marker ? inputs.marker.markerPath : null,
                reason: 'marker-not-cleared',
            },
        };
    }

    const ZvecIndex = inputs.loadZvecIndex();
    return {
        ...base,
        impl: ZvecIndex ? 'zvec' : 'sqlite',
        degraded: !ZvecIndex,
        ZvecIndex: ZvecIndex || null,
        containment,
        reason: ZvecIndex ? 'zvec' : 'dependency-unavailable',
    };
}

// THE effect boundary (§7.4 M3.1).
//
// The resolver above is pure and only says what SHOULD be true of the marker.
// This is the one place that makes it true. Both public entries route through
// here, which is the whole point: sharedEngineDecision() calls the pure resolver
// directly, so hanging the write on resolveEngineDecision() alone would let the
// production path degrade without ever recording the debt — and the next time
// the path looked SAFE, the untrusted collection would simply be reopened.
//
// Ordering is load-bearing: a decision is neither returned nor cached until the
// marker is confirmed on disk. Caching first would leave a "successfully
// degraded" verdict in memory that no file backs.
function persistEngineDecision(inputs, provisional, seams = {}) {
    if (!provisional || provisional.markerAction !== 'ensure-present') return provisional;
    if (!inputs.markerPersistable) {
        // Hypothetical decision about an injected path — see collectDecisionInputs.
        // Recorded rather than silent, so "no marker was written" is observable.
        // Note this is markerPersistable, not markerApplies: a caller may hand in
        // a marker snapshot to shape the verdict without thereby earning the
        // right to write one.
        provisional.markerPersisted = false;
        provisional.markerSkipped = 'injected-path';
        return provisional;
    }
    const write = seams.writeContainmentState || writeContainmentState;
    // Throws coded EVO_ZVEC_CONTAINMENT_STATE_WRITE — including when the marker
    // location itself is unresolvable (§7.4 M6.1). Deliberately NOT caught:
    // returning a working sqlite instance here would be a silent fail-open.
    const result = write(inputs.markerDir, {
        collectionPath: provisional.collectionPath,
        containment: provisional.containment,
    }, { fsOps: seams.markerFsOps });
    provisional.markerPersisted = true;
    provisional.markerAlreadyPresent = !!(result && result.alreadyPresent);
    provisional.markerPath = result && result.markerPath;
    return provisional;
}

function resolveEngineDecision(options = {}) {
    const inputs = collectDecisionInputs(options);
    const provisional = resolveEngineDecisionFromInputs(inputs);
    return persistEngineDecision(inputs, provisional, {
        writeContainmentState: options.writeContainmentState,
        markerFsOps: options.markerFsOps,
    });
}

let active = null;
let decision = null;
let decisionKey = null;

// THE shared decision. Both consumers below read this same object, which is what
// makes "one decision, two consumers" observable rather than merely intended.
//
// Inputs are collected ONCE per call and both the key and the decision derive
// from that single snapshot — reading them separately would let the key
// describe one state while the decision described another. Recomputed only
// when the inputs change, because a cached SAFE verdict about a path no longer
// in play is the one direction that must never happen. The hot path
// (getMemoryIndex with an index already built) never reaches here, so this
// costs nothing per memory operation.
function sharedEngineDecision() {
    const inputs = collectDecisionInputs();
    const key = decisionKeyOf(inputs);
    if (!decision || decisionKey !== key) {
        // persistEngineDecision BEFORE assigning: if the marker cannot be
        // written this throws, and neither `decision` nor `decisionKey` is
        // touched. A cached decision always has a marker behind it.
        const persisted = persistEngineDecision(inputs, resolveEngineDecisionFromInputs(inputs));
        decision = persisted;
        decisionKey = key;
    }
    return decision;
}

// Read-only access to the decision already taken; null when none has been.
// Diagnostics (Task 7) consume this rather than recomputing.
function peekEngineDecision() {
    return decision;
}

// The one-shot recovery decision (§7.4 M0/M4).
//
// While the marker is present the normal decision MUST yield sqlite — that is
// what the marker is for — so recovery cannot use it. The other tempting route,
// clearing the marker first and then rebuilding, is worse: a crash mid-rebuild
// would leave a half-built collection that the next process happily opens.
//
// So recovery gets its own decision, used by exactly one caller, with the marker
// still on disk the entire time. It is never cached and never reachable from
// getMemoryIndex(). There is deliberately no "force" or "skipMarker" flag: a
// boolean that bypasses the marker is the marker's only real failure mode.
function resolveRecoveryRebuildDecision(options = {}) {
    const inputs = collectDecisionInputs(options);
    const normal = resolveEngineDecisionFromInputs(inputs);

    if (inputs.choice !== 'zvec') {
        return { eligible: false, reason: 'engine-choice', decision: null, markerDir: inputs.markerDir };
    }
    if (normal.reason !== 'containment-recovery-pending') {
        // Covers "no debt to repay" (plain zvec) and "the path is still
        // dangerous" (containment) alike: neither is a recovery.
        return { eligible: false, reason: normal.reason, decision: null, markerDir: inputs.markerDir };
    }
    if (!normal.containment || normal.containment.verdict !== 'SAFE') {
        return { eligible: false, reason: 'not-safe', decision: null, markerDir: inputs.markerDir };
    }
    const markerStatus = inputs.marker ? inputs.marker.status : 'absent';
    if (markerStatus !== 'present' && markerStatus !== 'invalid') {
        // 'unreadable' lands here on purpose. We can prove neither that the
        // marker survives a failed rebuild nor that it could be cleared
        // afterwards, so nothing destructive may start (§7.4 M2).
        return { eligible: false, reason: `marker-${markerStatus}`, decision: null, markerDir: inputs.markerDir };
    }

    // Dependency is confirmed HERE — before the caller discards anything.
    const ZvecIndex = inputs.loadZvecIndex();
    if (!ZvecIndex) {
        return { eligible: false, reason: 'dependency-unavailable', decision: null, markerDir: inputs.markerDir };
    }
    return {
        eligible: true,
        reason: 'recovery',
        markerDir: inputs.markerDir,
        markerStatus,
        decision: {
            choice: inputs.choice,
            impl: 'zvec',
            degraded: false,
            ZvecIndex,
            paths: inputs.paths,
            collectionPath: inputs.paths ? inputs.paths.collectionPath : null,
            containment: normal.containment,
            reason: 'recovery-rebuild',
            markerAction: 'none',
        },
    };
}

function instantiateFromDecision(d) {
    // The instance is bound to the paths THIS decision judged. Letting the
    // constructor re-derive them would reopen the gap the shared module was
    // meant to close: the inputs can move between the verdict and the
    // instantiation, and the engine would then open a path nothing classified.
    if (d && d.ZvecIndex) return new d.ZvecIndex(d.paths ? { paths: d.paths } : undefined);
    // At most one warning per decision: the decision is cached, so a degraded
    // process says this once instead of on every memory operation.
    if (d && !d.warned) {
        d.warned = true;
        if (d.reason === 'dependency-unavailable') {
            console.warn('⚠️ memory engine "zvec" selected but @zvec/zvec is unavailable — falling back to SqliteFtsIndex.');
        } else if (d.reason === 'containment') {
            // Worded as containment, not as a fix. The upstream native fault is
            // untouched; this process only refuses to enter it. Nothing here
            // claims an existing collection was read, repaired or removed, and
            // nothing claims a recovery mechanism exists yet — it does not.
            console.warn(`⚠️ memory engine "zvec" is contained on this path (${d.containment && d.containment.reason}) — using SqliteFtsIndex instead. The existing collection, if any, was neither opened nor modified.`);
        } else if (d.reason === 'containment-recovery-pending') {
            // Deliberately worded as unfinished recovery, not as a fresh
            // containment: the path is fine now, the collection is what is not
            // trusted. Nothing here claims the old collection was inspected.
            console.warn(`⚠️ this path is no longer contained, but a containment trust marker is still present (${d.recovery && d.recovery.markerStatus}) — staying on SqliteFtsIndex. Run \`mem rebuild\` to rebuild the Zvec collection from raw_memory; the existing collection is neither opened nor trusted.`);
        }
    }
    return new SqliteFtsIndex();
}

// Return shape is pinned to {choice, impl, degraded}: memory.service consumes it
// as `engineImpl` and T-ENGINE deep-compares it. Containment detail is reached
// through peekEngineDecision()/resolveEngineDecision() instead of widening this.
// Accepts the legacy loader function or a full options object, so a caller that
// needs a deterministic verdict can pin the platform and the path instead of
// inheriting whatever the ambient runtime happens to be. No argument means "use
// the shared decision", which is what production does.
function resolveActiveImpl(loadZvecIndexOrOptions) {
    let d;
    if (loadZvecIndexOrOptions === undefined) {
        d = sharedEngineDecision();
    } else if (typeof loadZvecIndexOrOptions === 'function') {
        d = resolveEngineDecision({ loadZvecIndex: loadZvecIndexOrOptions });
    } else {
        d = resolveEngineDecision(loadZvecIndexOrOptions);
    }
    return { choice: d.choice, impl: d.impl, degraded: d.degraded };
}

// Legacy positional form (engine, loader) is preserved for existing callers; an
// options object may be passed instead when a test needs to pin platform,
// collection path or probe behaviour deterministically.
function selectEngine(engine, loadZvecIndex) {
    if (engine === undefined && loadZvecIndex === undefined) {
        return instantiateFromDecision(sharedEngineDecision());
    }
    const options = (engine && typeof engine === 'object')
        ? engine
        : { choice: engine, loadZvecIndex };
    return instantiateFromDecision(resolveEngineDecision(options));
}

function getMemoryIndex() {
    if (!active) {
        active = instantiateFromDecision(sharedEngineDecision());
    }
    return active;
}

// Drop the cached engine so the next getMemoryIndex() re-initializes. Used by
// rebuild after wiping a derived store so no stale handle points at a removed dir.
// The decision is dropped with it: the collection path or its topology may have
// changed, and a stale SAFE verdict would be exactly the wrong thing to keep.
function resetMemoryIndex() {
    active = null;
    decision = null;
    decisionKey = null;
}

// 只读访问当前活动索引(不创建实例)。MCP shutdown 用它收尾:实例从未创建时
// 不应因收尾反而去打开一次索引。
function peekMemoryIndex() {
    return active;
}

module.exports = {
    SqliteFtsIndex, getMemoryIndex, resetMemoryIndex, peekMemoryIndex,
    resolveEngine, resolveActiveImpl, selectEngine, DEFAULT_ENGINE_CHOICE,
    resolveEngineDecision, peekEngineDecision, instantiateFromDecision,
    // [zvec-win-unicode-containment] Task 6
    collectDecisionInputs, resolveEngineDecisionFromInputs, persistEngineDecision,
    resolveRecoveryRebuildDecision,
    readContainmentState, writeContainmentState, clearContainmentState,
};
