# Hook Install Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record, as durable local fact, whether this workspace declared a hook-installation obligation, what one installation attempt actually did, and whether the resulting artifact is statically reachable by Git — without repairing anything.

**Architecture:** A pure core plus one transactional shell. Five new modules under `templates/cli/hook-provenance/` hold the contract: a path-identity primitive, the document schema and its shared validator, the topology classifier, the observation layer, and the store. `templates/cli/hooks.js` and `index.js` only wire them together. Every verdict-producing rule lives in a pure function so it can be tested without a repository, and every rule that touches Git asks Git rather than re-deriving.

**Tech Stack:** Node.js (CommonJS, no dependencies beyond core `fs` / `path` / `crypto` / `child_process`), `node:assert`, the existing `templates/cli/test/harness.js` fixtures, `node .evo-lite/cli/test.js` as the suite.

**Design authority:** `docs/superpowers/specs/2026-08-18-hook-install-provenance-design.md` at frozen design SHA `a8c8986a10643bf2516a2b99edc3e001da99e99b` (branch `spec/hook-install-provenance`). That document is the contract. If implementation appears to require different behaviour, that is a design change and must be escalated — never resolved as implementation discretion.

The earlier freeze `0c22702413ac5ac39e871f2abb7c911ec86074b6` is **superseded before implementation**: planning found it had no truthful way to record an observation that fails after the topology gates and before any write is issued. Do not read it; `a8c8986` is the only authority.

**Implementation base:** `356e357193cbadc549e96a8eb6fbe6333e6d7cb7`.

## Global Constraints

- **Double mirror.** `templates/cli/**` is the source; `.evo-lite/cli/**` is a byte-identical live mirror. Every file created or modified under `templates/cli/` must be copied to the same relative path under `.evo-lite/cli/`, byte for byte, in the same commit. The suite runs from the mirror, so an unmirrored change tests nothing.
- **Test command.** `node .evo-lite/cli/test.js`. The only valid scope arguments are `governance` and the default `all`. Do not invent a scope. Run it in the **foreground**, redirect to a file, and grep the file — never start it as a background task and poll it.
- **Baseline.** The suite is green at the implementation base. Record the passing count before Task 1 and confirm it never decreases.
- **No production behaviour outside this contract.** `mem verify`, the dashboard, `dashboard-data.js` `hasManagedPostCommitHook()`, and every hook-health policy stay untouched. This plan builds the fact layer only.
- **Class 3 is forbidden.** No code path may execute the managed post-commit body, or any substitute for it, as a probe. Authority queries (`git …`) and static artifact analysis (read, parse, syntax-check) are permitted.
- **Every Git query is bound to the target**, as `git -C <target> …` or an equivalent `cwd: <target>`. Never the process working directory.
- **Frozen vocabularies.** `install.reason`, each runnability component `reason`, and `intent.source` are fixed by the spec. Do not add a member. There is no `already-current`.
- **Frozen state names.** Four topology states — `NO-GIT-ADMIN-TOPOLOGY`, `SCOPE-UNRESOLVED`, `NESTED-TARGET`, `OWNER-UNRESOLVED`. Two document states — `UNKNOWN`, `UNOBSERVABLE`. Six, mutually exclusive; no code path collapses any pair.
- **Storage path** is `<git -C target rev-parse --absolute-git-dir>/evo-lite/hook-provenance.json`. Never `path.join(projectRoot, '.git')`. Do not add a `.gitignore` entry: the location is outside the working tree already.
- **`realpathSync.native`**, not the pure-JS `fs.realpathSync`, for real-path identity.
- **Commit point.** The provenance `rename` commits the transaction. After it returns, no fallible business operation and no artifact mutation belonging to that invocation may occur.

---

### Task 1: Path identity primitive

Satisfies part of ac6 and ac13. Everything downstream that compares two paths calls this and nothing else.

**Files:**
- Create: `templates/cli/hook-provenance/path-identity.js`
- Create: `.evo-lite/cli/hook-provenance/path-identity.js` (byte-identical mirror)
- Create: `templates/cli/test/hook-provenance.js`
- Create: `.evo-lite/cli/test/hook-provenance.js` (byte-identical mirror)
- Modify: `templates/cli/test/governance.js` and its mirror — one require and one call

**Interfaces:**
- Produces: `pathIdentity(a, b, fsOps = fs)` returning the string `'SAME' | 'DISTINCT' | 'UNESTABLISHED'`, and `canonPath(p)` returning the canonical form. `fsOps` exists so later tasks can inject a failing `realpathSync.native`.

- [ ] **Step 1: Write the failing tests**

Create `templates/cli/test/hook-provenance.js`:

```js
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

    console.log('--- hook-provenance tests passed! ---');
}

module.exports = { runHookProvenanceTests };
```

- [ ] **Step 2: Wire the suite in and watch it fail**

In `templates/cli/test/governance.js`, inside `runGovernanceTests()`, immediately before the final success log of the non-child path, add:

```js
        const { runHookProvenanceTests } = require('./hook-provenance');
        await runHookProvenanceTests();
```

Run: `node .evo-lite/cli/test.js governance > out.txt 2>&1; grep -n "HP1\|Cannot find module" out.txt`
Expected: FAIL with `Cannot find module '../hook-provenance/path-identity'`.

- [ ] **Step 3: Implement the primitive**

Create `templates/cli/hook-provenance/path-identity.js`:

```js
'use strict';
// The single authority for "do these two paths name the same location".
// Both the runnability locator and the workspace-scope classifier call this and
// nothing else; two private copies of this ladder would drift, and the whole
// point is that only a positively resolved difference may be called a difference.
const fs = require('fs');
const path = require('path');

const SEP = String.fromCharCode(92); // backslash, kept out of string literals

function canonPath(p) {
    let out = path.resolve(p).split(SEP).join('/');
    if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
    return out;
}

// Returns 'SAME' | 'DISTINCT' | 'UNESTABLISHED'.
// Exact canonical equality is the ONLY lexical shortcut. A case-only difference
// is NOT equality: on a case-sensitive filesystem hooks/Foo and hooks/foo are two
// real directories, so treating them as equal would fabricate a positive.
function pathIdentity(a, b, fsOps = fs) {
    const ca = canonPath(a);
    const cb = canonPath(b);
    if (ca === cb) return 'SAME';

    let ra;
    let rb;
    try {
        ra = canonPath(fsOps.realpathSync.native(ca));
        rb = canonPath(fsOps.realpathSync.native(cb));
    } catch (_) {
        return 'UNESTABLISHED';
    }
    return ra === rb ? 'SAME' : 'DISTINCT';
}

module.exports = { pathIdentity, canonPath };
```

Mirror it to `.evo-lite/cli/hook-provenance/path-identity.js`.

- [ ] **Step 4: Run the tests**

Run: `node .evo-lite/cli/test.js governance > out.txt 2>&1; grep -n "HP1\|HP2\|HP3\|hook-provenance tests passed" out.txt`
Expected: PASS, three HP lines and the passing banner.

- [ ] **Step 5: Prove the case shortcut cannot come back**

Temporarily change `if (ca === cb)` to `if (ca.toLowerCase() === cb.toLowerCase())`, re-run, and record which assertion fails. On a case-sensitive filesystem HP1 must go red on the `hooks` / `Hooks` assertion. On a case-insensitive filesystem it will not — record that honestly as "not falsifiable on this host" rather than claiming the guard is load-bearing here. Restore the file and confirm the suite is green again.

- [ ] **Step 6: Commit**

```bash
git add templates/cli/hook-provenance/path-identity.js .evo-lite/cli/hook-provenance/path-identity.js templates/cli/test/hook-provenance.js .evo-lite/cli/test/hook-provenance.js templates/cli/test/governance.js .evo-lite/cli/test/governance.js
git commit -m "feat(provenance): one path-identity primitive, resolved not guessed"
```

---

### Task 2: Document schema, vocabularies, and the shared validator

Satisfies ac3, ac4, ac10, ac12, and the vocabulary half of ac5.

**Files:**
- Create: `templates/cli/hook-provenance/schema.js` + mirror
- Modify: `templates/cli/test/hook-provenance.js` + mirror

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `KIND = 'evo-lite/hook-install-provenance'`, `SCHEMA_VERSION = 1`
  - `INSTALL_REASONS`, `LOCATOR_REASONS`, `EXECUTABLE_REASONS`, `INTERPRETER_REASONS`, `INTENT_SOURCES` — frozen objects keyed by the verdict or outcome they may accompany
  - `eventProjection(event)` → the fixed 20-slot array
  - `eventId(event)` → `'sha256:' + hex`
  - `currentDigest(participation)` → `'sha256:' + hex`
  - `aggregateRunnability({ locator, executable, interpreter })` → `'satisfied' | 'not-satisfied' | 'indeterminate'`
  - `validateHookProvenanceV1(raw)` → `{ ok: true, doc }` or `{ ok: false, errors: [string] }`

- [ ] **Step 1: Write the failing tests**

Append to `templates/cli/test/hook-provenance.js`, before the final banner:

```js
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
```

Add these two helpers near the top of the file:

```js
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
            targetPath: '/r/.git/hooks/post-commit', expectedBodyDigest: 'sha256:b',
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node .evo-lite/cli/test.js governance > out.txt 2>&1; grep -n "HP4\|Cannot find module" out.txt`
Expected: FAIL with `Cannot find module '../hook-provenance/schema'`.

- [ ] **Step 3: Implement the schema module**

Create `templates/cli/hook-provenance/schema.js`. The vocabularies are keyed by the verdict they may accompany, so "is this reason legal here" is one lookup rather than a chain of conditionals:

