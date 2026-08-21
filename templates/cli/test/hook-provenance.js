'use strict';
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { pathIdentity, canonPath } = require('../hook-provenance/path-identity');

function tmp(name) {
    return fs.mkdtempSync(path.join(os.tmpdir(), `evo-hp-${name}-`));
}

function validateOk(raw) {
    const { validateHookProvenanceV1 } = require('../hook-provenance/schema');
    return validateHookProvenanceV1(raw).ok;
}

function participatingDoc(S) {
    const ev = {
        seq: 1, recordedAt: '2026-08-18T00:00:00.000Z',
        intent: { participation: 'participating', source: 'scaffold-default' },
        install: {
            outcome: 'realized', reason: 'created-managed-hook',
            targetPath: '/r/.git/hooks/post-commit', expectedBodyDigest: 'sha256:' + 'a'.repeat(64),
            chmod: { attempted: true, threw: false },
        },
        runnability: {
            verdict: 'indeterminate',
            locator: { verdict: 'satisfied', reason: null },
            executable: { verdict: 'indeterminate', reason: 'no-qualified-predicate' },
            interpreter: { verdict: 'satisfied', reason: null },
        },
        resultingCurrentDigest: S.currentDigest('participating'),
    };
    ev.id = S.eventId(ev);
    return {
        kind: S.KIND, schemaVersion: S.SCHEMA_VERSION,
        current: { participation: 'participating', derivedFrom: ev.id },
        events: [ev],
    };
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

    console.log('HP4. schema: projection is fixed-length and excludes diagnostic ...');
    {
        const S = require('../hook-provenance/schema');
        const optOut = {
            seq: 1, id: 'sha256:x', recordedAt: '2026-08-18T00:00:00.000Z',
            intent: { participation: 'non-participating', source: 'scaffold-no-hooks' },
            resultingCurrentDigest: S.currentDigest('non-participating'),
            diagnostic: { gitVersion: '2.48.1' },
        };
        const full = JSON.parse(JSON.stringify(optOut));
        full.intent = { participation: 'participating', source: 'scaffold-default' };
        full.install = {
            outcome: 'realized', reason: 'created-managed-hook',
            targetPath: '/r/.git/hooks/post-commit', expectedBodyDigest: 'sha256:b',
            chmod: { attempted: true, threw: false },
        };
        full.runnability = {
            verdict: 'indeterminate',
            locator: { verdict: 'satisfied', reason: null },
            executable: { verdict: 'indeterminate', reason: 'no-qualified-predicate' },
            interpreter: { verdict: 'satisfied', reason: null },
        };
        full.resultingCurrentDigest = S.currentDigest('participating');

        assert.strictEqual(S.eventProjection(optOut).length, 20, 'projection must be 20 slots');
        assert.strictEqual(S.eventProjection(full).length, 20,
            'projection length must not vary with event kind');

        const before = S.eventId(full);
        full.diagnostic = { gitVersion: '9.9.9', coreFileMode: true, shebang: '#!/bin/bash' };
        assert.strictEqual(S.eventId(full), before, 'diagnostic must not affect event identity');
        full.recordedAt = '2026-08-19T00:00:00.000Z';
        assert.notStrictEqual(S.eventId(full), before, 'recordedAt participates in identity');
    }

    console.log('HP5. schema: aggregation is mechanical ...');
    {
        const { aggregateRunnability } = require('../hook-provenance/schema');
        const c = v => ({ verdict: v, reason: v === 'satisfied' ? null : 'no-qualified-predicate' });
        assert.strictEqual(aggregateRunnability({
            locator: c('satisfied'), executable: c('satisfied'), interpreter: c('satisfied'),
        }), 'satisfied');
        assert.strictEqual(aggregateRunnability({
            locator: c('satisfied'), executable: c('indeterminate'), interpreter: c('satisfied'),
        }), 'indeterminate');
        assert.strictEqual(aggregateRunnability({
            locator: c('not-satisfied'), executable: c('indeterminate'), interpreter: c('satisfied'),
        }), 'not-satisfied', 'not-satisfied dominates indeterminate');

        // A component that is present but unreadable is a failure to observe.
        // It must never aggregate to the most permissive answer.
        assert.strictEqual(aggregateRunnability({
            locator: c('satisfied'), executable: { verdict: 'wat' }, interpreter: c('satisfied'),
        }), 'indeterminate', 'an unrecognised component verdict is not positive evidence');
        assert.strictEqual(aggregateRunnability({
            locator: c('satisfied'), executable: {}, interpreter: c('satisfied'),
        }), 'indeterminate', 'a component carrying no verdict is not positive evidence');
        assert.strictEqual(aggregateRunnability({
            locator: c('satisfied'), interpreter: c('satisfied'),
        }), 'indeterminate', 'an absent component is not positive evidence');
    }

    console.log('HP6. validator: the four integrity rules and the shape rules ...');
    {
        const S = require('../hook-provenance/schema');
        const makeDoc = () => {
            const ev = {
                seq: 1, recordedAt: '2026-08-18T00:00:00.000Z',
                intent: { participation: 'non-participating', source: 'scaffold-no-hooks' },
                resultingCurrentDigest: S.currentDigest('non-participating'),
            };
            ev.id = S.eventId(ev);
            return {
                kind: S.KIND, schemaVersion: S.SCHEMA_VERSION,
                current: { participation: 'non-participating', derivedFrom: ev.id },
                events: [ev],
            };
        };

        assert.strictEqual(validateOk(makeDoc()), true, 'a well-formed document must validate');

        // C-2a
        const a = makeDoc(); a.current.derivedFrom = 'sha256:' + '0'.repeat(64);
        assert.strictEqual(validateOk(a), false, 'C-2a: derivedFrom must equal the last event id');

        // C-2b + C-2c together: current contradicts the intent that produced it,
        // while derivedFrom and the digest are both recomputed correctly.
        const b = makeDoc();
        b.current.participation = 'participating';
        b.events[0].resultingCurrentDigest = S.currentDigest('participating');
        b.events[0].id = S.eventId(b.events[0]);
        b.current.derivedFrom = b.events[0].id;
        assert.strictEqual(validateOk(b), false,
            'C-2c: participating current over a non-participating intent must be rejected');

        // C-2b ALONE. Fixture b recomputes the digest correctly, so C-2c is the
        // only rule it can violate. Here derivedFrom and participation are both
        // coherent and only the stored digest disagrees, so C-2b is the sole
        // guard and deleting it turns this assertion red.
        const b2 = makeDoc();
        b2.events[0].resultingCurrentDigest = S.currentDigest('participating');
        b2.events[0].id = S.eventId(b2.events[0]);
        b2.current.derivedFrom = b2.events[0].id;
        assert.strictEqual(validateOk(b2), false,
            'C-2b: resultingCurrentDigest must equal the digest of current.participation');

        // C-2d
        const d = makeDoc();
        d.events[0].intent = { participation: 'non-participating', source: 'hook-install-command' };
        d.events[0].id = S.eventId(d.events[0]);
        d.current.derivedFrom = d.events[0].id;
        assert.strictEqual(validateOk(d), false,
            'C-2d: an explicit install may not be recorded as an explicit opt-out');

        // Conditional shape
        const e = makeDoc();
        e.events[0].install = { outcome: 'realized', reason: 'created-managed-hook',
            targetPath: '/x', expectedBodyDigest: 'sha256:b', chmod: { attempted: true, threw: false } };
        e.events[0].id = S.eventId(e.events[0]);
        e.current.derivedFrom = e.events[0].id;
        assert.strictEqual(validateOk(e), false,
            'a non-participating event must carry no install');

        // Stored verdict may not overrule the rule that produced it
        const f = participatingDoc(S);
        f.events[0].runnability.verdict = 'satisfied';
        f.events[0].runnability.executable = { verdict: 'not-satisfied',
            reason: 'predicate-reports-not-executable' };
        f.events[0].id = S.eventId(f.events[0]);
        f.current.derivedFrom = f.events[0].id;
        assert.strictEqual(validateOk(f), false,
            'runnability.verdict must equal the aggregation of its components');

        // Unknown vocabulary in the last event
        const g = participatingDoc(S);
        g.events[0].install.reason = 'already-current';
        g.events[0].id = S.eventId(g.events[0]);
        g.current.derivedFrom = g.events[0].id;
        assert.strictEqual(validateOk(g), false, 'already-current is not a v1 reason');

        // chmod is present if and only if a write was attempted
        const i = participatingDoc(S);
        i.events[0].install = { outcome: 'unrealized', reason: 'hooks-dir-missing',
            targetPath: '/x/post-commit', chmod: { attempted: false, threw: false } };
        delete i.events[0].runnability;
        i.events[0].id = S.eventId(i.events[0]);
        i.current.derivedFrom = i.events[0].id;
        assert.strictEqual(validateOk(i), false,
            'a pre-write outcome must carry no chmod: no write was attempted');

        const j = participatingDoc(S);
        delete j.events[0].install.chmod;
        j.events[0].id = S.eventId(j.events[0]);
        j.current.derivedFrom = j.events[0].id;
        assert.strictEqual(validateOk(j), false,
            'an outcome that follows an issued write must carry chmod');

        // ...but the record may say the chmod was skipped. Presence is fixed to
        // the write phase; the value of `attempted` is the producer's report.
        const cf = participatingDoc(S);
        cf.events[0].install.chmod = { attempted: false, threw: false };
        cf.events[0].id = S.eventId(cf.events[0]);
        cf.current.derivedFrom = cf.events[0].id;
        assert.strictEqual(validateOk(cf), true,
            'an issued write whose chmod was skipped is a legal v1 record');

        const cfBad = participatingDoc(S);
        cfBad.events[0].install.chmod = { attempted: 'yes', threw: false };
        cfBad.events[0].id = S.eventId(cfBad.events[0]);
        cfBad.current.derivedFrom = cfBad.events[0].id;
        assert.strictEqual(validateOk(cfBad), false,
            'chmod fields stay typed: attempted must be a boolean');

        // pre-write-observation-failed is a phase-1 outcome: no write was issued,
        // so it carries no chmod. This is the member the amendment added, and the
        // one a reason-list implementation is most likely to put on the wrong side.
        const pw = participatingDoc(S);
        pw.events[0].install = { outcome: 'indeterminate', reason: 'pre-write-observation-failed',
            targetPath: '/r/.git/hooks/post-commit' };
        delete pw.events[0].runnability;
        pw.events[0].id = S.eventId(pw.events[0]);
        pw.current.derivedFrom = pw.events[0].id;
        assert.strictEqual(validateOk(pw), true,
            'pre-write-observation-failed with no chmod is a legal v1 event');

        const pwBad = JSON.parse(JSON.stringify(pw));
        pwBad.events[0].install.chmod = { attempted: true, threw: false };
        pwBad.events[0].id = S.eventId(pwBad.events[0]);
        pwBad.current.derivedFrom = pwBad.events[0].id;
        assert.strictEqual(validateOk(pwBad), false,
            'and it must not claim a chmod: the write was never issued');

        // current.digest was deleted by the design; the shared validator must not
        // quietly re-admit it as a third representation of current.participation.
        const cd = makeDoc();
        cd.current.digest = S.currentDigest(cd.current.participation);
        assert.strictEqual(validateOk(cd), false, 'current.digest must not exist');

        // runnability has no top-level reason
        const k = participatingDoc(S);
        k.events[0].runnability.reason = 'no-qualified-predicate';
        k.events[0].id = S.eventId(k.events[0]);
        k.current.derivedFrom = k.events[0].id;
        assert.strictEqual(validateOk(k), false, 'runnability must have no top-level reason');

        // Interior events are deliberately not inspected
        const h = participatingDoc(S);
        h.events.unshift({ seq: 0, id: 'nonsense', intent: { participation: 'wat', source: 'wat' } });
        assert.strictEqual(validateOk(h), true,
            'a malformed interior event must not change the reader state');
    }

    console.log('HP7 step 0. fixture validity: the temp root has no git ancestor ...');
    {
        const { execFileSync } = require('child_process');
        const probe = tmp('fixture-gate');
        let status;
        try {
            execFileSync('git', ['-C', probe, 'rev-parse', '--show-toplevel'],
                { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
                  env: { ...process.env, LC_ALL: 'C', LC_MESSAGES: 'C', LANGUAGE: '' } });
            status = 0;
        } catch (err) {
            status = typeof err.status === 'number' ? err.status : null;
        }
        assert.notStrictEqual(status, 0,
            'FIXTURE INVALID, not a classifier failure: os.tmpdir() lies inside a git '
          + 'repository on this host, so every NO-GIT-ADMIN-TOPOLOGY fixture below '
          + 'would be asserting something it cannot mean');
    }

    console.log('HP7. topology: the scope gate is total ...');
    {
        const { classifyTopology } = require('../hook-provenance/topology');
        const root = tmp('scope');
        const { execFileSync } = require('child_process');
        execFileSync('git', ['-C', root, 'init', '-q'], { stdio: 'ignore' });
        const child = path.join(root, 'child');
        fs.mkdirSync(child);

        assert.strictEqual(classifyTopology(root).state, 'IN-SCOPE',
            'a worktree top-level target is in scope');

        // Task 3 claims the storage half of ac1, so it proves the layout it
        // produces. The two literal segments are the contract; comparing only the
        // git-dir would hold for any two trailing segments.
        const inScope = classifyTopology(root);
        assert.strictEqual(path.basename(inScope.provenancePath), 'hook-provenance.json',
            'the document is named hook-provenance.json');
        assert.strictEqual(path.basename(path.dirname(inScope.provenancePath)), 'evo-lite',
            'it lives in the evo-lite subdirectory');
        assert.strictEqual(
            pathIdentity(path.dirname(path.dirname(inScope.provenancePath)),
                path.join(root, '.git')),
            'SAME',
            'and that subdirectory is inside the TARGET git-dir');

        assert.strictEqual(classifyTopology(child).state, 'NESTED-TARGET',
            'a nested directory must not claim the enclosing worktree');

        const plain = tmp('plain');
        assert.strictEqual(classifyTopology(plain).state, 'NO-GIT-ADMIN-TOPOLOGY',
            'a non-repository must not be swallowed into SCOPE-UNRESOLVED');

        // A non-zero exit is not an authority on "no repository": a BARE repo also
        // exits 128, with a different message, and it is a query failure.
        const bare = tmp('bare');
        execFileSync('git', ['init', '-q', '--bare', bare], { stdio: 'ignore' });
        assert.strictEqual(classifyTopology(bare).state, 'SCOPE-UNRESOLVED',
            'a bare repository exits 128 but is NOT a positive not-a-repository answer');

        // The owner gate uses the SAME taxonomy. Injected sequentially: the scope
        // query succeeds, the owner query then answers not-a-repository.
        const seq = (() => {
            let n = 0;
            return (dir, args) => {
                n += 1;
                if (n === 1) return { status: 0, stdout: root, stderr: '' };
                return { status: 128, stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git\n' };
            };
        })();
        assert.strictEqual(classifyTopology(root, { gitQuery: seq }).state, 'NO-GIT-ADMIN-TOPOLOGY',
            'a positive not-a-repository answer at the owner gate is the same topology fact');

        const seqOther = (() => {
            let n = 0;
            return () => {
                n += 1;
                if (n === 1) return { status: 0, stdout: root, stderr: '' };
                return { status: 128, stdout: '', stderr: 'fatal: this operation must be run in a work tree\n' };
            };
        })();
        assert.strictEqual(classifyTopology(root, { gitQuery: seqOther }).state, 'OWNER-UNRESOLVED',
            'any other owner-query failure stays OWNER-UNRESOLVED');

        const unavailable = () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
        assert.strictEqual(classifyTopology(root, { gitQuery: unavailable }).state, 'SCOPE-UNRESOLVED',
            'an unavailable git must be SCOPE-UNRESOLVED');

        // The owner catch is unreachable through `unavailable` above: that injector
        // throws on the FIRST call, so the scope gate answers and the owner gate is
        // never entered. This sequence lets scope succeed and makes ONLY the owner
        // query throw, so the owner catch is the one thing that can produce this
        // verdict — a repository that is removed, or a git that stops being
        // spawnable, between the two queries.
        const throwOnOwner = (() => {
            let n = 0;
            return () => {
                n += 1;
                if (n === 1) return { status: 0, stdout: root, stderr: '' };
                throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
            };
        })();
        assert.strictEqual(classifyTopology(root, { gitQuery: throwOnOwner }).state,
            'OWNER-UNRESOLVED',
            'a git that stops answering between the scope and owner queries is '
          + 'OWNER-UNRESOLVED, never SCOPE-UNRESOLVED');

        // NESTED-TARGET is reachable from DISTINCT alone.
        const failingRealpath = {
            realpathSync: Object.assign(() => { throw new Error('x'); },
                { native: () => { throw Object.assign(new Error('x'), { code: 'EACCES' }); } }),
        };
        const injected = classifyTopology(child, { fsOps: failingRealpath });
        assert.strictEqual(injected.state, 'SCOPE-UNRESOLVED',
            'an unresolvable comparison must be SCOPE-UNRESOLVED, never NESTED-TARGET');
    }

    console.log('HP8. topology: owner path comes from the bound authority ...');
    {
        const { classifyTopology } = require('../hook-provenance/topology');
        const { execFileSync } = require('child_process');
        const outer = tmp('bindA');
        const inner = tmp('bindB');
        execFileSync('git', ['-C', outer, 'init', '-q'], { stdio: 'ignore' });
        execFileSync('git', ['-C', inner, 'init', '-q'], { stdio: 'ignore' });

        // M6a removes the binding from the OWNER query only, so the scope query
        // still answers for B and this fixture-validity assertion stays green —
        // the red then lands on the owner assertion below rather than absorbing
        // the mutation here. Dropping the binding from both queries would make
        // pathIdentity(inner, outer) DISTINCT, turn this into NESTED-TARGET, and
        // fail on the wrong line.
        const prev = process.cwd();
        process.chdir(outer);
        try {
            const r = classifyTopology(inner);
            assert.strictEqual(r.state, 'IN-SCOPE', 'fixture validity: B must classify as in scope');
            assert.strictEqual(
                require('../hook-provenance/path-identity').pathIdentity(
                    path.dirname(path.dirname(r.provenancePath)), path.join(inner, '.git')),
                'SAME',
                'the owner must be the TARGET git-dir, never the caller cwd git-dir');
        } finally { process.chdir(prev); }
    }

    console.log('--- hook-provenance tests passed! ---');
}

module.exports = { runHookProvenanceTests };
