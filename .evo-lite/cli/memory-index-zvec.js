'use strict';

const fs = require('fs');
const path = require('path');
const { getNamespaces } = require('./db');
const { getDbPath } = require('./runtime');
const { generateSnippet } = require('./memory-index-util');

const ENGINE = 'zvec-jieba-fts';
const COLLECTION_NAME = 'evomemory';

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
        this._dir = zvecRoot();
        this._colPath = path.join(this._dir, 'collection');
        this._idFile = path.join(this._dir, 'nextid.json');
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
        this._col = fs.existsSync(this._colPath)
            ? z.ZVecOpen(this._colPath)
            : z.ZVecCreateAndOpen(this._colPath, this._schema());
        if (!fs.existsSync(this._idFile)) {
            fs.writeFileSync(this._idFile, JSON.stringify({ next: this._maxId() + 1 }), 'utf8');
        }
    }

    _col_() {
        if (!this._col) this.initialize();
        return this._col;
    }

    _allDocs() {
        try {
            return this._col_().querySync({ topk: 1000000, filter: 'namespace != ""' }) || [];
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
        const col = this._col_();
        const id = this._nextId();
        col.insertSync([{ id: String(id), fields: {
            content: doc.content,
            namespace: doc.namespace,
            timestamp: doc.timestamp,
        } }]);
        return { id };
    }

    _scopeFilter(scope) {
        if (!scope || scope === 'all') return undefined;
        return `namespace = "${scope}"`;
    }

    searchText(query, options = {}) {
        const col = this._col_();
        const topK = options.topK || 5;
        const base = { fieldName: 'content', topk: topK };
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

        return (rows || []).map(d => ({
            id: Number(d.id),
            content: d.fields.content,
            namespace: d.fields.namespace,
            timestamp: d.fields.timestamp,
            score: d.score,
            snippet: generateSnippet(d.fields.content, query),
            match_source: src,
        }));
    }

    delete(id) {
        const col = this._col_();
        const st = col.deleteSync(String(id));
        return { changes: st && st.ok ? 1 : 0 };
    }

    stats() {
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
    }

    close() {
        if (this._col) {
            try { this._col.closeSync(); } catch (_) {}
            this._col = null;
        }
    }
}

module.exports = { ZvecMemoryIndex };