```js
'use strict';
const crypto = require('crypto');

const KIND = 'evo-lite/hook-install-provenance';
const SCHEMA_VERSION = 1;

const PARTICIPATION = ['participating', 'non-participating'];

// C-2d: which producer authority may declare which participation.
const INTENT_SOURCES = {
    'scaffold-no-hooks': 'non-participating',
    'scaffold-default': 'participating',
    'hook-install-command': 'participating',
};

// There is deliberately no 'already-current': the installer always writes.
const INSTALL_REASONS = {
    realized: ['created-managed-hook', 'updated-managed-block', 'appended-managed-block'],
    unrealized: ['hooks-dir-missing', 'hooks-dir-not-directory', 'write-failed'],
    indeterminate: ['hooks-dir-unobservable', 'pre-write-observation-failed',
        'post-write-observation-failed'],
};

// chmod is present if and only if the write was ISSUED. These are the phase-1
// reasons — decided before any write was issued — so they carry none. Every other
// reason belongs to phase 2/3 and must carry one. Keying off the phase rather
// than off a list of "failure" reasons is the point: pre-write-observation-failed
// and post-write-observation-failed are both failures, and only the second
// followed a write.
const PRE_WRITE_REASONS = ['hooks-dir-missing', 'hooks-dir-not-directory',
    'hooks-dir-unobservable', 'pre-write-observation-failed'];
const LOCATOR_REASONS = {
    satisfied: [],
    'not-satisfied': ['active-hooks-dir-differs'],
    indeterminate: ['authority-query-unavailable', 'authority-query-failed', 'path-comparison-ambiguous'],
};
const EXECUTABLE_REASONS = {
    satisfied: [],
    'not-satisfied': ['predicate-reports-not-executable'],
    indeterminate: ['no-qualified-predicate', 'predicate-qualification-failed'],
};
const INTERPRETER_REASONS = {
    satisfied: [],
    'not-satisfied': ['incompatible-interpreter', 'syntax-rejected'],
    indeterminate: ['missing-shebang', 'ambiguous-interpreter', 'no-safe-parser'],
};
const COMPONENT_REASONS = {
    locator: LOCATOR_REASONS, executable: EXECUTABLE_REASONS, interpreter: INTERPRETER_REASONS,
};

const sha256 = (s) => 'sha256:' + crypto.createHash('sha256').update(s).digest('hex');
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;

// C-2b: the authoritative projection of `current` is participation ALONE.
// derivedFrom must not enter it — resultingCurrentDigest feeds event.id and
// derivedFrom equals event.id, so including it would close a cycle.
const currentDigest = (participation) => sha256(JSON.stringify([participation]));

const pick = (obj, ...keys) => {
    let cur = obj;
    for (const k of keys) {
        if (cur === null || cur === undefined) return null;
        cur = cur[k];
    }
    return cur === undefined ? null : cur;
};

// Fixed length, fixed order. Absent fields contribute null so the array length
// never varies with event kind. `id` and the whole of `diagnostic` are excluded.
function eventProjection(e) {
    return [
        KIND, SCHEMA_VERSION, pick(e, 'seq'), pick(e, 'recordedAt'),
        pick(e, 'intent', 'participation'), pick(e, 'intent', 'source'),
        pick(e, 'install', 'outcome'), pick(e, 'install', 'reason'),
        pick(e, 'install', 'targetPath'), pick(e, 'install', 'expectedBodyDigest'),
        pick(e, 'install', 'chmod', 'attempted'), pick(e, 'install', 'chmod', 'threw'),
        pick(e, 'runnability', 'verdict'),
        pick(e, 'runnability', 'locator', 'verdict'), pick(e, 'runnability', 'locator', 'reason'),
        pick(e, 'runnability', 'executable', 'verdict'), pick(e, 'runnability', 'executable', 'reason'),
        pick(e, 'runnability', 'interpreter', 'verdict'), pick(e, 'runnability', 'interpreter', 'reason'),
        pick(e, 'resultingCurrentDigest'),
    ];
}

const eventId = (e) => sha256(JSON.stringify(eventProjection(e)));

function aggregateRunnability(r) {
    const parts = [r.locator, r.executable, r.interpreter];
    if (parts.some(p => p && p.verdict === 'not-satisfied')) return 'not-satisfied';
    if (parts.some(p => !p || p.verdict === 'indeterminate')) return 'indeterminate';
    return 'satisfied';
}

function validateComponent(name, c, errors) {
    const allowed = COMPONENT_REASONS[name];
    if (!c || typeof c !== 'object') { errors.push(`${name} missing`); return; }
    if (!Object.prototype.hasOwnProperty.call(allowed, c.verdict)) {
        errors.push(`${name}.verdict invalid: ${c.verdict}`); return;
    }
    // reason is null if and only if the verdict is satisfied
    if (c.verdict === 'satisfied') {
        if (c.reason !== null) errors.push(`${name}.reason must be null when satisfied`);
        return;
    }
    if (!allowed[c.verdict].includes(c.reason)) {
        errors.push(`${name}.reason not permitted for ${c.verdict}: ${c.reason}`);
    }
}

// The ONE shape contract, used by producer and reader alike. A split contract
// lets a writer publish a document its own reader rejects
// (templates/cli/takeover-install.js:281).
//
// Scope is exactly three regions: top level, current, and the LAST event.
// Interior events are not inspected at all — tampering there degrades the audit
// trail by design and must not change the reader's state.
function validateHookProvenanceV1(raw) {
    const errors = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, errors: ['document is not an object'] };
    }
    if (raw.kind !== KIND) errors.push(`kind invalid: ${raw.kind}`);
    if (raw.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion invalid: ${raw.schemaVersion}`);

    const cur = raw.current;
    if (!cur || typeof cur !== 'object') errors.push('current missing');
    else {
        if (!PARTICIPATION.includes(cur.participation)) errors.push(`current.participation invalid: ${cur.participation}`);
        if (typeof cur.derivedFrom !== 'string' || !SHA256_RE.test(cur.derivedFrom)) errors.push('current.derivedFrom invalid');
    }

    if (!Array.isArray(raw.events) || raw.events.length === 0) {
        errors.push('events must be a non-empty array');
        return { ok: false, errors };
    }
    const last = raw.events[raw.events.length - 1];
    if (!last || typeof last !== 'object') {
        errors.push('last event is not an object');
        return { ok: false, errors };
    }

    if (!Number.isSafeInteger(last.seq) || last.seq < 1) errors.push(`seq invalid: ${last.seq}`);
    if (typeof last.recordedAt !== 'string') errors.push('recordedAt invalid');

    const intent = last.intent;
    if (!intent || typeof intent !== 'object') errors.push('intent missing');
    else {
        if (!PARTICIPATION.includes(intent.participation)) errors.push(`intent.participation invalid: ${intent.participation}`);
        if (!Object.prototype.hasOwnProperty.call(INTENT_SOURCES, intent.source)) {
            errors.push(`intent.source invalid: ${intent.source}`);
        } else if (INTENT_SOURCES[intent.source] !== intent.participation) {
            // C-2d
            errors.push(`intent incoherent: ${intent.source} cannot declare ${intent.participation}`);
        }
    }

    const participating = intent && intent.participation === 'participating';
    const inst = last.install;
    if (!participating) {
        if (inst !== undefined) errors.push('non-participating event must carry no install');
        if (last.runnability !== undefined) errors.push('non-participating event must carry no runnability');
    } else if (!inst || typeof inst !== 'object') {
        errors.push('participating event must carry install');
    } else {
        if (!Object.prototype.hasOwnProperty.call(INSTALL_REASONS, inst.outcome)) {
            errors.push(`install.outcome invalid: ${inst.outcome}`);
        } else if (!INSTALL_REASONS[inst.outcome].includes(inst.reason)) {
            errors.push(`install.reason not permitted for ${inst.outcome}: ${inst.reason}`);
        }
        if (typeof inst.targetPath !== 'string' || inst.targetPath.length === 0) {
            errors.push('install.targetPath required on every outcome');
        }
        // chmod is present if and only if the write was ISSUED — not "attempted".
        // An observation that fails before the write is reached has attempted
        // nothing, so pre-write-observation-failed belongs on the absent side.
        const preWrite = PRE_WRITE_REASONS.includes(inst.reason);
        if (preWrite) {
            if (inst.chmod !== undefined) errors.push(`install.chmod must be absent for ${inst.reason}`);
        } else if (!inst.chmod || typeof inst.chmod !== 'object') {
            errors.push('install.chmod required when a write was attempted');
        } else if (inst.chmod.attempted !== true || typeof inst.chmod.threw !== 'boolean') {
            errors.push('install.chmod must be { attempted: true, threw: boolean }');
        }
        if (inst.outcome === 'realized') {
            if (typeof inst.expectedBodyDigest !== 'string' || !SHA256_RE.test(inst.expectedBodyDigest)) {
                errors.push('install.expectedBodyDigest required when realized');
            }
            if (!last.runnability || typeof last.runnability !== 'object') {
                errors.push('realized event must carry runnability');
            }
        } else if (last.runnability !== undefined) {
            errors.push(`${inst.outcome} event must carry no runnability`);
        }
        if (inst.expectedBodyDigest !== undefined && inst.outcome !== 'realized') {
            errors.push('install.expectedBodyDigest only when realized');
        }
    }

    if (last.runnability && typeof last.runnability === 'object') {
        // No top-level reason: the verdict is a mechanical aggregation, so any
        // top-level reason would duplicate whichever component drove it.
        if (last.runnability.reason !== undefined) errors.push('runnability must have no top-level reason');
        for (const name of ['locator', 'executable', 'interpreter']) {
            validateComponent(name, last.runnability[name], errors);
        }
        if (errors.length === 0 && last.runnability.verdict !== aggregateRunnability(last.runnability)) {
            // A stored verdict must never overrule the rule that produced it.
            errors.push('runnability.verdict does not equal the aggregation of its components');
        }
    }

    if (errors.length === 0) {
        if (last.id !== eventId(last)) errors.push('last event id does not recompute');
        if (cur.derivedFrom !== last.id) errors.push('C-2a: derivedFrom != last event id');
        if (last.resultingCurrentDigest !== currentDigest(cur.participation)) {
            errors.push('C-2b: resultingCurrentDigest != digest(current.participation)');
        }
        if (cur.participation !== intent.participation) {
            errors.push('C-2c: current.participation != last event intent.participation');
        }
    }

    return errors.length === 0 ? { ok: true, doc: raw } : { ok: false, errors };
}

