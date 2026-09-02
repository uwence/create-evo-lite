'use strict';
// Step 2A — minimal native smoke, in an isolated child process.
//
// ⚠️ This process may die without JavaScript ever regaining control. zvec's
// known Windows failure mode is an uncatchable 0xC0000409, so the smoke never
// runs inline in the runner: a native fail-fast would take the whole cell down
// and destroy the record it exists to produce.
//
// argv[2] = absolute binding path (resolved by the PARENT)
// argv[3] = absolute collection path
//
// The binding is handed down rather than resolved here, for the same reason as
// the win-unicode fixture: a bare require('@zvec/zvec') resolves upward from
// this file's directory and can bind to an unrelated node_modules, which is
// exactly how an earlier zvec measurement became a mixed-version run. The
// loaded path is echoed in child_start so it is an observable fact.
//
// Stage markers use fs.writeSync: console.log is buffered, and the buffer is not
// flushed when the OS tears the process down.
//
// MINIMAL on purpose: schema -> create/open -> close. Insert / optimize / query
// belong to a later question (project-use compatibility). Mixing them in here
// would blur "the binding cannot do anything at all" with "one operation is
// incompatible".

const fs = require('fs');

const bindingPath = process.argv[2];
const colPath = process.argv[3];

function mark(stage, extra) {
    fs.writeSync(1, JSON.stringify({ stage, ...(extra || {}) }) + '\n');
}

function fail(stage, err) {
    fs.writeSync(2, JSON.stringify({
        jsError: true, stage,
        name: err && err.name, message: err && err.message, code: err && err.code,
    }) + '\n');
    process.exit(1);
}

mark('child_start', {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    binding: bindingPath,
    colPathLen: colPath.length,
});

let z;
try {
    z = require(bindingPath);
} catch (e) {
    fail('require_binding', e);
}
mark('binding_loaded');

// Same schema shape as production (memory-index-zvec.js): a different schema
// exercises a different native path, so a green result here would not speak to
// the one this project actually uses.
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
    col = fs.existsSync(colPath) ? z.ZVecOpen(colPath) : z.ZVecCreateAndOpen(colPath, schema);
} catch (e) {
    fail('create_or_open', e);
}
mark('create_or_open');

try {
    col.closeSync();
} catch (e) {
    fail('close', e);
}
mark('close');

mark('child_done');
process.exit(0);
