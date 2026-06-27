'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { previewClose } = require('./close-preview');

function defaultExec(root) {
    return (args) => childProcess.execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function applyClose(specPath, opts = {}) {
    const root = opts.root || process.cwd();
    const exec = opts.exec || defaultExec(root);
    const previewFn = opts.previewFn || ((sp) => previewClose(sp, { root }));

    // Gate 1: clean tree — evidence/closure must bind a real committed state.
    const porcelain = String(exec(['status', '--porcelain']) || '').trim();
    if (porcelain) {
        return { applied: false, refused: 'dirty-tree', readiness: null,
            message: 'working tree is dirty — commit or stash first' };
    }

    // Gate 2: READY only — the criteria gate is the sole hard gate.
    const preview = previewFn(specPath);
    if (preview.readiness !== 'READY') {
        return { applied: false, refused: preview.readiness, readiness: preview.readiness,
            blockers: preview.blockers || [], note: preview.note };
    }

    // Mutation engine arrives in Task 2.
    return { applied: false, refused: 'not-implemented', readiness: 'READY' };
}

module.exports = { applyClose };