module.exports = {
    KIND, SCHEMA_VERSION, PARTICIPATION, INTENT_SOURCES,
    INSTALL_REASONS, LOCATOR_REASONS, EXECUTABLE_REASONS, INTERPRETER_REASONS,
    currentDigest, eventProjection, eventId, aggregateRunnability, validateHookProvenanceV1,
};
```

Mirror it.

- [ ] **Step 4: Run the tests**

Run: `node .evo-lite/cli/test.js governance > out.txt 2>&1; grep -n "HP4\|HP5\|HP6\|hook-provenance tests passed" out.txt`
Expected: PASS.

- [ ] **Step 5: Mutation controls — four rules, four separate runs**

Run each one alone, restore between runs, and record `exit`, the assertion that failed, and whether that assertion is the one guarding the rule. A mutation that goes red on some earlier assertion proves nothing about its target.

| # | Mutation | Must go red on |
|---|---|---|
| M1 | delete the `C-2c` check | HP6 "participating current over a non-participating intent" |
| M2 | delete the `C-2d` check in the intent block | HP6 "explicit install may not be recorded as an explicit opt-out" |
| M3 | replace the aggregation comparison with `true` | HP6 "runnability.verdict must equal the aggregation" |
| M4 | make the validator walk `raw.events` instead of only the last | HP6 "malformed interior event must not change the reader state" |
| M4b | delete the `chmod` conditional-shape block | HP6 "a pre-write outcome must carry no chmod" |
| M4d | drop `pre-write-observation-failed` from `PRE_WRITE_REASONS` while leaving it in the vocabulary | HP6 "it must not claim a chmod: the write was never issued" |
| M4c | delete the top-level `runnability.reason` rejection | HP6 "runnability must have no top-level reason" |

- [ ] **Step 6: Commit**

```bash
git add templates/cli/hook-provenance/schema.js .evo-lite/cli/hook-provenance/schema.js templates/cli/test/hook-provenance.js .evo-lite/cli/test/hook-provenance.js
git commit -m "feat(provenance): v1 schema, frozen vocabularies, and the one shared validator"
```

---

### Task 3: Topology classifier

Satisfies ac13 and ac15, and the storage half of ac1.

**Files:**
- Create: `templates/cli/hook-provenance/topology.js` + mirror
- Modify: `templates/cli/test/hook-provenance.js` + mirror

**Interfaces:**
- Consumes: `pathIdentity` from Task 1.
- Produces: `classifyTopology(targetDir, deps = {})` returning one of

```
{ state: 'IN-SCOPE',              ownerRoot, worktreeTop, provenancePath }
{ state: 'NESTED-TARGET',         worktreeTop }
{ state: 'SCOPE-UNRESOLVED',      detail }
{ state: 'NO-GIT-ADMIN-TOPOLOGY' }
{ state: 'OWNER-UNRESOLVED',      detail }
```

`deps.gitQuery(targetDir, args)` returns `{ status, stdout }`, injectable so tests can force each branch. `deps.fsOps` is passed through to `pathIdentity`.

- [ ] **Step 1: Write the failing tests**

Append to `templates/cli/test/hook-provenance.js`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node .evo-lite/cli/test.js governance > out.txt 2>&1; grep -n "HP7\|Cannot find module" out.txt`
Expected: FAIL with `Cannot find module '../hook-provenance/topology'`.

- [ ] **Step 3: Implement**

Create `templates/cli/hook-provenance/topology.js`:

```js
'use strict';
// Decides whether this target has a provenance context at all, BEFORE anything
// is read or written. The order matters: a nested target's --absolute-git-dir
// succeeds and returns the ENCLOSING worktree's git-dir, so a classifier that
// began at owner resolution would create <outer-git-dir>/evo-lite before ever
// noticing it was out of scope.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathIdentity } = require('./path-identity');

// Every query is bound to the target. The CLI takes a target path, so an
// unbound query would resolve the CALLER's git-dir while mutating the target's
// hook (index.js:93, index.js:292).
function defaultGitQuery(targetDir, args) {
    // The message locale is forced so the classification below reads one fixed
    // string rather than whatever the host has configured.
    const env = { ...process.env, LC_ALL: 'C', LC_MESSAGES: 'C', LANGUAGE: '' };
    try {
        const stdout = execFileSync('git', ['-C', targetDir, ...args],
            { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
        return { status: 0, stdout: stdout.trim(), stderr: '' };
    } catch (err) {
        // Discriminate on `status`, NOT on `code`: execFileSync sets `status` to
        // the exit code when the process RAN and failed, and leaves it null when
        // the process could not be spawned at all. `code` is set in both cases on
        // some Node versions, so keying off it would misread a positive
        // not-a-repository answer as an unavailable git.
        if (err && typeof err.status === 'number') {
            return { status: err.status, stdout: '', stderr: String(err.stderr || '') };
        }
        throw err;                                // git absent / cannot spawn
    }
}

// A non-zero exit is NOT an authority on "there is no repository here". Measured:
// a non-repository directory and a BARE repository both exit 128 —
//   "fatal: not a git repository (or any of the parent directories): .git"
//   "fatal: this operation must be run in a work tree"
// — and only the first is a positive not-a-repository answer. Everything else
// (bare repo, dubious ownership, corrupt config, permission) is a query failure
// and must land on SCOPE-UNRESOLVED.
//
// The match is deliberately one-directional: anything that does not positively
// match is treated as a failure, so a future change to Git's wording degrades
// this into fail-closed rather than into a false "no repository".
const NOT_A_REPOSITORY = /fatal:\s+not a git repository/i;
const isPositiveNotARepository = (res) =>
    res.status !== 0 && NOT_A_REPOSITORY.test(res.stderr || '');

function classifyTopology(targetDir, deps = {}) {
    const gitQuery = deps.gitQuery || defaultGitQuery;
    const fsOps = deps.fsOps || fs;

    let top;
    try {
        top = gitQuery(targetDir, ['rev-parse', '--show-toplevel']);
    } catch (err) {
        return { state: 'SCOPE-UNRESOLVED', detail: `git unavailable: ${err.message}` };
    }
    if (top.status !== 0 || !top.stdout) {
        if (isPositiveNotARepository(top)) return { state: 'NO-GIT-ADMIN-TOPOLOGY' };
        return { state: 'SCOPE-UNRESOLVED', detail: `scope query failed (${top.status})` };
    }

    const identity = pathIdentity(targetDir, top.stdout, fsOps);
    if (identity === 'DISTINCT') return { state: 'NESTED-TARGET', worktreeTop: top.stdout };
    if (identity === 'UNESTABLISHED') {
        // NESTED-TARGET is a positive assertion; UNESTABLISHED is precisely the
        // state in which we are not entitled to make it.
        return { state: 'SCOPE-UNRESOLVED', detail: 'workspace scope could not be established' };
    }

    let owner;
    try {
        owner = gitQuery(targetDir, ['rev-parse', '--absolute-git-dir']);
    } catch (err) {
        return { state: 'OWNER-UNRESOLVED', detail: `git unavailable: ${err.message}` };
    }
    if (owner.status !== 0 || !owner.stdout) {
        // Same taxonomy as the scope gate, not a local simplification. It is rare
        // to get here (scope just established a worktree) but a repository can be
        // removed between the two queries, and the frozen states do not change
        // because a branch is unlikely.
        if (isPositiveNotARepository(owner)) return { state: 'NO-GIT-ADMIN-TOPOLOGY' };
        return { state: 'OWNER-UNRESOLVED', detail: `owner query failed (${owner.status})` };
    }

    const ownerRoot = path.join(owner.stdout, 'evo-lite');
    return {
        state: 'IN-SCOPE',
        ownerRoot,
        worktreeTop: top.stdout,
        provenancePath: path.join(ownerRoot, 'hook-provenance.json'),
    };
}

module.exports = { classifyTopology, defaultGitQuery };
```

Mirror it.

- [ ] **Step 4: Run the tests**

Run: `node .evo-lite/cli/test.js governance > out.txt 2>&1; grep -n "HP7\|HP8\|hook-provenance tests passed" out.txt`
Expected: PASS.

- [ ] **Step 5: Mutation controls**

| # | Mutation | Must go red on |
|---|---|---|
| M5 | change `identity === 'UNESTABLISHED'` to also return `NESTED-TARGET` | HP7 "must be SCOPE-UNRESOLVED, never NESTED-TARGET" |
| M6a | drop `'-C', targetDir` from the **owner** query only | HP8 "must be the TARGET git-dir" |
| M7 | return `SCOPE-UNRESOLVED` on every `top.status !== 0` | HP7 "a non-repository must not be swallowed into SCOPE-UNRESOLVED" |
| M7b | replace `isPositiveNotARepository` with `res.status !== 0` | HP7 "a bare repository … is NOT a positive not-a-repository answer" |

- [ ] **Step 6: Commit**

