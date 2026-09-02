'use strict';
// Step 2B — one phase of the real-adapter transaction, in its own process.
//
// THIS EXECUTES THE PRODUCTION ADAPTER. Not a hand-written workload that calls
// the same functions: a reproduction proves that a script I wrote works, which
// is not the question. The subject is memory-index-zvec.js as it stands in the
// tree, and its git blob hash is recomputed here and recorded, so the artifact
// says which source actually ran.
//
// argv[2] = phase: A | B | C
// argv[3] = absolute runtime root (EVO_LITE_ROOT)
// argv[4] = absolute @zvec/zvec 0.7.0 entry
// argv[5] = absolute adapter path
// argv[6] = absolute output path
//
// Three processes, not three function calls. The adapter's persistence contract
// is "write, finalize on close, and the NEXT one-shot CLI process can recall
// it" — writing and querying inside one process would skip exactly the part
// production depends on.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [, , PHASE, RUNTIME_ROOT, ZVEC_ENTRY, ADAPTER, OUT] = process.argv;
for (const [n, v] of [['runtime root', RUNTIME_ROOT], ['zvec entry', ZVEC_ENTRY],
    ['adapter', ADAPTER], ['out', OUT]]) {
    if (!v || !path.isAbsolute(v)) {
        console.error(`${n} must be an absolute path (got: ${v})`);
        process.exit(2);
    }
}

process.env.EVO_LITE_ROOT = RUNTIME_ROOT;

const evidence = { phase: PHASE, node: process.version, platform: process.platform, seam: [], checks: [], error: null };
const write = () => fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2), 'utf8');
const check = (name, pass, detail) => { evidence.checks.push({ name, pass: Boolean(pass), detail }); };

