'use strict';
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { pathIdentity, canonPath } = require('../hook-provenance/path-identity');

function tmp(name) {
    return fs.mkdtempSync(path.join(os.tmpdir(), `evo-hp-${name}-`));
}

// Fixture interception matches by path IDENTITY, never by representation.
// Task 1 proved a path is not its spelling, and the fixtures below were still
// comparing spellings. Measured on Windows CI: where TMP resolves through an 8.3
// short name, os.tmpdir() and `git rev-parse --show-toplevel` name the same
// directory differently ("...\LONGDI~1\..." vs "...\longdirectoryname\..."), so a
// `String(p) === target` guard never fires and the fault a block means to inject
// is never injected. HP25 went red because its assertion happened to be sensitive
// to its own bypass; HP21 and HP27 stayed green while proving nothing.
// The directory is compared through the shared authority and the basename
// exactly, because the target file may not exist yet at interception time — the
// same split observeLocator makes, for the same reason. `path.resolve` is not a
// substitute: measured, resolve(short) !== resolve(long).
function samePath(a, b) {
    const A = String(a);
    const B = String(b);
    return path.basename(A) === path.basename(B)
        && pathIdentity(path.dirname(A), path.dirname(B)) === 'SAME';
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

    console.log('HP16. producer: NESTED-TARGET claims nothing, SCOPE-UNRESOLVED mutates nothing ...');
    {
        const { installPostCommitHook } = require('../hooks');
        const { execFileSync } = require('child_process');
        const repo = tmp('producer');
        execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
        const child = path.join(repo, 'child');
        fs.mkdirSync(child);

        const nested = installPostCommitHook(child);
        assert.strictEqual(nested.topology, 'NESTED-TARGET');
        assert.strictEqual(nested.provenance, 'not-attempted');
        assert.strictEqual(fs.existsSync(path.join(repo, '.git', 'evo-lite')), false,
            'a nested target must not create an owner directory in the enclosing worktree');

        // Legacy behaviour is PRESERVED, not replaced by the no-op it usually
        // produces. With child/.git/hooks present, the base implementation writes;
        // so must this one, while still claiming no provenance.
        const childHooks = path.join(child, '.git', 'hooks');
        fs.mkdirSync(childHooks, { recursive: true });
        const nested2 = installPostCommitHook(child);
        assert.strictEqual(nested2.provenance, 'not-attempted');
        assert.strictEqual(fs.existsSync(path.join(childHooks, 'post-commit')), true,
            'the nested exception preserves legacy installer behaviour, it does not freeze it');
        assert.strictEqual(fs.existsSync(path.join(repo, '.git', 'evo-lite')), false,
            'and still writes no provenance anywhere');
    }

    console.log('HP16c. producer: a nested opt-out still refuses the hook ...');
    {
        // The producer-level counterpart of HP20's CLI case, written here so the
        // property has a guard inside Task 6 rather than waiting for Task 7.
        // Nesting costs the durable RECORD of an opt-out, never the opt-out.
        const { installPostCommitHook } = require('../hooks');
        const { execFileSync } = require('child_process');
        const repo = tmp('nestedoptout');
        execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
        const child = path.join(repo, 'child');
        fs.mkdirSync(path.join(child, '.git', 'hooks'), { recursive: true });

        const r = installPostCommitHook(child, {
            participation: 'non-participating', source: 'scaffold-no-hooks',
        });
        assert.strictEqual(r.topology, 'NESTED-TARGET');
        assert.strictEqual(r.provenance, 'not-attempted');
        assert.strictEqual(fs.existsSync(path.join(child, '.git', 'hooks', 'post-commit')), false,
            'a nested opt-out still refuses the hook: a topology fact must not overrule an explicit instruction');
        assert.strictEqual(fs.existsSync(path.join(repo, '.git', 'evo-lite')), false,
            'and nothing is written into the enclosing worktree');
    }

    console.log('HP16d. producer: NO-GIT-ADMIN-TOPOLOGY touches nothing and does not throw ...');
    {
        const { installPostCommitHook } = require('../hooks');
        const root = tmp('nogitadmin');
        // A .git/hooks directory that belongs to no repository. Measured: git
        // answers "fatal: not a git repository", which is the POSITIVE answer the
        // classifier requires, so this really is NO-GIT-ADMIN-TOPOLOGY and not a
        // query failure. The hooks directory exists on purpose: it gives a
        // mutation that wrongly runs the legacy installer somewhere to write, so
        // the guard below has real discriminating power.
        fs.mkdirSync(path.join(root, '.git', 'hooks'), { recursive: true });
        const hookPath = path.join(root, '.git', 'hooks', 'post-commit');

        const calls = { write: 0, chmod: 0 };
        const fsOps = Object.create(fs);
        fsOps.writeFileSync = (...a) => { calls.write += 1; return fs.writeFileSync(...a); };
        fsOps.chmodSync = (...a) => { calls.chmod += 1; return fs.chmodSync(...a); };

        const r = installPostCommitHook(root, { fsOps });
        assert.strictEqual(r.topology, 'NO-GIT-ADMIN-TOPOLOGY');
        assert.strictEqual(fs.existsSync(hookPath), false,
            'a workspace with no Git administrative container gets no hook, even where a hooks directory exists');
        assert.strictEqual(calls.write, 0, 'and nothing was written');
        assert.strictEqual(calls.chmod, 0, 'and nothing was chmod-ed');
        assert.strictEqual(r.provenance, 'not-attempted');
        assert.strictEqual(r.artifactContent, 'not-observed');
        assert.strictEqual(r.chmodEvidence, null);
        assert.strictEqual(r.event, null);
    }

    console.log('HP16b. producer: SCOPE-UNRESOLVED mutates nothing ...');
    {
        const { installPostCommitHook } = require('../hooks');
        const crypto = require('crypto');
        const { execFileSync } = require('child_process');
        const repo = tmp('failclosed');
        execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
        const hookPath = path.join(repo, '.git', 'hooks', 'post-commit');
        fs.writeFileSync(hookPath, '#!/bin/sh\n# pre-existing\n');
        const digest = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
        const before = digest(hookPath);

        // Fixture validity: the injection must actually drive the classifier to
        // SCOPE-UNRESOLVED, or this proves nothing about the fail-closed rule.
        const failingRealpath = Object.create(fs);
        failingRealpath.realpathSync = Object.assign(() => { throw new Error('x'); },
            { native: () => { throw Object.assign(new Error('x'), { code: 'EACCES' }); } });
        const { classifyTopology } = require('../hook-provenance/topology');
        const sub = path.join(repo, 'sub');
        fs.mkdirSync(sub);
        assert.strictEqual(classifyTopology(sub, { fsOps: failingRealpath }).state, 'SCOPE-UNRESOLVED',
            'fixture validity: the injection must produce SCOPE-UNRESOLVED');

        assert.throws(() => installPostCommitHook(sub, { fsOps: failingRealpath,
            deps: { fsOps: failingRealpath } }), /SCOPE-UNRESOLVED/,
            'a run that cannot classify its own scope must fail rather than proceed');
        assert.strictEqual(digest(hookPath), before,
            'SCOPE-UNRESOLVED grants no legacy exception: the hook is byte-identical');
        assert.strictEqual(fs.existsSync(path.join(repo, '.git', 'evo-lite')), false,
            'and no owner directory was created');
    }

    console.log('HP17. producer: a realized install records outcome and runnability ...');
    {
        const { installPostCommitHook } = require('../hooks');
        const { readProvenance } = require('../hook-provenance/store');
        const { execFileSync } = require('child_process');
        const repo = tmp('realize');
        execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });

        const r = installPostCommitHook(repo);
        assert.strictEqual(r.topology, 'IN-SCOPE');
        assert.strictEqual(r.provenance, 'committed');
        assert.strictEqual(r.artifactContent, 'modified');

        const doc = readProvenance(path.join(repo, '.git', 'evo-lite', 'hook-provenance.json'));
        assert.strictEqual(doc.state, 'VALID');
        const ev = doc.doc.events[doc.doc.events.length - 1];
        assert.strictEqual(ev.install.outcome, 'realized');
        assert.strictEqual(ev.install.reason, 'created-managed-hook');
        assert.ok(ev.runnability, 'a realized event carries runnability');
        assert.strictEqual(ev.runnability.locator.verdict, 'satisfied');
        assert.strictEqual(doc.doc.current.participation, 'participating');
    }

    console.log('HP18. producer: --no-hooks records the opt-out and leaves the hook alone ...');
    {
        const { installPostCommitHook } = require('../hooks');
        const { readProvenance } = require('../hook-provenance/store');
        const { execFileSync } = require('child_process');
        const repo = tmp('optout');
        execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });

        const r = installPostCommitHook(repo, { participation: 'non-participating', source: 'scaffold-no-hooks' });
        // `not-observed`, not `unchanged`: no before/after pair was taken, and
        // "our code did not write" is not the same fact as "the content did not
        // change" — an external mutation between the two is possible. The proof
        // that no hook was written is the file itself, on the next line.
        assert.strictEqual(r.artifactContent, 'not-observed');
        assert.strictEqual(r.chmodEvidence, null);
        assert.strictEqual(fs.existsSync(path.join(repo, '.git', 'hooks', 'post-commit')), false,
            'an opt-out must not write a hook');

        const doc = readProvenance(path.join(repo, '.git', 'evo-lite', 'hook-provenance.json'));
        assert.strictEqual(doc.doc.current.participation, 'non-participating');
        assert.strictEqual(doc.doc.events[0].install, undefined);

        // Supersession: a later explicit install flips current back.
        installPostCommitHook(repo, { source: 'hook-install-command' });
        const after = readProvenance(path.join(repo, '.git', 'evo-lite', 'hook-provenance.json'));
        assert.strictEqual(after.doc.current.participation, 'participating');
        assert.strictEqual(after.doc.events.length, 2);
    }

    console.log('HP19. producer: a no-op invocation still records an event ...');
    {
        const { installPostCommitHook } = require('../hooks');
        const { readProvenance } = require('../hook-provenance/store');
        const { execFileSync } = require('child_process');
        const repo = tmp('noop');
        execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
        installPostCommitHook(repo);
        installPostCommitHook(repo);
        const doc = readProvenance(path.join(repo, '.git', 'evo-lite', 'hook-provenance.json'));
        assert.strictEqual(doc.doc.events.length, 2, 'the second, changeless run is still an event');
        assert.strictEqual(doc.doc.events[1].install.reason, 'updated-managed-block');
    }

    console.log('HP20. CLI: --no-git does not suppress hook participation, and --no-hooks is '
        + 'the sole authority for explicit non-participation ...');
    {
        const { execFileSync } = require('child_process');
        const { readProvenance } = require('../hook-provenance/store');
        const { classifyTopology } = require('../hook-provenance/topology');
        const { runInitializer } = require('./harness');

        // Fixture-validity gate helper (amendment I2): a host on which the fixture
        // does not classify as claimed must fail here, loudly, as an invalid
        // fixture — never silently pass a scenario that no longer tests what it
        // claims to test.
        const fixture = (label, dir, expected) => assert.strictEqual(
            classifyTopology(dir).state, expected,
            `FIXTURE INVALID, not a product failure: ${label} is not ${expected} on this host`);

        // The exec stub (amendment I3): Git runs for real, because the topology
        // under test must be real. `npm ci` is the only other command the scaffold
        // issues on this path, and it is stubbed to a successful no-op. Anything
        // else throws loudly — "everything that isn't git succeeds" would let a
        // future third shell command pass HP20 silently for the wrong reason.
        const realExecSync = require('child_process').execSync;
        const gitOnly = (cmd, opts) => {
            const s = String(cmd);
            if (/^git\b/.test(s)) return realExecSync(cmd, opts);
            if (s === 'npm ci') return '';
            throw new Error(`HP20 exec stub: unexpected command, neither git nor npm ci: ${s}`);
        };

        // A. An EXISTING repository scaffolded with --no-git: git init is skipped,
        //    hook participation is not.
        const repo = tmp('nogit');
        execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
        fixture('the --no-git target', repo, 'IN-SCOPE');
        const rA = await runInitializer(repo, {
            args: ['--no-git', '--no-initial-commit'], execSyncImpl: gitOnly,
        });
        assert.strictEqual(rA.status, 0, 'the scaffold must complete: this block tests intent, not failure');
        const withGitFlag = readProvenance(path.join(repo, '.git', 'evo-lite', 'hook-provenance.json'));
        assert.strictEqual(withGitFlag.state, 'VALID');
        assert.strictEqual(withGitFlag.doc.current.participation, 'participating',
            '--no-git governs repository initialisation only, never hook participation');

        // B. --no-hooks on an existing repository records the explicit opt-out.
        const optOut = tmp('nohooks');
        execFileSync('git', ['-C', optOut, 'init', '-q'], { stdio: 'ignore' });
        fixture('the --no-hooks target', optOut, 'IN-SCOPE');
        const rB = await runInitializer(optOut, {
            args: ['--no-hooks', '--no-initial-commit'], execSyncImpl: gitOnly,
        });
        assert.strictEqual(rB.status, 0, 'the scaffold must complete: this block tests intent, not failure');
        const opted = readProvenance(path.join(optOut, '.git', 'evo-lite', 'hook-provenance.json'));
        assert.strictEqual(opted.doc.current.participation, 'non-participating');
        assert.strictEqual(opted.doc.events[0].intent.source, 'scaffold-no-hooks');

        // C. The combination that makes two otherwise-correct rules collide. Recording
        //    the opt-out requires an in-scope owner; --no-git forbids creating one. The
        //    opt-out is honoured for the run and leaves no record — and above all, no
        //    repository is manufactured in order to store it, which would run DD#1
        //    backwards and let a hook flag create a Git repo.
        const bare = tmp('nogit-nohooks');
        assert.strictEqual(fs.existsSync(path.join(bare, '.git')), false,
            'FIXTURE INVALID: the target must have no .git before the run');
        fixture('the no-repository target', bare, 'NO-GIT-ADMIN-TOPOLOGY');
        const rC = await runInitializer(bare, {
            args: ['--no-git', '--no-hooks', '--no-initial-commit'], execSyncImpl: gitOnly,
        });
        assert.strictEqual(rC.status, 0, 'the scaffold must complete: this block tests intent, not failure');
        assert.strictEqual(fs.existsSync(path.join(bare, '.git')), false,
            'no .git may be created in order to record an opt-out');
        assert.strictEqual(fs.existsSync(path.join(bare, '.evo-lite', 'hook-provenance.json')), false,
            'and no provenance document appears anywhere in the working tree');

        // D. NESTED-TARGET + --no-hooks writes nothing into the enclosing worktree.
        const outer = tmp('nested-nohooks');
        execFileSync('git', ['-C', outer, 'init', '-q'], { stdio: 'ignore' });
        const inner = path.join(outer, 'inner');
        fs.mkdirSync(inner);
        fixture('the nested target', inner, 'NESTED-TARGET');
        const rD = await runInitializer(inner, {
            args: ['--no-git', '--no-hooks', '--no-initial-commit'], execSyncImpl: gitOnly,
        });
        assert.strictEqual(rD.status, 0, 'the scaffold must complete: this block tests intent, not failure');
        assert.strictEqual(fs.existsSync(path.join(outer, '.git', 'evo-lite')), false,
            'a nested opt-out must not write into the enclosing worktree');

        // E. Nesting costs the durable RECORD of the opt-out, never the opt-out
        //    itself. With the hooks directory present, the legacy installer would
        //    otherwise write — so this is where a topology fact could overrule an
        //    explicit instruction, and must not. The carrier gate is load-bearing:
        //    that directory exists precisely so a wrongly-invoked legacy installer
        //    WOULD write. Without it the scenario cannot discriminate.
        const inner2 = path.join(outer, 'inner2');
        fs.mkdirSync(path.join(inner2, '.git', 'hooks'), { recursive: true });
        assert.strictEqual(fs.existsSync(path.join(inner2, '.git', 'hooks')), true,
            'FIXTURE INVALID: the local hooks directory must exist, or a wrong legacy invocation has nowhere to write');
        fixture('the nested carrier target', inner2, 'NESTED-TARGET');
        const rE = await runInitializer(inner2, {
            args: ['--no-git', '--no-hooks', '--no-initial-commit'], execSyncImpl: gitOnly,
        });
        assert.strictEqual(rE.status, 0, 'the scaffold must complete: this block tests intent, not failure');
        assert.strictEqual(fs.existsSync(path.join(inner2, '.git', 'hooks', 'post-commit')), false,
            'a nested --no-hooks still refuses the hook; only the record is lost');
    }

    console.log('HP21. producer: a write that throws after the bytes land is still realized ...');
    {
        const { installPostCommitHook } = require('../hooks');
        const { execFileSync } = require('child_process');
        const repo = tmp('throwafter');
        execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });

        // Land the bytes, then throw — the exception carries no authority over
        // what is now on disk, so the observation must still decide.
        //
        // The injection is scoped to the ARTIFACT path only. Throwing on every
        // write would also break the provenance temp write, the whole call would
        // throw, and the assertions below would never run — a control that tests
        // nothing while appearing to pass.
        const hookPath = path.join(repo, '.git', 'hooks', 'post-commit');
        const fsOps = Object.create(fs);
        let injected = 0;
        fsOps.writeFileSync = (p, data, enc) => {
            fs.writeFileSync(p, data, enc);
            if (samePath(p, hookPath)) {
                injected += 1;
                throw Object.assign(new Error('EIO after write'), { code: 'EIO' });
            }
        };
        const r = installPostCommitHook(repo, { fsOps });
        // The interception is itself evidence. Without this gate a stub that
        // never matched leaves the ordinary success path running, and the two
        // assertions below — 'realized' and 'created-managed-hook' — are exactly
        // what that path produces. The block would pass having injected nothing.
        assert.ok(injected > 0,
            'FIXTURE INVALID: the post-write throw was never injected, so nothing below is evidence');
        assert.strictEqual(r.event.install.outcome, 'realized',
            'a thrown write whose bytes landed must not be recorded as unrealized');
        assert.strictEqual(r.event.install.reason, 'created-managed-hook',
            'the reason describes what was found before the write, not what the exception suggests');

        // The pre-write phase is NOT duplicated here. HP25 owns it. A second
        // pre-write controller in this block would absorb every mutation aimed at
        // the pre-write branch — HP21 runs first, so the red would land here
        // instead of on the property HP25 exists to guard.
    }

    console.log('HP25. producer: a failed pre-write observation does not swallow the intent (ac16) ...');
    {
        // The controller the frozen design names: it proves both halves at once —
        // a failed observation is not dressed as a write, AND a failed install
        // does not discard the intent that superseded an earlier opt-out.
        const { installPostCommitHook } = require('../hooks');
        const { readProvenance } = require('../hook-provenance/store');
        const crypto = require('crypto');
        const { execFileSync } = require('child_process');
        const repo = tmp('supersede');
        execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
        const hookPath = path.join(repo, '.git', 'hooks', 'post-commit');
        const provenancePath = path.join(repo, '.git', 'evo-lite', 'hook-provenance.json');

        // Start from a recorded opt-out, with a hook already on disk.
        installPostCommitHook(repo, { participation: 'non-participating', source: 'scaffold-no-hooks' });
        fs.writeFileSync(hookPath, '#!/bin/sh\n# third-party\n');
        assert.strictEqual(readProvenance(provenancePath).doc.current.participation, 'non-participating',
            'fixture validity: current starts non-participating');
        const digest = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
        const before = digest(hookPath);
        const eventsBefore = readProvenance(provenancePath).doc.events.length;

        let chmodCalls = 0;
        const preFail = Object.create(fs);
        let preFailInjected = 0;
        preFail.readFileSync = (p, enc) => {
            if (samePath(p, hookPath)) {
                preFailInjected += 1;
                throw Object.assign(new Error('denied'), { code: 'EACCES' });
            }
            return fs.readFileSync(p, enc);
        };
        preFail.chmodSync = (...a) => { chmodCalls += 1; return fs.chmodSync(...a); };

        installPostCommitHook(repo, { source: 'hook-install-command', fsOps: preFail });

        assert.ok(preFailInjected > 0,
            'FIXTURE INVALID: the pre-write read failure was never injected, so nothing below is evidence');
        const doc = readProvenance(provenancePath);
        assert.strictEqual(doc.state, 'VALID');
        const ev = doc.doc.events[doc.doc.events.length - 1];
        assert.strictEqual(doc.doc.events.length, eventsBefore + 1, 'exactly one event is committed');
        assert.strictEqual(digest(hookPath), before, 'the hook is byte-identical');
        assert.strictEqual(chmodCalls, 0, 'chmod is never called');
        assert.strictEqual(ev.intent.source, 'hook-install-command');
        assert.strictEqual(ev.intent.participation, 'participating');
        assert.strictEqual(ev.install.outcome, 'indeterminate');
        assert.strictEqual(ev.install.reason, 'pre-write-observation-failed');
        assert.strictEqual(ev.install.chmod, undefined);
        assert.strictEqual(ev.install.expectedBodyDigest, undefined);
        assert.strictEqual(ev.runnability, undefined);
        assert.strictEqual(doc.doc.current.participation, 'participating',
            'a failed install must not swallow the intent that superseded the opt-out');
    }

    console.log('HP22. producer: provenance is committed after the artifact, never before ...');
    {
        const { installPostCommitHook } = require('../hooks');
        const { execFileSync } = require('child_process');
        const repo = tmp('order');
        execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });

        const order = [];
        const fsOps = Object.create(fs);
        fsOps.writeFileSync = (p, data, enc) => {
            order.push(String(p).includes('hook-provenance') ? 'provenance' : 'artifact');
            return fs.writeFileSync(p, data, enc);
        };
        installPostCommitHook(repo, { fsOps });
        assert.strictEqual(order[0], 'artifact',
            'the artifact is written and observed before provenance is committed');
        assert.ok(order.lastIndexOf('provenance') > order.lastIndexOf('artifact'),
            'the provenance commit is the last write of the invocation');
    }

    console.log('HP24. producer: artifact CONTENT is observed, and mode is a separate axis ...');
    {
        const { installPostCommitHook } = require('../hooks');
        const { execFileSync } = require('child_process');
        const repo = tmp('artifactdim');
        execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });

        assert.strictEqual(installPostCommitHook(repo).artifactContent, 'modified',
            'the first install changes the file');
        const second = installPostCommitHook(repo);
        assert.strictEqual(second.artifactContent, 'unchanged',
            'artifactContent reports unchanged when no byte changed — "a write was issued" is not "the content changed"');
        // Mode is its own axis. That rewrite was byte-identical, so artifactContent
        // is `unchanged` while chmod still ran; folding the two together would let
        // one of them speak for the other, and chmod can change the artifact
        // without changing a byte.
        assert.deepStrictEqual(second.chmodEvidence, { issued: true, threw: false },
            'chmod is reported as operation evidence on its own axis, not as an artifact fact');
    }

    console.log('HP26. producer: the phase-2/3 outcomes the amendment named ...');
    {
        const { installPostCommitHook } = require('../hooks');
        const { execFileSync } = require('child_process');

        // A. The write RETURNS SUCCESS, and the authoritative observation then
        //    finds the expected body is not established — a concurrent overwrite
        //    between the write and the observation. write-failed is scoped to the
        //    write phase, not to an exception, so this is unrealized/write-failed.
        //    Without this control an implementation may write `if (!threw) realized`
        //    and still pass everything else.
        const repoA = tmp('phase23a');
        execFileSync('git', ['-C', repoA, 'init', '-q'], { stdio: 'ignore' });
        const hookA = path.join(repoA, '.git', 'hooks', 'post-commit');
        const clobber = Object.create(fs);
        let clobbered = 0;
        clobber.writeFileSync = (p, data, enc) => {
            fs.writeFileSync(p, data, enc);
            if (samePath(p, hookA)) {
                clobbered += 1;
                fs.writeFileSync(p, '#!/bin/sh\n# clobbered by someone else\n');
            }
        };
        const a = installPostCommitHook(repoA, { fsOps: clobber });
        assert.ok(clobbered > 0,
            'FIXTURE INVALID: the third-party clobber was never injected, so nothing below is evidence');
        assert.strictEqual(a.event.install.outcome, 'unrealized');
        assert.strictEqual(a.event.install.reason, 'write-failed',
            'a write that returned success but did not establish the expected body is write-failed');
        assert.deepStrictEqual(a.event.install.chmod, { attempted: true, threw: false },
            'phase-2/3: the write was issued, so chmod is present');
        assert.strictEqual(a.event.runnability, undefined,
            'an unrealized event carries no runnability');

        // B. The write is issued, and the artifact then becomes UNREADABLE. This
        //    is the row that decides whether the errno rule survives all the way
        //    to realization: an observer built on existsSync would call this
        //    `no-hook` and record unrealized/write-failed — a failure to observe
        //    impersonating a fact. The injection targets the real observer, not a
        //    stubbed-out one, so it also proves the producer does not route
        //    realization through diffInstalledHook.
        const repoB = tmp('phase23b');
        execFileSync('git', ['-C', repoB, 'init', '-q'], { stdio: 'ignore' });
        const hookB = path.join(repoB, '.git', 'hooks', 'post-commit');
        let written = false;
        const blind = Object.create(fs);
        let blindInjected = 0;
        blind.writeFileSync = (p, data, enc) => {
            const out = fs.writeFileSync(p, data, enc);
            if (samePath(p, hookB)) written = true;
            return out;
        };
        blind.readFileSync = (p, enc) => {
            if (written && samePath(p, hookB)) {
                blindInjected += 1;
                throw Object.assign(new Error('denied'), { code: 'EACCES' });
            }
            return fs.readFileSync(p, enc);
        };
        const b = installPostCommitHook(repoB, { fsOps: blind });
        assert.ok(written, 'FIXTURE INVALID: the write was never observed, so the read failure could not arm');
        assert.ok(blindInjected > 0,
            'FIXTURE INVALID: the post-write read failure was never injected, so nothing below is evidence');
        assert.strictEqual(b.event.install.outcome, 'indeterminate',
            'an unreadable artifact after an issued write is a failure to observe, not unrealized');
        assert.strictEqual(b.event.install.reason, 'post-write-observation-failed');
        assert.deepStrictEqual(b.event.install.chmod, { attempted: true, threw: false },
            'phase-2/3 again: a failed observation after an issued write still carries chmod');
        assert.strictEqual(b.event.install.expectedBodyDigest, undefined);
        assert.strictEqual(b.event.runnability, undefined);
    }

    console.log('HP27. producer: a committed artifact with an uncommitted record reports both (ac9) ...');
    {
        const { installPostCommitHook } = require('../hooks');
        const { readProvenance } = require('../hook-provenance/store');
        const { execFileSync } = require('child_process');
        const repo = tmp('twodim');
        execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
        const provenancePath = path.join(repo, '.git', 'evo-lite', 'hook-provenance.json');

        // The artifact write succeeds; only the provenance write fails. Partial
        // success must never be compressed into one outcome.
        const failProvenance = Object.create(fs);
        failProvenance.writeFileSync = (p, data, enc) => {
            if (String(p).includes('hook-provenance')) {
                throw Object.assign(new Error('no space'), { code: 'ENOSPC' });
            }
            return fs.writeFileSync(p, data, enc);
        };

        let caught = null;
        try { installPostCommitHook(repo, { fsOps: failProvenance }); }
        catch (err) { caught = err; }

        assert.ok(caught, 'the invocation must fail, not report success with a warning');
        assert.strictEqual(caught.provenance, 'failed');
        assert.strictEqual(caught.artifactContent, 'modified',
            'the artifact dimension is reported as the fact it is, beside the provenance failure');
        assert.deepStrictEqual(caught.chmodEvidence, { issued: true, threw: false });
        assert.strictEqual(fs.existsSync(path.join(repo, '.git', 'hooks', 'post-commit')), true,
            'the hook really did change — which is exactly why it must be reported');
        assert.strictEqual(readProvenance(provenancePath).state, 'ABSENT',
            'and no half-written document was left behind');
    }

    console.log('HP23. producer: the rename is the commit point ...');
    {
        // HP22 proves ordering (mutate, then record). It does NOT prove the
        // separate commit-point contract: that after the rename returns, no
        // fallible step belonging to this invocation may run. That needs its own
        // observation, because a step added after the rename would keep the same
        // write order while still being able to fail a committed transaction.
        const { installPostCommitHook } = require('../hooks');
        const { readProvenance } = require('../hook-provenance/store');
        const { execFileSync } = require('child_process');
        const repo = tmp('commitpoint');
        execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });

        const provenancePath = path.join(repo, '.git', 'evo-lite', 'hook-provenance.json');
        const after = [];
        const fsOps = Object.create(fs);
        let committed = false;
        fsOps.renameSync = (a, b) => {
            const out = fs.renameSync(a, b);
            if (samePath(b, provenancePath)) committed = true;
            return out;
        };
        // Record every fallible fs operation issued AFTER the commit rename.
        for (const op of ['writeFileSync', 'readFileSync', 'renameSync', 'unlinkSync',
            'mkdirSync', 'chmodSync', 'statSync']) {
            const original = fs[op].bind(fs);
            if (op === 'renameSync') continue;
            fsOps[op] = (...args) => {
                if (committed) after.push(`${op}:${String(args[0])}`);
                return original(...args);
            };
        }

        const r = installPostCommitHook(repo, { fsOps });
        assert.strictEqual(r.provenance, 'committed', 'fixture validity: the transaction must have committed');
        // The line above validates the PRODUCT's report; this one validates the
        // INSTRUMENT. Without it, a rename the recorder never matched leaves
        // `after` empty by default rather than by evidence, and the deepStrictEqual
        // below passes while observing nothing at all.
        assert.ok(committed,
            'FIXTURE INVALID: the commit rename was never observed, so the post-commit recorder never armed');
        assert.strictEqual(readProvenance(provenancePath).state, 'VALID');
        assert.deepStrictEqual(after, [],
            `no fallible operation may follow the commit rename (saw ${after.join(', ')})`);
    }

    console.log('HP28. producer: an unobservable document stops the run BEFORE the artifact ...');
    {
        // Task 5 proves appendEvent refuses to overwrite an unobservable
        // document. It cannot prove the producer asks BEFORE it writes. A
        // producer that wrote first and asked second would satisfy every Task 5
        // assertion while having already changed the hook. That ordering is the
        // read-before-mutate gate, and it is Task 6's to prove.
        const { installPostCommitHook } = require('../hooks');
        const crypto = require('crypto');
        const { execFileSync } = require('child_process');
        const repo = tmp('readbeforemutate');
        execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
        const hookPath = path.join(repo, '.git', 'hooks', 'post-commit');
        const provenancePath = path.join(repo, '.git', 'evo-lite', 'hook-provenance.json');
        fs.writeFileSync(hookPath, '#!/bin/sh\n# pre-existing, must survive\n');
        fs.mkdirSync(path.dirname(provenancePath), { recursive: true });
        fs.writeFileSync(provenancePath, '{ corrupt');

        const digest = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
        const hookBefore = digest(hookPath);
        const docBefore = digest(provenancePath);

        // Fixture validity: the document really must read UNOBSERVABLE, or this
        // proves nothing about the gate.
        const { readProvenance } = require('../hook-provenance/store');
        assert.strictEqual(readProvenance(provenancePath).state, 'UNOBSERVABLE',
            'fixture validity: the existing document must be unobservable');

        const calls = { write: 0, chmod: 0 };
        const fsOps = Object.create(fs);
        fsOps.writeFileSync = (...a) => { calls.write += 1; return fs.writeFileSync(...a); };
        fsOps.chmodSync = (...a) => { calls.chmod += 1; return fs.chmodSync(...a); };

        assert.throws(() => installPostCommitHook(repo, { fsOps }), /unobservable/i,
            'an unobservable document must stop the run');
        assert.strictEqual(digest(hookPath), hookBefore,
            'the hook is byte-identical: the gate ran BEFORE the artifact was touched');
        assert.strictEqual(calls.write, 0, 'no write was issued at all');
        assert.strictEqual(calls.chmod, 0, 'and no chmod was issued');
        assert.strictEqual(digest(provenancePath), docBefore,
            'and the unreadable document was not overwritten');
    }

    console.log('HP29. producer: a phase-1 outcome is recorded and the run stops before any write ...');
    {
        // Task 4 proves observeHooksDir classifies. It cannot prove the producer
        // STOPS on a non-null outcome. An implementation that records the
        // phase-1 fact and then falls through to the write path can still commit
        // a document that passes the shared validator, so nothing downstream
        // catches it. The sequencing is Task 6's own.
        const { installPostCommitHook } = require('../hooks');
        const { readProvenance } = require('../hook-provenance/store');
        const { execFileSync } = require('child_process');
        const repo = tmp('phase1stop');
        execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
        const hooksDir = path.join(repo, '.git', 'hooks');
        fs.rmSync(hooksDir, { recursive: true, force: true });

        // Fixture validity: the hooks directory must really be gone, or the
        // phase-1 branch is never entered.
        const { observeHooksDir } = require('../hook-provenance/observe');
        assert.deepStrictEqual(observeHooksDir(hooksDir),
            { outcome: 'unrealized', reason: 'hooks-dir-missing' },
            'fixture validity: the hooks directory must be positively missing');

        const calls = { write: 0, chmod: 0 };
        const fsOps = Object.create(fs);
        fsOps.writeFileSync = (p, ...a) => {
            if (!String(p).includes('hook-provenance')) calls.write += 1;
            return fs.writeFileSync(p, ...a);
        };
        fsOps.chmodSync = (...a) => { calls.chmod += 1; return fs.chmodSync(...a); };

        installPostCommitHook(repo, { fsOps });

        // The sequencing assertions come FIRST: they are what this block owns.
        assert.strictEqual(calls.write, 0,
            'a phase-1 outcome never writes the artifact: the fact was established before any write');
        assert.strictEqual(calls.chmod, 0, 'and never chmods it');

        const doc = readProvenance(path.join(repo, '.git', 'evo-lite', 'hook-provenance.json'));
        assert.strictEqual(doc.state, 'VALID');
        assert.strictEqual(doc.doc.events.length, 1, 'exactly one event is committed');
        const ev = doc.doc.events[0];
        assert.strictEqual(ev.install.outcome, 'unrealized');
        assert.strictEqual(ev.install.reason, 'hooks-dir-missing');
        assert.strictEqual(ev.install.chmod, undefined, 'phase 1 carries no chmod');
    }

    console.log('HP30. CLI: the explicit hook install translates core state into exit semantics ...');
    {
        // Task 6 Step 4 owns this action. Nothing else in the suite drives it,
        // and M20 witnesses only the CORE's thrown payload.
        const { registerHookCommands } = require('../hooks');
        const { readProvenance } = require('../hook-provenance/store');
        const { execFileSync } = require('child_process');

        // The established harness in this repo: a minimal fake commander program
        // that captures each action by its command name.
        const handlers = {};
        const fakeCmd = name => {
            const self = {
                alias: () => self, description: () => self, option: () => self,
                command: sub => fakeCmd(sub),
                action: fn => { handlers[name] = fn; return self; },
            };
            return self;
        };
        registerHookCommands({ command: name => fakeCmd(name) });
        assert.strictEqual(typeof handlers.install, 'function',
            'fixture validity: the install action was captured');

        const prevRoot = process.env.EVO_LITE_ROOT;
        const prevExit = process.exitCode;
        const origLog = console.log; const origErr = console.error;
        const run = ws => {
            const logs = []; const errs = [];
            let threw = null;
            process.env.EVO_LITE_ROOT = path.join(ws, '.evo-lite');
            console.log = (...a) => logs.push(a.join(' '));
            console.error = (...a) => errs.push(a.join(' '));
            process.exitCode = 0;
            // A throw is captured rather than allowed to escape. Step 4's contract
            // for every failure branch is "report and exit non-zero", so throwing
            // is a contract violation — and it must surface as an assertion, not
            // as a harness crash that proves nothing.
            try { handlers.install({}); } catch (e) { threw = e; } finally {
                console.log = origLog; console.error = origErr;
            }
            return { code: process.exitCode, logs, errs, threw, out: logs.concat(errs).join('\n') };
        };

        try {
            // A. A workspace holding .git/hooks that belongs to no repository.
            //    Measured: git answers "fatal: not a git repository", so this is
            //    NO-GIT-ADMIN-TOPOLOGY. The hooks directory exists deliberately —
            //    the OLD action tested only existsSync(hooksDir) and would have
            //    installed here, so this fixture discriminates the new rule from
            //    the one it replaces.
            const fake = tmp('cli-nogit');
            fs.mkdirSync(path.join(fake, '.git', 'hooks'), { recursive: true });
            const a = run(fake);
            assert.notStrictEqual(a.code, 0,
                'an explicit hook install with no Git administrative container exits non-zero');
            assert.strictEqual(fs.existsSync(path.join(fake, '.git', 'hooks', 'post-commit')), false,
                'and installs no hook');

            // B. The success path must not be collateral damage, and the action
            //    must declare the source the contract requires. Nothing else in
            //    the suite proves Step 4 passes hook-install-command.
            const repo = tmp('cli-ok');
            execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
            const b = run(repo);
            assert.strictEqual(b.code, 0, 'a successful explicit install introduces no failure exit');
            assert.strictEqual(fs.existsSync(path.join(repo, '.git', 'hooks', 'post-commit')), true,
                'and the hook is installed');
            const doc = readProvenance(path.join(repo, '.git', 'evo-lite', 'hook-provenance.json'));
            assert.strictEqual(doc.state, 'VALID');
            assert.strictEqual(doc.doc.events[doc.doc.events.length - 1].intent.source,
                'hook-install-command',
                'the explicit command declares itself as the source, never the scaffold default');

            // C. A BARE repository. Measured: git answers "must be run in a work
            //    tree", which is NOT the positive not-a-repository answer, so the
            //    classifier lands on SCOPE-UNRESOLVED. No injection is needed —
            //    the topology is a property of the fixture itself.
            const bare = tmp('cli-bare');
            execFileSync('git', ['init', '-q', '--bare', bare], { stdio: 'ignore' });
            const { classifyTopology } = require('../hook-provenance/topology');
            assert.strictEqual(classifyTopology(bare).state, 'SCOPE-UNRESOLVED',
                'FIXTURE INVALID, not a product failure: this host\'s Git does not put a bare '
              + 'repository into SCOPE-UNRESOLVED, so the case below cannot mean what it claims');
            const c = run(bare);
            assert.strictEqual(c.threw, null,
                'an unresolved topology is reported by the command, not thrown out of it');
            assert.notStrictEqual(c.code, 0,
                'an explicit hook install that cannot resolve its own scope exits non-zero');
            assert.ok(/SCOPE-UNRESOLVED/.test(c.out), 'and says which condition stopped it');
            assert.strictEqual(fs.existsSync(path.join(bare, 'hooks', 'post-commit')), false,
                'and fails closed: no hook is written');

            // D. The artifact write succeeds and only the PROVENANCE rename fails.
            //    fs.renameSync is instrumented rather than injected, and the patch
            //    is scoped to exactly the temp -> hook-provenance.json rename:
            //    measured, it intercepts that one call and lets every other rename
            //    through. The product API is untouched — a seam added solely to
            //    observe would be the production change this contract refuses.
            const twodim = tmp('cli-twodim');
            execFileSync('git', ['-C', twodim, 'init', '-q'], { stdio: 'ignore' });
            const twodimHook = path.join(twodim, '.git', 'hooks', 'post-commit');
            const originalRename = fs.renameSync;
            let d;
            try {
                fs.renameSync = (src, dst) => {
                    if (String(src).includes('hook-provenance.json.tmp-')
                        && String(dst).endsWith('hook-provenance.json')) {
                        throw Object.assign(new Error('injected provenance rename failure'), { code: 'EIO' });
                    }
                    return originalRename(src, dst);
                };
                d = run(twodim);
            } finally {
                fs.renameSync = originalRename;
            }
            assert.strictEqual(fs.renameSync, originalRename, 'the instrumentation is restored');

            // Fixture validity, and the whole point of the case: the artifact
            // really did change, so "both dimensions" is a claim about two real
            // facts and not about one.
            assert.strictEqual(fs.existsSync(twodimHook), true,
                'fixture validity: the hook really was written before the provenance rename failed');
            assert.strictEqual(
                readProvenance(path.join(twodim, '.git', 'evo-lite', 'hook-provenance.json')).state,
                'ABSENT', 'fixture validity: and no provenance document was committed');

            assert.strictEqual(d.threw, null,
                'a provenance failure after a mutated artifact is reported, not thrown out of the command');
            assert.notStrictEqual(d.code, 0, 'and exits non-zero');
            assert.ok(/artifact/i.test(d.out) && /provenance/i.test(d.out),
                'the command surfaces BOTH dimensions: what the artifact is, and that the record did not commit');
        } finally {
            if (prevRoot === undefined) delete process.env.EVO_LITE_ROOT;
            else process.env.EVO_LITE_ROOT = prevRoot;
            process.exitCode = prevExit;
        }
    }

    console.log('--- hook-provenance tests passed! ---');
}

module.exports = { runHookProvenanceTests };
