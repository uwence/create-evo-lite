'use strict';
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { pathIdentity, canonPath } = require('../hook-provenance/path-identity');

function tmp(name) {
    return fs.mkdtempSync(path.join(os.tmpdir(), `evo-hp-${name}-`));
}

async function runHookProvenanceTests() {
    console.log('--- Starting hook-provenance tests ---');

    console.log('HP1. path identity: canonical equality is the only lexical shortcut ...');
    {
        const root = tmp('canon');
        const dir = path.join(root, 'hooks');
        fs.mkdirSync(dir);

        assert.strictEqual(pathIdentity(dir, dir), 'SAME', 'identical paths must be SAME');
        assert.strictEqual(
            pathIdentity(dir, dir.split(path.sep).join('/') + '/'),
            'SAME',
            'separator and trailing-slash differences must canonicalise to SAME');

        // Case difference must NOT short-circuit: it goes to physical resolution.
        // On a case-sensitive filesystem these are two real directories.
        const upper = path.join(root, 'Hooks');
        let caseSensitive = false;
        try { fs.mkdirSync(upper); caseSensitive = true; } catch (_) { caseSensitive = false; }
        if (caseSensitive) {
            assert.strictEqual(pathIdentity(dir, upper), 'DISTINCT',
                'on a case-sensitive filesystem hooks and Hooks are two directories');
        } else {
            assert.strictEqual(pathIdentity(dir, upper), 'SAME',
                'on a case-insensitive filesystem they resolve to one directory');
        }
    }

    console.log('HP2. path identity: lexical difference resolves physically ...');
    {
        const root = tmp('alias');
        const real = path.join(root, 'real');
        fs.mkdirSync(real);
        const alias = path.join(root, 'alias');
        let linked = true;
        try {
            fs.symlinkSync(real, alias, process.platform === 'win32' ? 'junction' : 'dir');
        } catch (_) { linked = false; }
        if (linked) {
            assert.notStrictEqual(canonPath(real), canonPath(alias),
                'fixture validity: the two paths must differ lexically or this proves nothing');
            assert.strictEqual(pathIdentity(real, alias), 'SAME',
                'an alias of the same directory must resolve to SAME, not DISTINCT');
        }

        const other = path.join(root, 'other');
        fs.mkdirSync(other);
        assert.strictEqual(pathIdentity(real, other), 'DISTINCT',
            'two resolvable, genuinely different directories must be DISTINCT');
    }

    console.log('HP3. path identity: unresolvable is UNESTABLISHED, never SAME or DISTINCT ...');
    {
        const root = tmp('unres');
        const present = path.join(root, 'present');
        fs.mkdirSync(present);
        const missing = path.join(root, 'missing');

        assert.strictEqual(pathIdentity(present, missing), 'UNESTABLISHED',
            'a path that cannot be resolved must not be reported as DISTINCT');

        const boom = {
            realpathSync: Object.assign(() => { throw Object.assign(new Error('boom'), { code: 'EACCES' }); },
                { native: () => { throw Object.assign(new Error('boom'), { code: 'EACCES' }); } }),
        };
        assert.strictEqual(pathIdentity(present, path.join(root, 'elsewhere'), boom), 'UNESTABLISHED',
            'a permission failure during resolution must be UNESTABLISHED');
    }

    console.log('HP3b. path identity: the NATIVE resolver is the one consulted ...');
    {
        // Post-approval evidence amendment. Every other fixture resolves
        // identically through fs.realpathSync and fs.realpathSync.native — the
        // boom mock makes both throw, and real directories resolve the same way
        // either way — so nothing here could catch a regression to the pure-JS
        // resolver. That choice was deliberate (see the same reasoning at
        // templates/cli/takeover-receipt.js:16): only the native call returns the
        // on-disk casing that the case rule in HP1 depends on, which makes this
        // gap the one that would hide the other.
        //
        // Here the two resolvers disagree, so the verdict itself reveals which
        // one was asked.
        const calls = { base: 0, native: 0 };
        const split = {
            realpathSync: Object.assign(
                () => { calls.base += 1; return '/conflated'; },
                { native: (p) => { calls.native += 1; return `/native${p}`; } }),
        };
        assert.strictEqual(pathIdentity('/x/a', '/x/b', split), 'DISTINCT',
            'the verdict must follow realpathSync.native, which separates these, not the base resolver, which conflates them');
        assert.strictEqual(calls.base, 0, 'the pure-JS resolver must never be consulted');
        assert.strictEqual(calls.native, 2, 'both sides are resolved through the native resolver');
    }

    console.log('--- hook-provenance tests passed! ---');
}

module.exports = { runHookProvenanceTests };
