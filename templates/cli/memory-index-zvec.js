'use strict';

const fs = require('fs');
const path = require('path');
const { getNamespaces } = require('./db');
const { getDbPath, getWorkspaceRoot } = require('./runtime');
const { generateSnippet, rerankByExact } = require('./memory-index-util');
const { openWithCoordination, clearOwner } = require('./memory-index-lock');

const ENGINE = 'zvec-jieba-fts';
const COLLECTION_NAME = 'evomemory';
const MAX_ENUM = 1000; // Zvec querySync topk hard limit

let Z = null;
function loadZvec() {
    if (!Z) Z = require('@zvec/zvec'); // throws if the optional dep is absent
    return Z;
}

function zvecRoot() {
    return path.join(path.dirname(getDbPath()), 'zvec');
}

// ZvecMemoryIndex — MemoryIndex implementation backed by a Zvec jieba-FTS
// collection. Self-contained: owns its collection dir + a sidecar id counter,
// with no dependency on the SQLite raw_memory table.
class ZvecMemoryIndex {
    constructor() {
        this._col = null;
        this._dirty = false;      // writes pending an FTS optimize
        this._exitHooked = false;
        this._dir = zvecRoot();
        this._colPath = path.join(this._dir, 'collection');
        this._idFile = path.join(this._dir, 'nextid.json');
        // Ephemeral tenure ([a177]): open→op→finalize per public op, so the
        // zvec write lock is held for milliseconds instead of process lifetime.
        this._ephemeral = process.env.EVO_LITE_INDEX_EPHEMERAL === '1';
        this._depth = 0;
        this._leaseId = null;
    }

    get engine() {
        return ENGINE;
    }

    _schema() {
        const z = loadZvec();
        return new z.ZVecCollectionSchema({
            name: COLLECTION_NAME,
            fields: [
                { name: 'content', dataType: z.ZVecDataType.STRING,
                  indexParams: { indexType: z.ZVecIndexType.FTS, tokenizerName: 'jieba' } },
                { name: 'namespace', dataType: z.ZVecDataType.STRING,
                  indexParams: { indexType: z.ZVecIndexType.INVERT } },
                { name: 'timestamp', dataType: z.ZVecDataType.STRING },
            ],
        });
    }

    initialize() {
        const z = loadZvec();
        fs.mkdirSync(this._dir, { recursive: true });
        const { result, leaseId } = openWithCoordination(
            () => fs.existsSync(this._colPath)
                ? z.ZVecOpen(this._colPath)
                : z.ZVecCreateAndOpen(this._colPath, this._schema()),
            this._dir,
            { projectRoot: getWorkspaceRoot() },
        );
        this._col = result;
        this._leaseId = leaseId;
        if (!this._exitHooked) {
            // Zvec FTS segments only become queryable after optimizeSync(); the
            // evo-lite CLI is one-shot per command, so without finalizing on exit
            // a write is invisible to the next `recall` process. Finalize once at
            // process exit (optimize only if we actually wrote). In ephemeral
            // mode this is an idempotent no-op (already finalized per op).
            process.once('exit', () => { try { this._finalizeSync(); } catch (_) {} });
            this._exitHooked = true;
        }
        if (!fs.existsSync(this._idFile)) {
            fs.writeFileSync(this._idFile, JSON.stringify({ next: this._maxId() + 1 }), 'utf8');
        }
    }

    // Persist the FTS index (optimize if dirty) and release the collection.
    _finalizeSync() {
        if (!this._col) return;
        if (this._dirty) {
            try { this._col.optimizeSync(); } catch (_) {}
            this._dirty = false;
        }
        // plan R1 P0-1:owner 清理必须发生在仍持有 zvec 独占锁期间 —— 关锁后
        // 再清会与新 writer 的接管竞态(read→unlink TOCTOU)。清理失败也必须
        // 继续关锁:最多留 stale owner(可诊断),绝不为 owner 清理泄漏锁。
        if (this._leaseId) {
            try { clearOwner(this._dir, this._leaseId); } catch (_) {}
            this._leaseId = null;
        }
        try { this._col.closeSync(); } catch (_) {}
        this._col = null;
    }

    _col_() {
        if (!this._col) this.initialize();
        return this._col;
    }