```bash
git add templates/cli/hook-provenance/topology.js .evo-lite/cli/hook-provenance/topology.js templates/cli/test/hook-provenance.js .evo-lite/cli/test/hook-provenance.js
git commit -m "feat(provenance): total topology classifier bound to the target workspace"
```

---

### Task 4: Observation layer

Satisfies ac5, ac6, ac7, ac8.

**Files:**
- Create: `templates/cli/hook-provenance/observe.js` + mirror
- Modify: `templates/cli/test/hook-provenance.js` + mirror

**Interfaces:**
- Consumes: `pathIdentity`, `aggregateRunnability`, `classifyTopology`'s git query.
- Produces:
  - `observeHooksDir(hooksDir, fsOps = fs)` → `{ outcome: null }` when usable, else `{ outcome, reason }` per the frozen errno mapping
  - `observeLocator({ targetPath, targetDir, gitQuery, fsOps })` → `{ verdict, reason }`
  - `observeExecutable(hookPath, fsOps)` → `{ verdict, reason }` plus `{ predicate, qualification }` diagnostics
  - `observeInterpreter(hookPath, fsOps)` → `{ verdict, reason }` plus `{ shebang }`
  - `observeRunnability(args)` → the full `runnability` object with the aggregated verdict

- [ ] **Step 1: Write the failing tests**