// Git blob identity of the adapter that is about to run — computed, not asserted.
const src = fs.readFileSync(ADAPTER);
evidence.adapterBlob = crypto.createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${src.length}\0`), src])).digest('hex');

// ---- the seam, OUTSIDE the adapter --------------------------------------
// The adapter does a lazy require('@zvec/zvec') and must not be edited to accept
// an injected binding: patching production to be testable would mean measuring
// something other than the code we are considering upgrading. The specifier is
// redirected here, in the harness, and every redirect is recorded with its
// requester so the binding identity is an observable fact.
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
    if (request === '@zvec/zvec') {
        evidence.seam.push({
            request,
            requestedBy: parent && parent.filename,
            redirectedTo: ZVEC_ENTRY,
        });
        return origLoad.call(this, ZVEC_ENTRY, parent, ...rest);
    }
    return origLoad.call(this, request, parent, ...rest);
};

const DOC_A = { content: 'evo lite adapter contract probe 遏制合同探针 alpha', namespace: 'prose', timestamp: '2026-09-02T00:00:00.000Z' };
const DOC_B = { content: 'follow up on task:alpha-beta before the release', namespace: 'code', timestamp: '2026-09-02T01:00:00.000Z' };
const STATE = path.join(RUNTIME_ROOT, 'probe-state.json');

try {
    const { ZvecMemoryIndex } = require(ADAPTER);
    const idx = new ZvecMemoryIndex();
    idx.initialize();
    evidence.engine = idx.engine;

    if (PHASE === 'A') {
        const a = idx.upsert(DOC_A);
        const b = idx.upsert(DOC_B);
        check('upsert returns numeric id', Number.isInteger(a.id) && Number.isInteger(b.id), { a: a.id, b: b.id });
        check('ids are distinct and ascending', b.id > a.id, { a: a.id, b: b.id });
        fs.writeFileSync(STATE, JSON.stringify({ idA: a.id, idB: b.id }), 'utf8');
        idx.close();                       // must trigger optimizeSync via _finalizeSync
        evidence.ids = { a: a.id, b: b.id };

    } else if (PHASE === 'B') {
        const { idA, idB } = JSON.parse(fs.readFileSync(STATE, 'utf8'));
        evidence.ids = { a: idA, b: idB };

        // Persistence: written in a PREVIOUS process, visible here.
        const list0 = idx.list();
        check('write survives close + reopen in a new process',
            list0.length === 2 && list0.map(r => r.id).join(',') === [idA, idB].sort((x, y) => x - y).join(','),
            { got: list0.map(r => r.id) });
        check('list is ordered by numeric id', list0.every((r, i) => i === 0 || list0[i - 1].id < r.id),
            { ids: list0.map(r => r.id) });
        check('list carries content/namespace/timestamp',
            list0.some(r => r.content === DOC_A.content && r.namespace === 'prose' && r.timestamp === DOC_A.timestamp),
            { sample: list0[0] });

        // Normal FTS path.
        const fts = idx.searchText('遏制合同探针');
        check('fts query returns the expected row', fts.length > 0 && fts[0].id === idA, { top: fts[0] });
        check('fts match_source is zvec-fts', fts.length > 0 && fts[0].match_source === 'zvec-fts',
            { source: fts[0] && fts[0].match_source });
        check('fts row has score and snippet', fts.length > 0 && typeof fts[0].score === 'number' && typeof fts[0].snippet === 'string',
            { score: fts[0] && fts[0].score });

        // Colon token: queryString must reject and the adapter must fall back.
        const colon = idx.searchText('task:alpha-beta');
        check('colon query returns the expected row', colon.length > 0 && colon[0].id === idB, { top: colon[0] });
        check('colon query falls back to zvec-match', colon.length > 0 && colon[0].match_source === 'zvec-match',
            { source: colon[0] && colon[0].match_source });

        // Scope filter, BOTH directions. `every(...)` over an empty array is
        // vacuously true, and an empty result is also what a broken query returns —
        // so exclusion alone proves nothing without a positive control showing the
        // filter still lets the in-scope row through.
        const scopedOut = idx.searchText('遏制合同探针', { scope: 'code' });
        check('scope filter excludes the out-of-scope row', scopedOut.length === 0,
            { got: scopedOut.map(r => ({ id: r.id, ns: r.namespace })) });
        const scopedIn = idx.searchText('task:alpha-beta', { scope: 'code' });
        check('scope filter keeps the in-scope row (positive control)',
            scopedIn.length > 0 && scopedIn.every(r => r.namespace === 'code') && scopedIn[0].id === idB,
            { got: scopedIn.map(r => ({ id: r.id, ns: r.namespace })) });

        const st = idx.stats();
        check('stats counts both docs', st.chunks === 2 && st.count === 2, { chunks: st.chunks, count: st.count });
        check('stats first/last timestamps', st.first === DOC_A.timestamp && st.last === DOC_B.timestamp,
            { first: st.first, last: st.last });
        check('stats namespaces reports per-namespace chunks',
            st.namespaces && st.namespaces.prose && st.namespaces.prose.chunks === 1
            && st.namespaces.code && st.namespaces.code.chunks === 1,
            { prose: st.namespaces && st.namespaces.prose, code: st.namespaces && st.namespaces.code });

        const del = idx.delete(idA);
        check('delete reports changes = 1', del && del.changes === 1, { got: del });
        idx.close();

    } else if (PHASE === 'C') {
        const { idA, idB } = JSON.parse(fs.readFileSync(STATE, 'utf8'));
        const rows = idx.list();
        check('deletion survives reopen', !rows.some(r => r.id === idA), { ids: rows.map(r => r.id) });
        check('survivor still present', rows.some(r => r.id === idB), { ids: rows.map(r => r.id) });
        const still = idx.searchText('task:alpha-beta');
        check('survivor still queryable after reopen', still.length > 0 && still[0].id === idB, { top: still[0] });
        idx.close();

    } else {
        throw new Error(`unknown phase: ${PHASE}`);
    }
} catch (e) {
    evidence.error = { name: e && e.name, message: e && e.message, stack: String(e && e.stack).slice(0, 800) };
    write();
    process.exit(1);
}

evidence.allPassed = evidence.checks.every(c => c.pass);
write();
process.exit(evidence.allPassed ? 0 : 1);