    // 重入计数的租期包装:所有公开操作必经。ephemeral 下 depth 归零即 finalize
    // (异常路径也在 finally 释放);默认模式仅计数,不改变现行为。
    _withCollection(fn) {
        this._depth++;
        try {
            return fn(this._col_());
        } finally {
            this._depth--;
            if (this._ephemeral && this._depth === 0) {
                this._finalizeSync();
            }
        }
    }

    // Zvec caps querySync topk at 1000; enumerate up to that. At the current
    // archive scale (~10^2 docs) this is the full set. TODO(follow-up): paginate
    // if a collection ever exceeds MAX_ENUM docs (stats/list/_maxId would undercount).
    _allDocs() {
        try {
            return this._col_().querySync({ topk: MAX_ENUM, filter: 'namespace != ""' }) || [];
        } catch (_) {
            return [];
        }
    }

    _maxId() {
        return this._allDocs().reduce((m, d) => Math.max(m, Number(d.id) || 0), 0);
    }

    _nextId() {
        let state = { next: 1 };
        try { state = JSON.parse(fs.readFileSync(this._idFile, 'utf8')); } catch (_) {}
        const id = state.next || 1;
        fs.writeFileSync(this._idFile, JSON.stringify({ next: id + 1 }), 'utf8');
        return id;
    }

    upsert(doc = {}) {
        return this._withCollection(col => {
            const id = this._nextId();
            col.insertSync([{ id: String(id), fields: {
                content: doc.content,
                namespace: doc.namespace,
                timestamp: doc.timestamp,
            } }]);
            this._dirty = true;
            return { id };
        });
    }

    _scopeFilter(scope) {
        if (!scope || scope === 'all') return undefined;
        return `namespace = "${scope}"`;
    }

    searchText(query, options = {}) {
        return this._withCollection(col => {
            const topK = options.topK || 5;
            // Over-fetch a wider candidate pool so an exact-phrase doc that jieba-OR
            // BM25 ranked below topK is still available to rerankByExact to promote.
            // Capped at MAX_ENUM (Zvec's querySync ceiling); at archive scale (~10^2
            // docs) this is effectively the full set.
            const poolK = Math.min(Math.max(topK * 10, 50), MAX_ENUM);
            const base = { fieldName: 'content', topk: poolK };
            const filter = this._scopeFilter(options.scope);
            if (filter) base.filter = filter;

            let rows;
            let src;
            try {
                rows = col.querySync({ ...base, fts: { queryString: query } });
                src = 'zvec-fts';
            } catch (_) {
                // queryString parser rejects ':'-bearing tokens (task:/spec:/plan:);
                // matchString is the literal, unparsed fallback.
                rows = col.querySync({ ...base, fts: { matchString: query } });
                src = 'zvec-match';
            }

            rows = rerankByExact(rows || [], query, d => d.fields.content).slice(0, topK);

            return (rows || []).map(d => ({
                id: Number(d.id),
                content: d.fields.content,
                namespace: d.fields.namespace,
                timestamp: d.fields.timestamp,
                score: d.score,
                snippet: generateSnippet(d.fields.content, query),
                match_source: src,
            }));
        });
    }

    delete(id) {
        return this._withCollection(col => {
            const st = col.deleteSync(String(id));
            const changed = st && st.ok ? 1 : 0;
            if (changed) this._dirty = true;
            return { changes: changed };
        });
    }

    stats() {
        return this._withCollection(() => {
            const all = this._allDocs();
            const nsCounts = {};
            let first = null;
            let last = null;
            for (const d of all) {
                const ns = d.fields.namespace;
                nsCounts[ns] = (nsCounts[ns] || 0) + 1;
                const ts = d.fields.timestamp;
                if (ts) {
                    if (!first || ts < first) first = ts;
                    if (!last || ts > last) last = ts;
                }
            }
            const namespaces = {};
            for (const ns of getNamespaces()) {
                const count = nsCounts[ns] || 0;
                namespaces[ns] = { chunks: count, present: count > 0, model: ENGINE, dims: '1' };
            }
            return { chunks: all.length, count: all.length, namespaces, first, last };
        });
    }

    list() {
        return this._withCollection(() => this._allDocs()
            .map(d => ({
                id: Number(d.id),
                content: d.fields.content,
                namespace: d.fields.namespace,
                timestamp: d.fields.timestamp,
            }))
            .sort((a, b) => a.id - b.id));
    }

    close() {
        this._finalizeSync();
    }
}

module.exports = { ZvecMemoryIndex };
