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
        const { classifyTopology, defaultGitQuery } = require('../hook-provenance/topology');
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
        //
        // ONE QUESTION, ONE AUTHORITY. This block answers what the path LOOKS
        // LIKE. It must not also answer WHOSE git-dir it is: HP8 owns that, and
        // owns it deliberately, by manufacturing a cwd/target divergence. The
        // injected query answers for the TARGET no matter what the classifier
        // passes it, so a mutation that unbinds the owner query stays invisible
        // here and travels on to HP8's guard. The earlier version of this block
        // caught that mutation, but only because the suite happens to run inside
        // a different repository — an ambient accident, not a guard. It shadowed
        // HP8 and left HP8's assertion unwitnessed.
        const boundToTarget = (dir, args) => defaultGitQuery(root, args);
        const inScope = classifyTopology(root, { gitQuery: boundToTarget });
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

    console.log('HP9. observation: the errno mapping is frozen ...');
    {
        const { observeHooksDir } = require('../hook-provenance/observe');
        const root = tmp('errno');
        const dir = path.join(root, 'hooks');
        fs.mkdirSync(dir);
        assert.strictEqual(observeHooksDir(dir).outcome, null, 'a real directory is usable');

        assert.deepStrictEqual(observeHooksDir(path.join(root, 'gone')),
            { outcome: 'unrealized', reason: 'hooks-dir-missing' });

        const file = path.join(root, 'afile');
        fs.writeFileSync(file, 'x');
        assert.deepStrictEqual(observeHooksDir(file),
            { outcome: 'unrealized', reason: 'hooks-dir-not-directory' });

        const eacces = { statSync: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } };
        assert.deepStrictEqual(observeHooksDir(dir, eacces),
            { outcome: 'indeterminate', reason: 'hooks-dir-unobservable' },
            'a permission error is a failure to observe, never unrealized');
    }

    console.log('HP10. observation: executable has no qualified predicate without controllers ...');
    {
        const { observeExecutable } = require('../hook-provenance/observe');
        const root = tmp('exec');
        const hook = path.join(root, 'post-commit');
        fs.writeFileSync(hook, '#!/bin/sh\nexit 0\n');
        // v1 ships no qualified predicate, so this is exact, not a range. A range
        // would let someone replace the body with a constant `satisfied` and stay green.
        assert.deepStrictEqual(
            { verdict: observeExecutable(hook).verdict, reason: observeExecutable(hook).reason },
            { verdict: 'indeterminate', reason: 'no-qualified-predicate' },
            'v1 has no qualified executable predicate on any host');
        const src = fs.readFileSync(
            path.join(__dirname, '..', 'hook-provenance', 'observe.js'), 'utf8');
        assert.ok(!/X_OK/.test(src),
            'accessSync X_OK has no discriminating power and must appear nowhere');
        assert.ok(!/process\.platform/.test(src),
            'no verdict may key off the platform constant');
    }

    console.log('HP11. observation: interpreter is aligned, and never guesses ...');
    {
        const { observeInterpreter } = require('../hook-provenance/observe');
        const root = tmp('interp');

        const shHook = path.join(root, 'sh'); fs.writeFileSync(shHook, '#!/bin/sh\nexit 0\n');
        const sh = observeInterpreter(shHook);
        // On a host with no /bin/sh the honest answer is no-safe-parser, not a
        // verdict; asserting `satisfied` unconditionally would demand a fact the
        // host cannot supply.
        assert.ok(sh.verdict === 'satisfied'
            || (sh.verdict === 'indeterminate' && sh.reason === 'no-safe-parser'),
            `a valid sh hook is satisfied where sh exists, otherwise no-safe-parser (got ${JSON.stringify(sh)})`);

        // "Aligned" is asserted on WHICH binary was consulted, not on a grammar
        // difference between sh and bash. Measured on the Windows/msys development
        // host, `sh` IS bash (GNU bash 5.2.37), so every syntax-difference fixture
        // — including array literals — exits 0 under both, and a hardcoded `sh -n`
        // mutation could never be falsified there. Observing the argv makes this
        // control host-independent.
        //
        // The declared entry is a FIXED supported path, and both fs calls are
        // injected, so the control does not depend on this host having that shell
        // installed — otherwise a CORRECT implementation would fail it wherever
        // /bin/bash happens not to exist. Fabricating a path under the temp root
        // instead, as an earlier draft did, would prove nothing: the control would
        // only show that the implementation stats and spawns the same string,
        // which is true of a basename allowlist too.
        const declared = '/bin/bash';
        const bashHook = path.join(root, 'bash');
        fs.writeFileSync(bashHook, '#!' + declared + '\na=(one two)\necho "${a[0]}"\n');
        const invoked = [];
        const statted = [];
        const spy = Object.create(fs);
        spy.statSync = (p) => { statted.push(String(p)); return { isFile: () => true }; };
        spy.__execFileSync = (bin) => { invoked.push(bin); return ''; };
        const b = observeInterpreter(bashHook, spy);
        assert.deepStrictEqual(statted, [declared],
            'presence is established for the DECLARED entry, not for a name resolved elsewhere');
        assert.deepStrictEqual(invoked, [declared],
            `the syntax check runs through that SAME declared entry (saw ${invoked.join(', ')})`);
        assert.strictEqual(b.verdict, 'satisfied');

        // A qualified entry that is not present. This is the only route to
        // no-safe-parser now that unqualified paths are ambiguous, so it is
        // injected rather than relying on a path this host happens to lack.
        const absent = Object.create(fs);
        absent.statSync = () => { throw Object.assign(new Error('nope'), { code: 'ENOENT' }); };
        assert.deepStrictEqual(observeInterpreter(bashHook, absent),
            { verdict: 'indeterminate', reason: 'no-safe-parser', shebang: '#!' + declared },
            'a qualified interpreter that is not present is indeterminate, never satisfied');

        // The one route to not-satisfied in v1: a qualified, present interpreter
        // rejects the body's syntax. `incompatible-interpreter` is unreachable
        // here by design — see the note in observe.js.
        const rejecting = Object.create(fs);
        rejecting.statSync = () => ({ isFile: () => true });
        rejecting.__execFileSync = () => { throw Object.assign(new Error('parse error'), { status: 2 }); };
        assert.deepStrictEqual(observeInterpreter(bashHook, rejecting),
            { verdict: 'not-satisfied', reason: 'syntax-rejected', shebang: '#!' + declared });

        const none = path.join(root, 'none'); fs.writeFileSync(none, 'echo hi\n');
        assert.strictEqual(observeInterpreter(none).verdict, 'indeterminate');
        assert.strictEqual(observeInterpreter(none).reason, 'missing-shebang');

        // Every form v1 cannot prove end to end is ambiguous — the env wrapper,
        // which v1 deliberately does not support; any trailing token; a relative
        // entry; and any absolute path outside the supported set, however it is
        // named. Measured: `#!env bash` exits 127 ("required file not found")
        // while a PATH bash would answer satisfied; a /tmp/env that exists without
        // the executable bit passes stat while the hook exits 126; and a stub at
        // <tmp>/fake/bash that ignores its arguments and exits 0 passes a basename
        // check, a stat and a `-n` spawn while being no shell at all. None of
        // these is a state this observer may turn into a positive verdict.
        for (const [name, line] of [
            ['relbash', '#!bash'],
            ['tmpbash', '#!/tmp/tools/bash'],
            ['py', '#!/usr/bin/python3'],
            ['barenv', '#!env bash'],
            ['envbash', '#!/usr/bin/env bash'],
            ['envs', '#!/usr/bin/env -S bash -e'],
            ['envopt', '#!/usr/bin/env bash -e'],
            ['bashopt', '#!/bin/bash --definitely-invalid-option'],
        ]) {
            const p = path.join(root, name);
            fs.writeFileSync(p, line + '\nexit 0\n');
            const v = observeInterpreter(p);
            // reason FIRST, deliberately. Several of these forms would still be
            // `indeterminate` under a broken parser — `#!bash` that slipped past
            // the absolute check merely fails the presence gate and lands on
            // no-safe-parser — so asserting the verdict first would leave the
            // mutations aimed here with no guard they can actually turn red.
            assert.strictEqual(v.reason, 'ambiguous-interpreter',
                `${line} is not a form v1 can prove end to end, so it is ambiguous`);
            assert.strictEqual(v.verdict, 'indeterminate', `verdict for ${line}`);
        }
    }

    console.log('HP12. observation: locator compares directory to directory ...');
    {
        const { observeLocator } = require('../hook-provenance/observe');
        // defaultGitQuery comes from topology, which exports it. observe.js
        // consumes it but does not re-export, and adding an export would be a
        // production change this repair is not allowed to make.
        const { defaultGitQuery } = require('../hook-provenance/topology');
        const { execFileSync } = require('child_process');
        const repo = tmp('loc');
        execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
        const targetPath = path.join(repo, '.git', 'hooks', 'post-commit');

        // ONE QUESTION, ONE AUTHORITY. This block asks whether the comparison is
        // made directory-to-directory. It must NOT also answer whose git-dir was
        // asked: HP12b owns that, and owns it deliberately by standing in A while
        // targeting B. The injected query still runs real Git -- so core.hooksPath
        // below is genuinely read -- but always against the TARGET, whatever the
        // observer passes it. Without this, an unbinding mutation was caught here
        // instead, and only because the suite happens to run inside a different
        // repository: an ambient accident that shadowed HP12b and left the
        // load-bearing guard unwitnessed.
        const boundToRepo = (dir, args) => defaultGitQuery(repo, args);

        assert.deepStrictEqual(observeLocator({ targetDir: repo, targetPath, gitQuery: boundToRepo }),
            { verdict: 'satisfied', reason: null },
            'a default installation must be satisfied, not a directory-vs-file mismatch');

        const elsewhere = path.join(repo, 'other-hooks');
        fs.mkdirSync(elsewhere);
        execFileSync('git', ['-C', repo, 'config', 'core.hooksPath', elsewhere], { stdio: 'ignore' });
        assert.deepStrictEqual(observeLocator({ targetDir: repo, targetPath, gitQuery: boundToRepo }),
            { verdict: 'not-satisfied', reason: 'active-hooks-dir-differs' });

        // Three distinct ways to fail to OBSERVE. Each is asserted on its own so
        // each has a guard a mutation can turn red; a single combined assertion
        // would let one branch hide behind another.
        const unaskable = () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
        assert.deepStrictEqual(
            observeLocator({ targetDir: repo, targetPath, gitQuery: unaskable }),
            { verdict: 'indeterminate', reason: 'authority-query-unavailable' },
            'an authority that cannot be asked is indeterminate, never not-satisfied');

        const refusing = () => ({ status: 128, stdout: '', stderr: 'fatal: something else\n' });
        assert.deepStrictEqual(
            observeLocator({ targetDir: repo, targetPath, gitQuery: refusing }),
            { verdict: 'indeterminate', reason: 'authority-query-failed' },
            'an authority that answers with a failure is indeterminate, never not-satisfied');

        // The two paths differ lexically, so the comparison must reach physical
        // resolution — which the injected fsOps then refuses. UNESTABLISHED is
        // precisely the state in which no verdict about the location is earned.
        const unresolvable = {
            realpathSync: Object.assign(() => { throw new Error('x'); },
                { native: () => { throw Object.assign(new Error('x'), { code: 'EACCES' }); } }),
        };
        const answering = () => ({ status: 0, stdout: '/some/other/hooks', stderr: '' });
        assert.deepStrictEqual(
            observeLocator({ targetDir: repo, targetPath, gitQuery: answering, fsOps: unresolvable }),
            { verdict: 'indeterminate', reason: 'path-comparison-ambiguous' },
            'a comparison that cannot be established is indeterminate, never not-satisfied');

        // ac6 forbids falling back to the relative form and resolving it here.
        // Asserted against the source, like HP10's X_OK guard, because a fallback
        // fires only where the primary query is unsupported — a state no fixture
        // on this host can reach. The legitimate query names --git-path exactly
        // once; a fallback necessarily adds a second.
        const locSrc = fs.readFileSync(
            path.join(__dirname, '..', 'hook-provenance', 'observe.js'), 'utf8');
        assert.strictEqual((locSrc.match(/--git-path/g) || []).length, 1,
            'ac6: exactly one hooks-path query may exist, so nothing can fall back '
          + 'to the relative form and resolve it itself');
        assert.ok(/--path-format=absolute/.test(locSrc),
            'ac6: and that one query asks the authority for an absolute answer');
    }

    console.log('HP12b. observation: the locator query is bound to B, not to the caller ...');
    {
        const { observeLocator } = require('../hook-provenance/observe');
        const { execFileSync } = require('child_process');
        const A = tmp('locA');
        const B = tmp('locB');
        execFileSync('git', ['-C', A, 'init', '-q'], { stdio: 'ignore' });
        execFileSync('git', ['-C', B, 'init', '-q'], { stdio: 'ignore' });
        // A's active hooks directory is redirected, so an unbound query would
        // answer with A's and report B's ordinary installation as not-satisfied.
        const decoy = path.join(A, 'decoy-hooks');
        fs.mkdirSync(decoy);
        execFileSync('git', ['-C', A, 'config', 'core.hooksPath', decoy], { stdio: 'ignore' });

        const prev = process.cwd();
        process.chdir(A);
        try {
            assert.deepStrictEqual(
                observeLocator({ targetDir: B, targetPath: path.join(B, '.git', 'hooks', 'post-commit') }),
                { verdict: 'satisfied', reason: null },
                'the active hooks directory must be B\'s, even when the caller stands in A');
        } finally { process.chdir(prev); }
    }

    console.log('HP13. observation: observeRunnability yields a shape the shared validator accepts ...');
    {
        const { observeRunnability } = require('../hook-provenance/observe');
        const S = require('../hook-provenance/schema');
        const { execFileSync } = require('child_process');
        const repo = tmp('runnab');
        execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
        const targetPath = path.join(repo, '.git', 'hooks', 'post-commit');
        fs.writeFileSync(targetPath, '#!/bin/sh\nexit 0\n');

        const { runnability, diagnostic } = observeRunnability({ targetDir: repo, targetPath });

        assert.deepStrictEqual(Object.keys(runnability).sort(),
            ['executable', 'interpreter', 'locator', 'verdict'],
            'runnability carries the verdict and the three components, nothing else');
        for (const name of ['locator', 'executable', 'interpreter']) {
            assert.deepStrictEqual(Object.keys(runnability[name]).sort(), ['reason', 'verdict'],
                `${name} is stripped to { verdict, reason } — no diagnostic leaks into a verdict`);
        }
        assert.strictEqual(runnability.reason, undefined, 'runnability has no top-level reason');

        // The verdict must be the SHARED aggregation, not one computed here. Two
        // authorities answering "is this runnable" is exactly what this contract
        // forbids.
        assert.strictEqual(runnability.verdict, S.aggregateRunnability(runnability),
            'the verdict is the shared mechanical aggregation of its components');

        // Interface self-proof: the ONE shared validator accepts an event carrying
        // this runnability, so the producer can never be handed a shape its own
        // store will reject. This is not Task 6's transaction — nothing is stored.
        const ev = {
            seq: 1, recordedAt: '2026-08-18T00:00:00.000Z',
            intent: { participation: 'participating', source: 'scaffold-default' },
            install: {
                outcome: 'realized', reason: 'created-managed-hook', targetPath,
                expectedBodyDigest: 'sha256:' + 'a'.repeat(64),
                chmod: { attempted: true, threw: false },
            },
            runnability,
            resultingCurrentDigest: S.currentDigest('participating'),
        };
        ev.id = S.eventId(ev);
        const doc = {
            kind: S.KIND, schemaVersion: S.SCHEMA_VERSION,
            current: { participation: 'participating', derivedFrom: ev.id },
            events: [ev],
        };
        const verdict = S.validateHookProvenanceV1(doc);
        assert.strictEqual(verdict.ok, true,
            `the shared validator accepts this runnability (${JSON.stringify(verdict.errors)})`);

        assert.deepStrictEqual(Object.keys(diagnostic).sort(),
            ['executablePredicate', 'predicateQualification', 'shebang'],
            'diagnostic carries the raw observations and never feeds a verdict');
    }

    console.log('HP14. store: only a positive ENOENT makes the document ABSENT ...');
    {
        const { readProvenance } = require('../hook-provenance/store');
        const root = tmp('read');
        const p = path.join(root, 'hook-provenance.json');
        assert.strictEqual(readProvenance(p).state, 'ABSENT');

        fs.writeFileSync(p, '{ not json');
        assert.strictEqual(readProvenance(p).state, 'UNOBSERVABLE');

        const eacces = { readFileSync: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } };
        assert.strictEqual(readProvenance(p, eacces).state, 'UNOBSERVABLE',
            'a permission error must not be reported as ABSENT');

        const src = fs.readFileSync(path.join(__dirname, '..', 'hook-provenance', 'store.js'), 'utf8');
        assert.ok(!/existsSync/.test(src),
            'existsSync collapses "not there" and "could not look" at the one place it becomes UNKNOWN');

        // A document that parses cleanly but violates v1. This is the ONLY thing
        // Task 5 must prove about the seam: that the reader really hands
        // well-formed JSON to the ONE shared validator and obeys its answer.
        // Task 2 owns each individual rule; re-proving them here would put two
        // authorities on one question.
        const S = require('../hook-provenance/schema');
        const seamEv = {
            seq: 1, recordedAt: '2026-08-18T00:00:00.000Z',
            intent: { participation: 'non-participating', source: 'scaffold-no-hooks' },
            resultingCurrentDigest: S.currentDigest('non-participating'),
        };
        seamEv.id = S.eventId(seamEv);
        const seam = {
            kind: S.KIND, schemaVersion: S.SCHEMA_VERSION,
            current: { participation: 'non-participating', derivedFrom: seamEv.id },
            events: [seamEv],
        };
        assert.strictEqual(S.validateHookProvenanceV1(seam).ok, true,
            'fixture validity: the seam document must be VALID before one field is broken');
        // Break exactly one rule, and one that cannot be mistaken for anything
        // else: derivedFrom stays a well-formed digest, so this is C-2a alone.
        seam.current.derivedFrom = 'sha256:' + '0'.repeat(64);

        const seamPath = path.join(root, 'seam.json');
        fs.writeFileSync(seamPath, JSON.stringify(seam, null, 2) + '\n', 'utf8');
        const seamRead = readProvenance(seamPath);
        assert.strictEqual(seamRead.state, 'UNOBSERVABLE',
            'a document that parses but fails the shared validator is UNOBSERVABLE');
        assert.ok(seamRead.errors.some(e => /C-2a/.test(e)),
            'and the reason comes from the validator, not from parsing');
    }

    console.log('HP15. store: seq is monotonic and current follows intent ...');
    {
        const { readProvenance, appendEvent } = require('../hook-provenance/store');
        const root = tmp('append');
        const p = path.join(root, 'hook-provenance.json');

        const first = appendEvent(p, readProvenance(p), {
            recordedAt: '2026-08-18T00:00:00.000Z',
            intent: { participation: 'non-participating', source: 'scaffold-no-hooks' },
        });
        assert.strictEqual(first.events[0].seq, 1);
        assert.strictEqual(first.current.participation, 'non-participating');

        const second = appendEvent(p, readProvenance(p), {
            recordedAt: '2026-08-18T00:01:00.000Z',
            intent: { participation: 'participating', source: 'hook-install-command' },
            // hooks-dir-missing is decided BEFORE any write, so it carries no chmod.
            install: { outcome: 'unrealized', reason: 'hooks-dir-missing', targetPath: '/x/post-commit' },
        });
        assert.strictEqual(second.events[1].seq, 2, 'seq increments by exactly one');
        assert.strictEqual(second.current.participation, 'participating',
            'an explicit install supersedes an earlier opt-out even when it did not realize');
        assert.strictEqual(readProvenance(p).state, 'VALID',
            'what the producer commits must be what the reader accepts');
    }

    console.log('HP15b. store: an unobservable document is never overwritten ...');
    {
        const { readProvenance, appendEvent } = require('../hook-provenance/store');
        const crypto = require('crypto');
        const root = tmp('gate');
        const p = path.join(root, 'hook-provenance.json');
        fs.writeFileSync(p, '{ corrupt');
        const before = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

        assert.throws(() => appendEvent(p, readProvenance(p), {
            recordedAt: '2026-08-18T00:02:00.000Z',
            intent: { participation: 'participating', source: 'hook-install-command' },
            install: { outcome: 'unrealized', reason: 'write-failed', targetPath: '/x',
                chmod: { attempted: true, threw: true } },
        }), /unobservable/i, 'appending onto an unobservable document must throw');

        const after = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
        assert.strictEqual(after, before, 'the corrupt document must be byte-identical afterwards');
    }

    console.log('HP15c. store: the commit gate refuses bad data before the rename ...');
    {
        const { appendEvent } = require('../hook-provenance/store');
        const S = require('../hook-provenance/schema');
        const draft = () => ({
            recordedAt: '2026-08-18T00:03:00.000Z',
            intent: { participation: 'non-participating', source: 'scaffold-no-hooks' },
        });
        const tempsIn = d => fs.readdirSync(d).filter(f => f.includes('.tmp-'));

        // --- A. read-back that parses but the shared validator rejects ---------
        // Injected at the READ-BACK only. The write itself must still succeed, or
        // this would prove something about writing rather than about verifying.
        const rootA = tmp('commit-validate');
        const pA = path.join(rootA, 'hook-provenance.json');
        const callsA = { rename: 0 };
        const opsA = Object.create(fs);
        opsA.readFileSync = (f, enc) => (String(f).includes('.tmp-')
            ? JSON.stringify({ kind: 'not-the-kind', schemaVersion: 1 })
            : fs.readFileSync(f, enc));
        opsA.renameSync = (...a) => { callsA.rename += 1; return fs.renameSync(...a); };
        assert.throws(() => appendEvent(pA, { state: 'ABSENT' }, draft(), opsA),
            /read-back failed validation/,
            'a temp the shared validator rejects must never be renamed into place');
        assert.strictEqual(callsA.rename, 0, 'the rename must not have been reached');
        assert.deepStrictEqual(tempsIn(rootA), [], 'and the temp must have been cleaned up');

        // --- B. read-back that is VALID but is not what we wrote ---------------
        // The decoy MUST pass the validator. If it did not, gate A would answer
        // for this fixture and the fingerprint comparison would never be
        // witnessed — the same shape as C-2b and M6a, a fourth time.
        const decoyEv = {
            seq: 1, recordedAt: '2026-01-01T00:00:00.000Z',
            intent: { participation: 'non-participating', source: 'scaffold-no-hooks' },
            resultingCurrentDigest: S.currentDigest('non-participating'),
        };
        decoyEv.id = S.eventId(decoyEv);
        const decoy = {
            kind: S.KIND, schemaVersion: S.SCHEMA_VERSION,
            current: { participation: 'non-participating', derivedFrom: decoyEv.id },
            events: [decoyEv],
        };
        assert.strictEqual(S.validateHookProvenanceV1(decoy).ok, true,
            'fixture validity: the decoy must PASS the validator, or gate A answers first');

        const rootB = tmp('commit-fingerprint');
        const pB = path.join(rootB, 'hook-provenance.json');
        const callsB = { rename: 0 };
        const opsB = Object.create(fs);
        opsB.readFileSync = (f, enc) => (String(f).includes('.tmp-')
            ? JSON.stringify(decoy)
            : fs.readFileSync(f, enc));
        opsB.renameSync = (...a) => { callsB.rename += 1; return fs.renameSync(...a); };
        assert.throws(() => appendEvent(pB, { state: 'ABSENT' }, draft(), opsB),
            /read-back mismatch/,
            'a read-back that is valid but is not what we wrote must never be renamed into place');
        assert.strictEqual(callsB.rename, 0, 'the rename must not have been reached');
        assert.deepStrictEqual(tempsIn(rootB), [], 'and the temp must have been cleaned up');

        // --- C. the cleanup itself fails --------------------------------------
        // Here an orphaned temp is ADMITTED by the contract. What must not happen
        // is one failure swallowing the other.
        const rootC = tmp('commit-cleanup');
        const pC = path.join(rootC, 'hook-provenance.json');
        const opsC = Object.create(fs);
        opsC.writeFileSync = () => { throw new Error('primary: disk full'); };
        opsC.unlinkSync = () => { throw Object.assign(new Error('cleanup: file locked'), { code: 'EBUSY' }); };
        let caught = null;
        try { appendEvent(pC, { state: 'ABSENT' }, draft(), opsC); } catch (e) { caught = e; }
        assert.ok(caught instanceof AggregateError,
            'a cleanup that also fails must not be collapsed into a single error');
        assert.strictEqual(caught.errors.length, 2, 'both failures are carried');
        assert.ok(caught.errors.some(e => /disk full/.test(e.message)),
            'the primary failure survives the cleanup failure');
        assert.ok(caught.errors.some(e => /file locked/.test(e.message)),
            'and the cleanup failure is not silently swallowed');
        assert.ok(/orphaned temp/.test(caught.message),
            'and the message says an orphaned temp may remain');
    }

    console.log('--- hook-provenance tests passed! ---');
}

module.exports = { runHookProvenanceTests };
