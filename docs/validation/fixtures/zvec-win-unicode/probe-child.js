'use strict';
// Isolated probe child for the Windows non-ASCII zvec path investigation.
//
// ⚠️ THIS PROCESS IS EXPECTED TO DIE. For a triggering path the OS terminates it
// with 0xC0000409 (STATUS_STACK_BUFFER_OVERRUN). That is the observation being
// collected, not a malfunction. Never run this logic inline in a test runner or
// CLI process — it would take that process down with it.
//
// argv[2] = absolute binding path (require.resolve output from the PARENT)
// argv[3] = absolute collection path
//
// The binding path is handed down rather than resolved here on purpose. A probe
// that does a bare require('@zvec/zvec') resolves upward from its own directory
// and can silently bind to an unrelated user-level node_modules — exactly the
// defect that invalidated the first zvec-06 readOnly measurement (a 0.5-holder
// vs 0.6-prober mixed-version run). Absolute injection makes the loaded binding
// an observable fact, recorded in the child_start marker below.
//
// Stage markers use fs.writeSync(1, ...): synchronous and unbuffered.
// console.log is buffered and its buffer is NOT flushed when the process is
// torn down by an uncatchable native fault, which would destroy the only
// evidence this probe exists to collect.

const fs = require('fs');

const bindingPath = process.argv[2];
const colPath = process.argv[3];

function mark(stage, extra) {
    fs.writeSync(1, JSON.stringify({ stage, ...(extra || {}) }) + '\n');
}

function fail(stage, err) {
    fs.writeSync(2, JSON.stringify({
        jsError: true,
        stage,
        name: err && err.name,
        message: err && err.message,
        code: err && err.code,
    }) + '\n');
    process.exit(1);
}

mark('child_start', {
    node: process.version,
    pid: process.pid,
    colPathLen: colPath.length,
    binding: bindingPath,
});

let z;
try {
    z = require(bindingPath);
} catch (e) {
    fail('require_binding', e);
}
mark('binding_loaded');

// Mirrors the production schema in memory-index-zvec.js exactly: jieba FTS on
// content, INVERT on namespace, plain string timestamp. A different schema or a
// different call order would be probing a different native code path, and the
// result could not be attributed to the production one.
let schema;
try {
    schema = new z.ZVecCollectionSchema({
        name: 'evomemory',
        fields: [
            { name: 'content', dataType: z.ZVecDataType.STRING,
              indexParams: { indexType: z.ZVecIndexType.FTS, tokenizerName: 'jieba' } },
            { name: 'namespace', dataType: z.ZVecDataType.STRING,
              indexParams: { indexType: z.ZVecIndexType.INVERT } },
            { name: 'timestamp', dataType: z.ZVecDataType.STRING },
        ],
    });
} catch (e) {
    fail('schema', e);
}
mark('schema_built');

let col;
try {
    col = fs.existsSync(colPath)
        ? z.ZVecOpen(colPath)
        : z.ZVecCreateAndOpen(colPath, schema);
} catch (e) {
    fail('create_or_open', e);
}
mark('create_or_open');

try {
    col.insertSync([{ id: '1', fields: {
        content: 'containment probe 遏制探针 sample',
        namespace: 'prose',
        timestamp: '2026-07-31T00:00:00.000Z',
    } }]);
} catch (e) {
    fail('insert', e);
}
mark('insert');

try {
    col.optimizeSync();
} catch (e) {
    fail('optimize', e);
}
mark('optimize');

try {
    const hits = col.querySync({ topk: 5, filter: 'namespace != ""' }) || [];
    mark('query', { hits: hits.length });
} catch (e) {
    fail('query', e);
}

try {
    col.closeSync();
} catch (e) {
    fail('close', e);
}
mark('close');

mark('child_done');
process.exit(0);