```js
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

        // "Aligned" is asserted on WHICH interpreter was invoked, not on a grammar
        // difference between sh and bash. Measured on the Windows/msys development
        // host, `sh` IS bash (GNU bash 5.2.37), so every syntax-difference fixture
        // — including array literals — exits 0 under both, and a hardcoded `sh -n`
        // mutation could never be falsified there. Observing the argv makes this
        // control host-independent.
        // `#!/usr/bin/env bash`, not `#!/bin/bash`: an absolute interpreter goes
        // through the presence gate first, so on any host where Node cannot stat
        // /bin/bash the run returns no-safe-parser without ever reaching the spy,
        // `invoked` stays empty, and a CORRECT implementation fails this control.
        // The env form skips that gate and leaves the consultation observable
        // everywhere.
        const bashHook = path.join(root, 'bash');
        fs.writeFileSync(bashHook, '#!/usr/bin/env bash\na=(one two)\necho "${a[0]}"\n');
        const invoked = [];
        const spy = Object.create(fs);
        spy.__execFileSync = (bin, args, opts) => {
            invoked.push(bin);
            return require('child_process').execFileSync(bin, args, opts);
        };
        const b = observeInterpreter(bashHook, spy);
        assert.deepStrictEqual(invoked, ['bash'],
            `the interpreter named by the shebang is the one consulted (saw ${invoked.join(', ')})`);
        assert.notStrictEqual(b.verdict, 'not-satisfied',
            'bash-legal syntax under a bash shebang must not be reported not-satisfied');

        const py = path.join(root, 'py'); fs.writeFileSync(py, '#!/usr/bin/env python\nprint(1)\n');
        assert.deepStrictEqual(observeInterpreter(py),
            { verdict: 'not-satisfied', reason: 'incompatible-interpreter', shebang: '#!/usr/bin/env python' });

        const none = path.join(root, 'none'); fs.writeFileSync(none, 'echo hi\n');
        assert.strictEqual(observeInterpreter(none).verdict, 'indeterminate');
        assert.strictEqual(observeInterpreter(none).reason, 'missing-shebang');

        // The shebang names an ABSOLUTE interpreter that does not exist. Running a
        // same-named binary found on PATH would report satisfied for a hook Git
        // cannot execute at all — a fabricated positive.
        const ghost = path.join(root, 'ghost');
        fs.writeFileSync(ghost, '#!/opt/definitely-not-here/bash\nexit 0\n');
        const g = observeInterpreter(ghost);
        assert.strictEqual(g.verdict, 'indeterminate',
            'a declared interpreter that is not present must not be answered by a PATH lookalike');
        assert.strictEqual(g.reason, 'no-safe-parser');

        // `env -S` is a legal form this parser cannot resolve; the contract says
        // an unparseable interpreter is indeterminate, never a manufactured
        // incompatible-interpreter.
        const envS = path.join(root, 'envs');
        fs.writeFileSync(envS, '#!/usr/bin/env -S bash -e\nexit 0\n');
        const e = observeInterpreter(envS);
        assert.strictEqual(e.verdict, 'indeterminate',
            'an option-bearing env shebang must not be read as an incompatible interpreter');
        assert.strictEqual(e.reason, 'ambiguous-interpreter');
    }

    console.log('HP12. observation: locator compares directory to directory ...');
    {
        const { observeLocator } = require('../hook-provenance/observe');
        const { execFileSync } = require('child_process');
        const repo = tmp('loc');
        execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
        const targetPath = path.join(repo, '.git', 'hooks', 'post-commit');

        assert.deepStrictEqual(observeLocator({ targetDir: repo, targetPath }),
            { verdict: 'satisfied', reason: null },
            'a default installation must be satisfied, not a directory-vs-file mismatch');

        const elsewhere = path.join(repo, 'other-hooks');
        fs.mkdirSync(elsewhere);
        execFileSync('git', ['-C', repo, 'config', 'core.hooksPath', elsewhere], { stdio: 'ignore' });
        assert.deepStrictEqual(observeLocator({ targetDir: repo, targetPath }),
            { verdict: 'not-satisfied', reason: 'active-hooks-dir-differs' });
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node .evo-lite/cli/test.js governance > out.txt 2>&1; grep -n "HP9\|Cannot find module" out.txt`
Expected: FAIL with `Cannot find module '../hook-provenance/observe'`.

- [ ] **Step 3: Implement**

Create `templates/cli/hook-provenance/observe.js`:

```js
'use strict';
// Class 1 (ask the system that owns the fact) and Class 2 (read, parse,
// syntax-check) only. Nothing here executes the managed body or any substitute:
// the body runs plan progress, disposition sync and dashboard build, so running
// it would be a governance write, and a stand-in would only prove things about
// the stand-in.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathIdentity } = require('./path-identity');
const { aggregateRunnability } = require('./schema');
const { defaultGitQuery } = require('./topology');

// Preserving the errno is necessary but not sufficient — an implementation can
// see EACCES and still write `unrealized`. The mapping itself is frozen.
function observeHooksDir(hooksDir, fsOps = fs) {
    let st;
    try {
        st = fsOps.statSync(hooksDir);
    } catch (err) {
        if (err && err.code === 'ENOENT') return { outcome: 'unrealized', reason: 'hooks-dir-missing' };
        return { outcome: 'indeterminate', reason: 'hooks-dir-unobservable' };
    }
    if (!st.isDirectory()) return { outcome: 'unrealized', reason: 'hooks-dir-not-directory' };
    return { outcome: null };
}

function observeLocator({ targetDir, targetPath, gitQuery = defaultGitQuery, fsOps = fs }) {
    let res;
    try {
        res = gitQuery(targetDir, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks']);
    } catch (_) {
        return { verdict: 'indeterminate', reason: 'authority-query-unavailable' };
    }
    if (res.status !== 0 || !res.stdout) {
        return { verdict: 'indeterminate', reason: 'authority-query-failed' };
    }
    // The authority answers with a DIRECTORY; targetPath is a FILE. Comparing
    // them directly would report not-satisfied for an ordinary installation.
    switch (pathIdentity(res.stdout, path.dirname(targetPath), fsOps)) {
        case 'SAME': return { verdict: 'satisfied', reason: null };
        case 'DISTINCT': return { verdict: 'not-satisfied', reason: 'active-hooks-dir-differs' };
        default: return { verdict: 'indeterminate', reason: 'path-comparison-ambiguous' };
    }
}

// A predicate qualifies only when positive and negative controllers with
// independent ground truth both exist and it separates them. v1 ships no such
// controller: minting fixtures at observation time would leave Class 2, and the
// two obvious candidates are disqualified by measurement — statSync().mode
// reports 666 on Windows for a hook Git Bash shows as -rwxr-xr-x, and
// accessSync with X_OK also passes README.md, so it has no discriminating power
// at all. The honest answer is indeterminate, and it is expected to stand.
function observeExecutable(_hookPath, _fsOps = fs) {
    return { verdict: 'indeterminate', reason: 'no-qualified-predicate',
        predicate: null, qualification: 'unavailable' };
}

const SH_FAMILY = ['sh', 'bash', 'dash', 'ash', 'ksh', 'zsh'];

// Resolve what the shebang ACTUALLY declares. Returns { command, resolvable } or
// null when the line cannot be parsed with confidence.
//   #!/bin/sh                → { command: '/bin/sh' }
//   #!/usr/bin/env bash      → { command: 'bash', viaEnv: true }
//   #!/usr/bin/env -S bash   → null   (option-bearing env; not parsed here)
function parseShebang(line) {
    const words = line.slice(2).trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;
    if (path.basename(words[0]) === 'env') {
        // Any option to env (-S, -i, NAME=value …) puts the real interpreter
        // somewhere this parser will not guess at.
        if (!words[1] || words[1].startsWith('-') || words[1].includes('=')) return null;
        return { command: words[1], viaEnv: true };
    }
    return { command: words[0], viaEnv: false };
}

function observeInterpreter(hookPath, fsOps = fs) {
    let first;
    try {
        first = fsOps.readFileSync(hookPath, 'utf8').split('\n', 1)[0] || '';
    } catch (_) {
        return { verdict: 'indeterminate', reason: 'no-safe-parser', shebang: null };
    }
    if (!first.startsWith('#!')) {
        return { verdict: 'indeterminate', reason: 'missing-shebang', shebang: null };
    }
    const parsed = parseShebang(first);
    if (!parsed) return { verdict: 'indeterminate', reason: 'ambiguous-interpreter', shebang: first };

    if (!SH_FAMILY.includes(path.basename(parsed.command))) {
        // A byte-correct managed block under a python shebang is still inert.
        return { verdict: 'not-satisfied', reason: 'incompatible-interpreter', shebang: first };
    }

    // An ABSOLUTE path in the shebang is the interpreter Git will use. Running a
    // same-named binary found on PATH instead would answer a question about a
    // different program — reporting satisfied for a hook that cannot start.
    if (!parsed.viaEnv && path.isAbsolute(parsed.command)) {
        try { fsOps.statSync(parsed.command); }
        catch (_) { return { verdict: 'indeterminate', reason: 'no-safe-parser', shebang: first }; }
    }

    // Interpreter-ALIGNED syntax check: a bash hook is checked by bash, so
    // bash-legal syntax is not reported as a defect. The spawn goes through
    // fsOps.__execFileSync when present so a test can observe WHICH interpreter
    // was consulted — on hosts where sh and bash are the same binary a grammar
    // difference cannot distinguish them, but the argv always can.
    const spawn = fsOps.__execFileSync || execFileSync;
    try {
        spawn(parsed.command, ['-n', hookPath], { stdio: ['ignore', 'ignore', 'pipe'] });
        return { verdict: 'satisfied', reason: null, shebang: first };
    } catch (err) {
        // The parser could not be run at all (absent, not spawnable) — that is a
        // failure to observe, not a syntax defect.
        if (typeof err.status !== 'number') {
            return { verdict: 'indeterminate', reason: 'no-safe-parser', shebang: first };
        }
        return { verdict: 'not-satisfied', reason: 'syntax-rejected', shebang: first };
    }
}

function observeRunnability(args) {
    const locator = observeLocator(args);
    const executable = observeExecutable(args.targetPath, args.fsOps);
    const interpreter = observeInterpreter(args.targetPath, args.fsOps);
    const strip = c => ({ verdict: c.verdict, reason: c.reason });
    const components = { locator: strip(locator), executable: strip(executable), interpreter: strip(interpreter) };
    return {
        runnability: { verdict: aggregateRunnability(components), ...components },
        diagnostic: {
            executablePredicate: executable.predicate,
            predicateQualification: executable.qualification,
            shebang: interpreter.shebang,
        },
    };
}

module.exports = {
    observeHooksDir, observeLocator, observeExecutable, observeInterpreter, observeRunnability,
};
```

Mirror it.

- [ ] **Step 4: Run the tests**

Run: `node .evo-lite/cli/test.js governance > out.txt 2>&1; grep -n "HP9\|HP10\|HP11\|HP12\|hook-provenance tests passed" out.txt`
Expected: PASS.

- [ ] **Step 5: Mutation controls**

| # | Mutation | Must go red on |
|---|---|---|
| M8 | map every `statSync` throw to `unrealized / hooks-dir-missing` | HP9 "a permission error is a failure to observe" |
| M9 | compare `res.stdout` to `targetPath` instead of its dirname | HP12 "must be satisfied, not a directory-vs-file mismatch" |
| M10 | run `sh -n` regardless of the shebang | HP11 "the interpreter named by the shebang is the one consulted" |
| M10b | return a constant `satisfied` from `observeExecutable` | HP10 "v1 has no qualified executable predicate on any host" |
| M10c | drop the absolute-interpreter `statSync` and run `path.basename(command)` | HP11 "must not be answered by a PATH lookalike" |
| M10d | make `parseShebang` take `words[1]` even when it starts with `-` | HP11 "must not be read as an incompatible interpreter" |
| M6b | drop `'-C', targetDir` from the **locator** query only | HP12b "must be B's, even when the caller stands in A" |

- [ ] **Step 6: Commit**

```bash
git add templates/cli/hook-provenance/observe.js .evo-lite/cli/hook-provenance/observe.js templates/cli/test/hook-provenance.js .evo-lite/cli/test/hook-provenance.js
git commit -m "feat(provenance): static observation with the frozen errno and runnability rules"
```

---

### Task 5: The store — read-before-mutate gate and atomic commit

Satisfies ac9 and ac14, and the reader half of ac10.

**Files:**
- Create: `templates/cli/hook-provenance/store.js` + mirror
- Modify: `templates/cli/test/hook-provenance.js` + mirror

**Interfaces:**
- Consumes: `validateHookProvenanceV1`, `eventId`, `currentDigest` from Task 2.
- Produces:
  - `readProvenance(provenancePath, fsOps = fs)` → `{ state: 'ABSENT' | 'VALID' | 'UNOBSERVABLE', doc?, errors? }`
  - `appendEvent(provenancePath, prior, eventDraft, fsOps = fs)` → the committed document; throws if the transaction cannot commit
- `appendEvent` assigns `seq`, `resultingCurrentDigest`, `id`, and the new `current`; callers supply only `recordedAt`, `intent`, and the optional `install` / `runnability` / `diagnostic`.

- [ ] **Step 1: Write the failing tests**

```js
    console.log('HP13. store: only a positive ENOENT makes the document ABSENT ...');
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
    }

    console.log('HP14. store: seq is monotonic and current follows intent ...');
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

    console.log('HP15. store: an unobservable document is never overwritten ...');
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node .evo-lite/cli/test.js governance > out.txt 2>&1; grep -n "HP13\|Cannot find module" out.txt`
Expected: FAIL with `Cannot find module '../hook-provenance/store'`.

- [ ] **Step 3: Implement**

Create `templates/cli/hook-provenance/store.js`:

```js
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { KIND, SCHEMA_VERSION, eventId, currentDigest, validateHookProvenanceV1 } = require('./schema');

// Only a positive ENOENT may make the document ABSENT. A permission error or an
// unreadable mount is a failure to observe — and this is the one place where
// that collapse would manufacture UNKNOWN, the state the whole design exists to
// stop from being fabricated. existsSync is therefore never used here.
function readProvenance(provenancePath, fsOps = fs) {
    let raw;
    try {
        raw = fsOps.readFileSync(provenancePath, 'utf8');
    } catch (err) {
        if (err && err.code === 'ENOENT') return { state: 'ABSENT' };
        return { state: 'UNOBSERVABLE', errors: [`read failed: ${err && err.code}`] };
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        return { state: 'UNOBSERVABLE', errors: [`unparseable: ${err.message}`] };
    }
    const result = validateHookProvenanceV1(parsed);
    if (!result.ok) return { state: 'UNOBSERVABLE', errors: result.errors };
    return { state: 'VALID', doc: parsed };
}

function commit(provenancePath, doc, fsOps) {
    const tmpPath = `${provenancePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
    try {
        fsOps.mkdirSync(path.dirname(provenancePath), { recursive: true });
        fsOps.writeFileSync(tmpPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
        const back = JSON.parse(fsOps.readFileSync(tmpPath, 'utf8'));
        const check = validateHookProvenanceV1(back);
        if (!check.ok) throw new Error(`read-back failed validation: ${check.errors.join('; ')}`);
        if (JSON.stringify(back) !== JSON.stringify(doc)) throw new Error('read-back mismatch');
        fsOps.renameSync(tmpPath, provenancePath);  // 原子替换;此后不得再有可失败的业务操作
    } catch (e) {
        let cleanupError = null;
        try { fsOps.unlinkSync(tmpPath); } catch (e2) { if (e2 && e2.code !== 'ENOENT') cleanupError = e2; }
        if (cleanupError) {
            throw new AggregateError([e, cleanupError],
                `hook provenance not committed; orphaned temp may remain at ${tmpPath}`);
        }
        throw new Error(`hook provenance not committed (${e.message})`);
    }
    return doc;
}

// `prior` is the result of readProvenance. An UNOBSERVABLE document stops the
// run: treating it as empty history would convert "I could not read it" into
// "there was never any history" — this debt's original defect, reproduced
// inside its own remedy.
function appendEvent(provenancePath, prior, draft, fsOps = fs) {
    if (prior.state === 'UNOBSERVABLE') {
        throw new Error('hook provenance is unobservable; refusing to overwrite it');
    }
    const events = prior.state === 'VALID' ? prior.doc.events.slice() : [];
    const seq = events.length === 0 ? 1 : events[events.length - 1].seq + 1;
    const participation = draft.intent.participation;

    const event = { seq, recordedAt: draft.recordedAt, intent: draft.intent };
    if (draft.install) event.install = draft.install;
    if (draft.runnability) event.runnability = draft.runnability;
    event.resultingCurrentDigest = currentDigest(participation);
    event.id = eventId(event);
    if (draft.diagnostic) event.diagnostic = draft.diagnostic;

    events.push(event);
    return commit(provenancePath, {
        kind: KIND, schemaVersion: SCHEMA_VERSION,
        current: { participation, derivedFrom: event.id },
        events,
    }, fsOps);
}

module.exports = { readProvenance, appendEvent };
```

Mirror it.

- [ ] **Step 4: Run the tests**

Run: `node .evo-lite/cli/test.js governance > out.txt 2>&1; grep -n "HP13\|HP14\|HP15\|hook-provenance tests passed" out.txt`
Expected: PASS.

- [ ] **Step 5: Mutation controls**

| # | Mutation | Must go red on |
|---|---|---|
| M11 | treat `UNOBSERVABLE` as empty history and start at `seq = 1` | HP15 "appending onto an unobservable document must throw" |
| M12 | map every read failure to `ABSENT` | HP13 "a permission error must not be reported as ABSENT" |
| M13 | derive `current.participation` from `draft.install.outcome` | HP14 "an explicit install supersedes an earlier opt-out" |

- [ ] **Step 6: Commit**

```bash
git add templates/cli/hook-provenance/store.js .evo-lite/cli/hook-provenance/store.js templates/cli/test/hook-provenance.js .evo-lite/cli/test/hook-provenance.js
git commit -m "feat(provenance): read-before-mutate gate and the atomic commit point"
```

---

### Task 6: Producer transaction in `hooks.js`

Satisfies ac2, ac9, ac13 end to end, and the producer half of ac5.

**Files:**
- Modify: `templates/cli/hooks.js` + mirror — `installPostCommitHook`, the `hook install` command action
- Modify: `templates/cli/test/hook-provenance.js` + mirror

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: `installPostCommitHook(targetDir, options = {})` returning
  `{ topology, provenance: 'committed' | 'not-attempted' | 'failed', artifactContent: 'unchanged' | 'modified' | 'indeterminate' | 'not-observed', chmodEvidence: null | { issued: true, threw: boolean }, event }`.
  `artifactContent` is decided by digesting the hook file before and after, never by "a write was attempted", and it names **content only** — it is settled before `chmodSync` runs, so a byte-identical rewrite whose mode changed would otherwise be reported as `unchanged` while the artifact really did change. Mode is therefore reported on its own axis as `chmodEvidence`, which is operation evidence and never an artifact fact. `not-observed` covers the nested exception and every topology short-circuit, where no before/after pair was taken.
  `options.participation` defaults to `'participating'`; `options.source` defaults to `'scaffold-default'`. The existing zero-argument call sites keep working.

**Order, which is part of the contract:**

```
1  classifyTopology(targetDir)
     NESTED-TARGET     → legacy installer MAY run; return, claim nothing
     SCOPE-UNRESOLVED  → do NOT mutate; throw
     NO-GIT-ADMIN-TOPOLOGY → do not mutate; return (caller decides the exit code)
     OWNER-UNRESOLVED  → do NOT mutate; throw
2  mkdir <ownerRoot>
3  readProvenance → UNOBSERVABLE ⇒ do NOT mutate; throw
4  non-participating ⇒ record the event and return without touching the hook
5  observeHooksDir ⇒ on a non-null outcome, record it and return without writing
6  write the artifact, then observe it
7  observeRunnability only when the outcome is realized
8  appendEvent — the rename commits; nothing fallible after it
```

- [ ] **Step 1: Write the failing tests**

```js
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
        assert.strictEqual(r.artifactContent, 'unchanged');
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node .evo-lite/cli/test.js governance > out.txt 2>&1; grep -n "HP16\|HP17\|AssertionError" out.txt`
Expected: FAIL — `installPostCommitHook` currently returns `undefined`.

- [ ] **Step 3: Rewrite `installPostCommitHook`**

Keep `buildHookBody`, the sentinels, and `diffInstalledHook` exactly as they are. Add these three functions and replace `installPostCommitHook` entirely:

```js
const crypto = require('crypto');
const { classifyTopology } = require('./hook-provenance/topology');
const { readProvenance, appendEvent } = require('./hook-provenance/store');
const { observeHooksDir, observeRunnability } = require('./hook-provenance/observe');

// The artifact dimension of the two-dimension report. `null` means the file was
// absent — a fact — while `undefined` means the digest could not be taken.
function digestFile(p, fsOps) {
    try {
        return 'sha256:' + crypto.createHash('sha256').update(fsOps.readFileSync(p)).digest('hex');
    } catch (err) {
        return err && err.code === 'ENOENT' ? null : undefined;
    }
}

function compareArtifact(before, after) {
    if (before === undefined || after === undefined) return 'indeterminate';
    return before === after ? 'unchanged' : 'modified';
}

// Returns { reason, threw, phase } and never throws. `phase` distinguishes a
// failure BEFORE any write was issued from one during the write: the caller must
// not chmod, nor claim a write was attempted, for the former.
function writeManagedHook(hookPath, hookBody, fsOps) {
    let existing = null;
    try {
        existing = fsOps.readFileSync(hookPath, 'utf8');
    } catch (err) {
        if (!err || err.code !== 'ENOENT') return { reason: null, threw: true, phase: 'pre-write' };
    }

    // The reason is decided from what was FOUND, before the write is issued, so
    // it survives a write that throws. Deriving it afterwards would let an
    // exception rename a freshly created hook into an "updated" block.
    let reason;
    let content;
    if (existing === null) {
        reason = 'created-managed-hook';
        content = '#!/bin/sh\n' + hookBody + '\n';
    } else if (existing.includes(SENTINEL_BEGIN)) {
        reason = 'updated-managed-block';
        content = existing.replace(new RegExp(`${SENTINEL_BEGIN}[\\s\\S]*?${SENTINEL_END}`), hookBody);
    } else {
        reason = 'appended-managed-block';
        content = existing.trimEnd() + '\n\n' + hookBody + '\n';
    }

    try {
        fsOps.writeFileSync(hookPath, content);
        return { reason, threw: false, phase: 'write' };
    } catch (_) {
        // Bytes may already be on disk. The exception is evidence about the
        // operation; observeInstalled decides the fact.
        return { reason, threw: true, phase: 'write' };
    }
}

// Positive proof that the EXPECTED managed body is established. A thrown write
// has no authority here: bytes can land and the call still throw, so the write's
// exception is evidence about the operation, and this is the fact.
function observeInstalled(targetDir, attemptedReason) {
    let diff;
    try { diff = diffInstalledHook(targetDir); }
    catch (_) { return { outcome: 'indeterminate', reason: 'post-write-observation-failed' }; }

    if (diff.status === 'in-sync') {
        return { outcome: 'realized', reason: attemptedReason || 'updated-managed-block' };
    }
    if (diff.status === 'no-hook' || diff.status === 'no-block' || diff.status === 'drifted') {
        // Includes the failed update that left an OLDER managed body in place:
        // the file exists, but the expected body is positively not established.
        return { outcome: 'unrealized', reason: 'write-failed' };
    }
    return { outcome: 'indeterminate', reason: 'post-write-observation-failed' };
}

// The implementation base's behaviour, character for character, for the one
// topology where the provenance layer declines to participate. It deliberately
// does NOT call writeManagedHook: that helper swallows read and write errors so
// the observation can decide, whereas the base propagates them. Reusing it here
// would quietly change the nested exception's failure semantics, and the frozen
// contract is that legacy behaviour is unchanged — including how it fails.
function legacyInstallPostCommitHook(targetDir) {
    const hooksDir = path.join(targetDir, '.git', 'hooks');
    if (!fs.existsSync(hooksDir)) return;

    const hookBody = buildHookBody();
    const hookPath = path.join(hooksDir, 'post-commit');

    if (fs.existsSync(hookPath)) {
        let content = fs.readFileSync(hookPath, 'utf8');
        if (content.includes(SENTINEL_BEGIN)) {
            content = content.replace(
                new RegExp(`${SENTINEL_BEGIN}[\\s\\S]*?${SENTINEL_END}`),
                hookBody
            );
        } else {
            content = content.trimEnd() + '\n\n' + hookBody + '\n';
        }
        fs.writeFileSync(hookPath, content);
    } else {
        fs.writeFileSync(hookPath, '#!/bin/sh\n' + hookBody + '\n');
    }
    try { fs.chmodSync(hookPath, '755'); } catch (_) {}
}

function installPostCommitHook(targetDir, options = {}) {
    const participation = options.participation || 'participating';
    const source = options.source || 'scaffold-default';
    const recordedAt = new Date().toISOString();
    const fsOps = options.fsOps || fs;

    // 1. Workspace scope, then owner. Both before any mutation.
    const topo = classifyTopology(targetDir, options.deps);
    if (topo.state === 'NESTED-TARGET') {
        // The sole deliberate out-of-v1-provenance exception. The contract is
        // that legacy installer behaviour is UNCHANGED — not that it becomes a
        // no-op. It usually is one (a nested child has no .git/hooks of its own),
        // but "usually no-op" is a result, not a policy, and turning the result
        // into the policy would silently change behaviour where the directory
        // does exist.
        //
        // The exception covers the loss of PROVENANCE, not the loss of the user's
        // explicit refusal. An opt-out is honoured for the run wherever it is
        // expressed; what nesting costs is only the durable record of it. So
        // participation is checked FIRST — running the installer here would let a
        // topology fact overrule an explicit instruction.
        if (participation === 'participating') legacyInstallPostCommitHook(targetDir);
        return { topology: topo.state, provenance: 'not-attempted', artifactContent: 'not-observed', chmodEvidence: null, event: null };
    }
    if (topo.state === 'NO-GIT-ADMIN-TOPOLOGY') {
        return { topology: topo.state, provenance: 'not-attempted', artifactContent: 'not-observed', chmodEvidence: null, event: null };
    }
    if (topo.state !== 'IN-SCOPE') {
        // SCOPE-UNRESOLVED / OWNER-UNRESOLVED fail closed: a failed observation
        // is not a licence to change the artifact.
        throw new Error(`hook provenance ${topo.state}: ${topo.detail || ''} — hook not modified`);
    }
    fsOps.mkdirSync(topo.ownerRoot, { recursive: true });

    // 2. Read before mutate. An unobservable document stops the run.
    const prior = readProvenance(topo.provenancePath, fsOps);
    if (prior.state === 'UNOBSERVABLE') {
        throw new Error('hook provenance is unobservable; hook not modified');
    }

    const draft = { recordedAt, intent: { participation, source } };
    const hooksDir = path.join(topo.worktreeTop, '.git', 'hooks');
    const hookPath = path.join(hooksDir, 'post-commit');
    let artifactContent = 'not-observed';
    let chmodEvidence = null;

    const preImage = digestFile(hookPath, fsOps);

    if (participation === 'participating') {
        const dir = observeHooksDir(hooksDir, fsOps);
        if (dir.outcome !== null) {
            draft.install = { outcome: dir.outcome, reason: dir.reason, targetPath: hookPath };
        } else {
            const w = writeManagedHook(hookPath, buildHookBody(), fsOps);

            if (w.phase === 'pre-write') {
                // Reading the existing hook failed, so no write was ever issued.
                // Phase-1 outcome: no chmod, no digest, no runnability — and the
                // event is still committed, because the intent that reached this
                // point must not be swallowed by the observation that failed.
                draft.install = { outcome: 'indeterminate', reason: 'pre-write-observation-failed',
                    targetPath: hookPath };
            } else {
                // "A write was attempted" is not "the artifact changed". A write
                // can throw before altering a byte, and reporting `mutated` there
                // would put an unproven fact in the failure message — the same
                // inversion the outcome rules forbid. The artifact dimension is
                // decided by comparing the file before and after, and stays
                // `indeterminate` when either digest could not be taken.
                artifactContent = compareArtifact(preImage, digestFile(hookPath, fsOps));
                let chmodThrew = false;
                try { fsOps.chmodSync(hookPath, '755'); } catch (_) { chmodThrew = true; }
                // Reported on its own axis: chmod can change the artifact without
                // changing a byte, so folding it into artifactContent would make
                // that field claim more than the digests it was derived from.
                chmodEvidence = { issued: true, threw: chmodThrew };

                const observed = observeInstalled(targetDir, w.reason);
                draft.install = {
                    outcome: observed.outcome,
                    reason: observed.reason,
                    targetPath: hookPath,
                    chmod: { attempted: true, threw: chmodThrew },
                };
                if (observed.outcome === 'realized') {
                    draft.install.expectedBodyDigest =
                        'sha256:' + crypto.createHash('sha256').update(buildHookBody()).digest('hex');
                    const r = observeRunnability({ targetDir, targetPath: hookPath, fsOps });
                    draft.runnability = r.runnability;
                    draft.diagnostic = r.diagnostic;
                }
            }
        }
    }

    // 3. The rename inside appendEvent is the commit point. Nothing fallible
    //    belonging to this invocation may follow it.
    let doc;
    try {
        doc = appendEvent(topo.provenancePath, prior, draft, fsOps);
    } catch (err) {
        const e = new Error(`artifact ${artifact}, provenance not committed: ${err.message}`);
        e.artifactContent = artifactContent;
        e.chmodEvidence = chmodEvidence;
        e.provenance = 'failed';
        throw e;
    }
    return {
        topology: topo.state, provenance: 'committed', artifact,
        event: doc.events[doc.events.length - 1],
    };
}
```

Note the two dimensions in the catch: an artifact that changed while provenance did not is reported as both facts, never compressed into one.

- [ ] **Step 4: Update the `hook install` command action**

`registerHookCommands`'s `install` action currently checks `.git/hooks` itself and sets `process.exitCode = 1`. Replace that check with the returned topology: `NO-GIT-ADMIN-TOPOLOGY` keeps today's non-zero exit for this explicit command, `SCOPE-UNRESOLVED` and `OWNER-UNRESOLVED` report and exit non-zero, and a provenance failure after a mutated artifact reports both dimensions and exits non-zero. Pass `{ source: 'hook-install-command' }`.

- [ ] **Step 5: Run the tests**

Run: `node .evo-lite/cli/test.js > out.txt 2>&1; grep -n "HP1[6-9]\|AssertionError\|tests passed" out.txt`
Expected: PASS, and the pre-existing hook tests in `integration.js` still pass.

- [ ] **Step 6: Mutation controls**

| # | Mutation | Must go red on |
|---|---|---|
Two of these need an assertion that does not exist yet. Write them first, in Task 6 Step 1, so each mutation has a guard to land on:

```js
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
        fsOps.writeFileSync = (p, data, enc) => {
            fs.writeFileSync(p, data, enc);
            if (String(p) === hookPath) {
                throw Object.assign(new Error('EIO after write'), { code: 'EIO' });
            }
        };
        const r = installPostCommitHook(repo, { fsOps });
        assert.strictEqual(r.event.install.outcome, 'realized',
            'a thrown write whose bytes landed must not be recorded as unrealized');
        assert.strictEqual(r.event.install.reason, 'created-managed-hook',
            'the reason describes what was found before the write, not what the exception suggests');

        // A failure BEFORE any write was issued is not an issued write: no chmod
        // call, and no chmod field. Otherwise a read failure would be recorded as
        // though the artifact had been touched.
        const repo2 = tmp('prewrite');
        execFileSync('git', ['-C', repo2, 'init', '-q'], { stdio: 'ignore' });
        fs.writeFileSync(path.join(repo2, '.git', 'hooks', 'post-commit'), '#!/bin/sh\n');
        let chmodCalls = 0;
        const preFail = Object.create(fs);
        preFail.readFileSync = (p, enc) => {
            if (String(p).endsWith('post-commit')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
            return fs.readFileSync(p, enc);
        };
        preFail.chmodSync = (...a) => { chmodCalls += 1; return fs.chmodSync(...a); };
        const r2 = installPostCommitHook(repo2, { fsOps: preFail });
        assert.strictEqual(r2.event.install.reason, 'pre-write-observation-failed');
        assert.strictEqual(r2.event.install.outcome, 'indeterminate');
        assert.strictEqual(r2.event.install.chmod, undefined,
            'a pre-write read failure records no chmod: the write was never issued');
        assert.strictEqual(chmodCalls, 0, 'and chmod is never called on that path');
        assert.strictEqual(r2.event.install.expectedBodyDigest, undefined);
        assert.strictEqual(r2.event.runnability, undefined);
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
        preFail.readFileSync = (p, enc) => {
            if (String(p) === hookPath) throw Object.assign(new Error('denied'), { code: 'EACCES' });
            return fs.readFileSync(p, enc);
        };
        preFail.chmodSync = (...a) => { chmodCalls += 1; return fs.chmodSync(...a); };

        installPostCommitHook(repo, { source: 'hook-install-command', fsOps: preFail });

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
            if (String(b) === provenancePath) committed = true;
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
        assert.strictEqual(readProvenance(provenancePath).state, 'VALID');
        assert.deepStrictEqual(after, [],
            `no fallible operation may follow the commit rename (saw ${after.join(', ')})`);
    }
```

| # | Mutation | Must go red on |
|---|---|---|
Three of these must be built as **neutral** mutations. Letting a branch "fall through" reaches code that dereferences `topo.ownerRoot`, which is `undefined` outside `IN-SCOPE`; the run then dies on a `TypeError` before the guarded assertion is evaluated, and a control that goes red somewhere earlier proves nothing about its target. Each is therefore expressed as the smallest change that makes the *guarded property* false and leaves everything before it true.

| # | Mutation | Must go red on |
|---|---|---|
| M14 | inside the `NESTED-TARGET` branch, add `fsOps.mkdirSync(path.join(topo.worktreeTop, '.git', 'evo-lite'), { recursive: true })` before returning | HP16 "must not create an owner directory in the enclosing worktree" |
| M14b | replace `legacyInstallPostCommitHook(targetDir)` with a bare `return` | HP16 "preserves legacy installer behaviour, it does not freeze it" |
| M14c | in the `SCOPE-UNRESOLVED` / `OWNER-UNRESOLVED` branch, replace the `throw` with `legacyInstallPostCommitHook(targetDir); return { topology: topo.state, provenance: 'not-attempted', artifactContent: 'not-observed', chmodEvidence: null, event: null };` — granting it the nested exception rather than crashing | HP16b "SCOPE-UNRESOLVED grants no legacy exception: the hook is byte-identical" |
| M14d | move the `participation === 'participating'` check after the legacy call in the `NESTED-TARGET` branch | HP20 "a nested --no-hooks still refuses the hook" |
| M15 | set `outcome = 'unrealized', reason = 'write-failed'` in the write's catch and skip `observeInstalled` | HP21 "a thrown write whose bytes landed must not be recorded as unrealized" |
| M15b | derive the reason after the write from `diffInstalledHook` instead of from what was found before it | HP21 "the reason describes what was found before the write" |
| M15c | chmod on the `pre-write` phase too | HP21 "and chmod is never called on that path" |
| M15d | in the `pre-write` branch, record `post-write-observation-failed` instead | HP25 "install.reason is pre-write-observation-failed" |
| M15e | in the `pre-write` branch, return before `appendEvent` instead of recording | HP25 "a failed install must not swallow the intent that superseded the opt-out" |
| M16 | after `appendEvent` returns, add `fsOps.writeFileSync(hookPath, buildHookBody())` — an artifact write following the commit, leaving every earlier step untouched. Simply hoisting `appendEvent` above the write instead would hand the validator a draft with no `install`, so the commit would be rejected and the run would die before HP22's order assertion ran | HP22 "the provenance commit is the last write of the invocation" |
| M16d | replace `compareArtifact(preImage, digestFile(...))` with the literal `'modified'` | HP24 "the artifact dimension reports unchanged when nothing changed" |
| M16b | add a `fsOps.statSync(hookPath)` immediately after `appendEvent` returns | HP23 "no fallible operation may follow the commit rename" |

- [ ] **Step 7: Commit**

```bash
git add templates/cli/hooks.js .evo-lite/cli/hooks.js templates/cli/test/hook-provenance.js .evo-lite/cli/test/hook-provenance.js
git commit -m "feat(provenance): gate, observe and record the install as one transaction"
```

---

### Task 7: CLI surface — `--no-hooks`

Satisfies ac11.

**Files:**
- Modify: `index.js` — add the option, pass the intent, keep `--no-git` narrow
- Modify: `templates/cli/test/hook-provenance.js` + mirror

**Interfaces:**
- Consumes: `installPostCommitHook(targetDir, { participation, source })` from Task 6.

- [ ] **Step 1: Write the failing test**

```js
    console.log('HP20. CLI: --no-git does not suppress hook participation ...');
    {
        const { execFileSync } = require('child_process');
        const { readProvenance } = require('../hook-provenance/store');
        const WORKSPACE_ROOT = path.join(__dirname, '..', '..', '..');

        // An EXISTING repository scaffolded with --no-git: git init is skipped,
        // hook participation is not.
        const repo = tmp('nogit');
        execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
        execFileSync(process.execPath, [path.join(WORKSPACE_ROOT, 'index.js'), repo,
            '--no-git', '--no-initial-commit'], { stdio: 'ignore' });
        const withGitFlag = readProvenance(path.join(repo, '.git', 'evo-lite', 'hook-provenance.json'));
        assert.strictEqual(withGitFlag.state, 'VALID');
        assert.strictEqual(withGitFlag.doc.current.participation, 'participating',
            '--no-git governs repository initialisation only, never hook participation');

        const optOut = tmp('nohooks');
        execFileSync('git', ['-C', optOut, 'init', '-q'], { stdio: 'ignore' });
        execFileSync(process.execPath, [path.join(WORKSPACE_ROOT, 'index.js'), optOut,
            '--no-hooks', '--no-initial-commit'], { stdio: 'ignore' });
        const opted = readProvenance(path.join(optOut, '.git', 'evo-lite', 'hook-provenance.json'));
        assert.strictEqual(opted.doc.current.participation, 'non-participating');
        assert.strictEqual(opted.doc.events[0].intent.source, 'scaffold-no-hooks');

        // The combination that makes two otherwise-correct rules collide. Recording
        // the opt-out requires an in-scope owner; --no-git forbids creating one. The
        // opt-out is honoured for the run and leaves no record — and above all, no
        // repository is manufactured in order to store it, which would run DD#1
        // backwards and let a hook flag create a Git repo.
        const bare = tmp('nogit-nohooks');
        execFileSync(process.execPath, [path.join(WORKSPACE_ROOT, 'index.js'), bare,
            '--no-git', '--no-hooks', '--no-initial-commit'], { stdio: 'ignore' });
        assert.strictEqual(fs.existsSync(path.join(bare, '.git')), false,
            'no .git may be created in order to record an opt-out');
        assert.strictEqual(fs.existsSync(path.join(bare, '.evo-lite', 'hook-provenance.json')), false,
            'and no provenance document appears anywhere in the working tree');

        // NESTED-TARGET + --no-hooks writes nothing into the enclosing worktree.
        const outer = tmp('nested-nohooks');
        execFileSync('git', ['-C', outer, 'init', '-q'], { stdio: 'ignore' });
        const inner = path.join(outer, 'inner');
        fs.mkdirSync(inner);
        execFileSync(process.execPath, [path.join(WORKSPACE_ROOT, 'index.js'), inner,
            '--no-git', '--no-hooks', '--no-initial-commit'], { stdio: 'ignore' });
        assert.strictEqual(fs.existsSync(path.join(outer, '.git', 'evo-lite')), false,
            'a nested opt-out must not write into the enclosing worktree');

        // Nesting costs the durable RECORD of the opt-out, never the opt-out
        // itself. With the hooks directory present, the legacy installer would
        // otherwise write — so this is where a topology fact could overrule an
        // explicit instruction, and must not.
        const inner2 = path.join(outer, 'inner2');
        fs.mkdirSync(path.join(inner2, '.git', 'hooks'), { recursive: true });
        execFileSync(process.execPath, [path.join(WORKSPACE_ROOT, 'index.js'), inner2,
            '--no-git', '--no-hooks', '--no-initial-commit'], { stdio: 'ignore' });
        assert.strictEqual(fs.existsSync(path.join(inner2, '.git', 'hooks', 'post-commit')), false,
            'a nested --no-hooks still refuses the hook; only the record is lost');
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `node .evo-lite/cli/test.js governance > out.txt 2>&1; grep -n "HP20\|AssertionError" out.txt`
Expected: FAIL — `--no-hooks` is not a known option.

- [ ] **Step 3: Add the option**

Beside `index.js:95`:

```js
        .option('--no-hooks', 'Skip Git hook installation and record an explicit opt-out')
```

At the call site (`index.js:489`), replace the unconditional call:

```js
    const hookResult = installPostCommitHook(targetDir, options.hooks === false
        ? { participation: 'non-participating', source: 'scaffold-no-hooks' }
        : { participation: 'participating', source: 'scaffold-default' });
```

`--no-git` keeps its narrow meaning: it is not consulted here, because it was never the authority for hook participation.

- [ ] **Step 4: Run the tests**

Run: `node .evo-lite/cli/test.js > out.txt 2>&1; grep -n "HP20\|tests passed\|AssertionError" out.txt`
Expected: PASS.

- [ ] **Step 5: Mutation control**

| # | Mutation | Must go red on |
|---|---|---|
| M17 | make `options.git === false` also select `non-participating` | HP20 "`--no-git` governs repository initialisation only" |
| M17b | run `git init` when `--no-hooks` finds no Git administrative container | HP20 "no .git may be created in order to record an opt-out" |

- [ ] **Step 6: Commit**

```bash
git add index.js templates/cli/test/hook-provenance.js .evo-lite/cli/test/hook-provenance.js
git commit -m "feat(cli): --no-hooks is the authority for explicit non-participation"
```

---

### Task 8: Mirror integrity, full suite, and AC traceability

**Files:**
- Create: `docs/validation/hook-install-provenance-ac-matrix.md`
- Verify: every file under `templates/cli/hook-provenance/` and `templates/cli/test/hook-provenance.js` against its mirror

- [ ] **Step 1: Prove the mirrors are byte-identical**

```bash
for f in $(cd templates/cli && find hook-provenance test/hook-provenance.js -type f); do
  a=$(sha256sum "templates/cli/$f" | cut -d' ' -f1)
  b=$(sha256sum ".evo-lite/cli/$f" | cut -d' ' -f1)
  [ "$a" = "$b" ] && echo "OK   $f" || echo "DRIFT $f"
done
```

Expected: every line `OK`. Also re-check `hooks.js`, `test/governance.js`.

- [ ] **Step 2: Run the full suite in the foreground**

Run: `node .evo-lite/cli/test.js > full.txt 2>&1; echo "exit=$?"; tail -20 full.txt`
Expected: exit 0, and the passing count is at or above the baseline recorded before Task 1.

- [ ] **Step 3: Write the AC traceability matrix**

Create `docs/validation/hook-install-provenance-ac-matrix.md` with one row per acceptance criterion **ac1–ac16** — sixteen, including the `pre-write-observation-failed` controller the amended design added as ac16: the criterion, the test names that exercise it, and the mutation IDs that proved those tests load-bearing. Where an AC is only partly covered, say so explicitly rather than claiming full coverage — an honest gap is a finding for the reviewer, a false green is not.

- [ ] **Step 4: Record the mutation results**

In the same document, one table with **every mutation ID declared by Tasks 1–7** — not a hardcoded range, since the set grew during review and a literal `M1–M17` would silently omit the later ones. Collect the IDs by grepping the plan's mutation tables and assert the count matches; **expected count = 35**. A missing row fails the step rather than relying on someone counting by hand.

Each row records `exit`, `guardHit` (did the *intended* assertion fail, not merely some assertion), the failing assertion text, and the restoration proof (sha256 of the source before mutating and after restoring, and mirror equality). Any row with `guardHit = false` is redesigned and re-run; it must not be counted as effective. Where a control cannot be falsified on this host — as with anything depending on `sh` and `bash` being different binaries, which they are not under msys — record it as *not falsifiable here* and name the CI leg that does falsify it. Never count it as effective.

- [ ] **Step 5: Commit**

```bash
git add docs/validation/hook-install-provenance-ac-matrix.md
git commit -m "docs(validation): AC traceability and mutation evidence for hook provenance"
```

---

## Design gap found and closed during planning

Planning found that the original freeze `0c22702` had no truthful way to record an
observation that fails after the topology gates and before any write is issued —
the concrete instance being an unreadable existing `post-commit`. The hooks
directory is fine, no write was issued, and `post-write-observation-failed` would
have additionally asserted a phase the run never reached.

It was reported rather than patched, and the design authority closed it in
`a8c8986`: `pre-write-observation-failed` joins the `indeterminate` vocabulary, the
whole mapping is restated by phase, and `chmod` is present if and only if the write
was **issued**. The same pass scoped `write-failed` to the write phase rather than
to the exception, so a write that returns success whose result is then found not to
be the expected body is named rather than left between definitions. This plan
implements the amended contract; nothing here remains blocked on a ruling.

## Task ordering

```
Tasks 1–5   design-independent pure modules; executable in order once the plan is authorized
Task 6      depends on Tasks 1–5
Task 7      contract is independent, but it CONSUMES Task 6's installPostCommitHook
            signature — do not start it earlier, or index.js begins depending on a
            producer interface that does not exist yet
Task 8      depends on everything
```

## Out of scope for this plan

- `[0ce0]` health policy — nothing here assigns HEALTHY / DEGRADED / FAIL.
- `[hook-runtime-runnability]` — the shebang-inheritance and `core.hooksPath` installer gaps. This plan **observes and records** both; it repairs neither. The debt is not yet registered and must be registered separately before it can be worked.
- `dashboard-data.js:15` `hasManagedPostCommitHook()` — the second weaker authority. Untouched.
- Refusing to install on a nested target. `NESTED-TARGET` leaves legacy installer behaviour unchanged; changing it would be a behaviour change requiring its own ruling.
