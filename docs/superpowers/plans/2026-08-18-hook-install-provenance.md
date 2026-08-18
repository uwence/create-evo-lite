# Hook Install Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record, as durable local fact, whether this workspace declared a hook-installation obligation, what one installation attempt actually did, and whether the resulting artifact is statically reachable by Git — without repairing anything.

**Architecture:** A pure core plus one transactional shell. Five new modules under `templates/cli/hook-provenance/` hold the contract: a path-identity primitive, the document schema and its shared validator, the topology classifier, the observation layer, and the store. `templates/cli/hooks.js` and `index.js` only wire them together. Every verdict-producing rule lives in a pure function so it can be tested without a repository, and every rule that touches Git asks Git rather than re-deriving.

**Tech Stack:** Node.js (CommonJS, no dependencies beyond core `fs` / `path` / `crypto` / `child_process`), `node:assert`, the existing `templates/cli/test/harness.js` fixtures, `node .evo-lite/cli/test.js` as the suite.

**Design authority:** `docs/superpowers/specs/2026-08-18-hook-install-provenance-design.md` at frozen design SHA `0c22702413ac5ac39e871f2abb7c911ec86074b6` (branch `spec/hook-install-provenance`). That document is the contract. If implementation appears to require different behaviour, that is a design change and must be escalated — never resolved as implementation discretion.

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
    indeterminate: ['hooks-dir-unobservable', 'post-write-observation-failed'],
};
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

        const prev = process.cwd();
        process.chdir(outer);
        try {
            const r = classifyTopology(inner);
            assert.strictEqual(r.state, 'IN-SCOPE');
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
    try {
        const stdout = execFileSync('git', ['-C', targetDir, ...args],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { status: 0, stdout: stdout.trim() };
    } catch (err) {
        // Discriminate on `status`, NOT on `code`: execFileSync sets `status` to
        // the exit code when the process RAN and failed (git says "not a git
        // repository" with 128), and leaves it null when the process could not be
        // spawned at all. `code` is set in both cases on some Node versions, so
        // keying off it would misread a positive not-a-repository answer as an
        // unavailable git — collapsing NO-GIT-ADMIN-TOPOLOGY into SCOPE-UNRESOLVED.
        if (err && typeof err.status === 'number') return { status: err.status, stdout: '' };
        throw err;                                // git absent / cannot spawn
    }
}

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
        // git ran and positively reported this is not a repository (exit 128).
        return { state: 'NO-GIT-ADMIN-TOPOLOGY' };
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
        return { state: 'OWNER-UNRESOLVED', detail: 'owner query failed' };
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
| M6 | drop `'-C', targetDir` from `defaultGitQuery` | HP8 "must be the TARGET git-dir" |
| M7 | return `SCOPE-UNRESOLVED` on `top.status !== 0` | HP7 "must not be swallowed into SCOPE-UNRESOLVED" |

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
        const r = observeExecutable(hook);
        assert.ok(['satisfied', 'not-satisfied', 'indeterminate'].includes(r.verdict));
        if (r.verdict === 'indeterminate') {
            assert.strictEqual(r.reason, 'no-qualified-predicate');
        }
        const src = fs.readFileSync(
            path.join(__dirname, '..', 'hook-provenance', 'observe.js'), 'utf8');
        assert.ok(!/X_OK/.test(src),
            'accessSync X_OK has no discriminating power and must appear nowhere');
        assert.ok(!/process\.platform/.test(src),
            'no verdict may key off the platform constant');
    }

    console.log('HP11. observation: interpreter is aligned, not hardcoded to sh ...');
    {
        const { observeInterpreter } = require('../hook-provenance/observe');
        const root = tmp('interp');
        const shHook = path.join(root, 'sh'); fs.writeFileSync(shHook, '#!/bin/sh\nexit 0\n');
        assert.strictEqual(observeInterpreter(shHook).verdict, 'satisfied');

        const bashHook = path.join(root, 'bash');
        fs.writeFileSync(bashHook, '#!/bin/bash\nshopt -s nullglob\nexit 0\n');
        assert.notStrictEqual(observeInterpreter(bashHook).verdict, 'not-satisfied',
            'bash-legal syntax under a bash shebang must not be reported not-satisfied');

        const py = path.join(root, 'py'); fs.writeFileSync(py, '#!/usr/bin/env python\nprint(1)\n');
        assert.deepStrictEqual(observeInterpreter(py),
            { verdict: 'not-satisfied', reason: 'incompatible-interpreter', shebang: '#!/usr/bin/env python' });

        const none = path.join(root, 'none'); fs.writeFileSync(none, 'echo hi\n');
        assert.strictEqual(observeInterpreter(none).verdict, 'indeterminate');
        assert.strictEqual(observeInterpreter(none).reason, 'missing-shebang');
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
    const words = first.slice(2).trim().split(/\s+/).filter(Boolean);
    const binary = path.basename(words[0] === '/usr/bin/env' && words[1] ? words[1] : words[0] || '');
    if (!binary) return { verdict: 'indeterminate', reason: 'ambiguous-interpreter', shebang: first };
    if (!SH_FAMILY.includes(binary)) {
        // A byte-correct managed block under a python shebang is still inert.
        return { verdict: 'not-satisfied', reason: 'incompatible-interpreter', shebang: first };
    }
    // Interpreter-ALIGNED syntax check: a bash hook is checked by bash, so
    // bash-legal syntax is not reported as a defect.
    try {
        execFileSync(binary, ['-n', hookPath], { stdio: ['ignore', 'ignore', 'pipe'] });
        return { verdict: 'satisfied', reason: null, shebang: first };
    } catch (err) {
        if (err && err.code) return { verdict: 'indeterminate', reason: 'no-safe-parser', shebang: first };
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
| M10 | run `sh -n` regardless of the shebang | HP11 "bash-legal syntax … must not be reported not-satisfied" |

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
            install: { outcome: 'unrealized', reason: 'hooks-dir-missing', targetPath: '/x/post-commit',
                chmod: { attempted: false, threw: false } },
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
  `{ topology, provenance: 'committed' | 'not-attempted' | 'failed', artifact: 'mutated' | 'unchanged', event }`.
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
        assert.strictEqual(r.artifact, 'mutated');

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
        assert.strictEqual(r.artifact, 'unchanged');
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

function writeManagedHook(hookPath, hookBody, fsOps) {
    let existing = null;
    try { existing = fsOps.readFileSync(hookPath, 'utf8'); }
    catch (err) { if (!err || err.code !== 'ENOENT') throw err; }

    if (existing === null) {
        fsOps.writeFileSync(hookPath, '#!/bin/sh\n' + hookBody + '\n');
        return 'created-managed-hook';
    }
    let content = existing;
    let reason;
    if (content.includes(SENTINEL_BEGIN)) {
        content = content.replace(new RegExp(`${SENTINEL_BEGIN}[\\s\\S]*?${SENTINEL_END}`), hookBody);
        reason = 'updated-managed-block';
    } else {
        content = content.trimEnd() + '\n\n' + hookBody + '\n';
        reason = 'appended-managed-block';
    }
    fsOps.writeFileSync(hookPath, content);
    return reason;
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

function installPostCommitHook(targetDir, options = {}) {
    const participation = options.participation || 'participating';
    const source = options.source || 'scaffold-default';
    const recordedAt = new Date().toISOString();
    const fsOps = options.fsOps || fs;

    // 1. Workspace scope, then owner. Both before any mutation.
    const topo = classifyTopology(targetDir, options.deps);
    if (topo.state === 'NESTED-TARGET') {
        // The sole deliberate out-of-v1-provenance exception: legacy installer
        // behaviour is left as it was, and this run claims nothing.
        return { topology: topo.state, provenance: 'not-attempted', artifact: 'unchanged', event: null };
    }
    if (topo.state === 'NO-GIT-ADMIN-TOPOLOGY') {
        return { topology: topo.state, provenance: 'not-attempted', artifact: 'unchanged', event: null };
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
    let artifact = 'unchanged';

    if (participation === 'participating') {
        const dir = observeHooksDir(hooksDir, fsOps);
        if (dir.outcome !== null) {
            draft.install = { outcome: dir.outcome, reason: dir.reason, targetPath: hookPath };
        } else {
            let attempted = null;
            let threw = false;
            try { attempted = writeManagedHook(hookPath, buildHookBody(), fsOps); }
            catch (_) { threw = true; }
            artifact = 'mutated';

            let chmodThrew = false;
            try { fsOps.chmodSync(hookPath, '755'); } catch (_) { chmodThrew = true; }

            const observed = observeInstalled(targetDir, attempted);
            draft.install = {
                outcome: observed.outcome,
                reason: threw && observed.outcome === 'realized' ? attempted || 'updated-managed-block' : observed.reason,
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

    // 3. The rename inside appendEvent is the commit point. Nothing fallible
    //    belonging to this invocation may follow it.
    let doc;
    try {
        doc = appendEvent(topo.provenancePath, prior, draft, fsOps);
    } catch (err) {
        const e = new Error(`artifact ${artifact}, provenance not committed: ${err.message}`);
        e.artifact = artifact;
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
        const fsOps = Object.create(fs);
        fsOps.writeFileSync = (p, data, enc) => {
            fs.writeFileSync(p, data, enc);
            throw Object.assign(new Error('EIO after write'), { code: 'EIO' });
        };
        const r = installPostCommitHook(repo, { fsOps });
        assert.strictEqual(r.event.install.outcome, 'realized',
            'a thrown write whose bytes landed must not be recorded as unrealized');
        assert.notStrictEqual(r.event.install.reason, 'write-failed');
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
```

| # | Mutation | Must go red on |
|---|---|---|
| M14 | let `NESTED-TARGET` fall through to owner resolution | HP16 "must not create an owner directory" |
| M15 | set `outcome = 'unrealized', reason = 'write-failed'` in the write's catch and skip `observeInstalled` | HP21 "a thrown write whose bytes landed must not be recorded as unrealized" |
| M16 | move the `appendEvent` call above the artifact write | HP22 "the provenance commit is the last write of the invocation" |

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

Create `docs/validation/hook-install-provenance-ac-matrix.md` with one row per acceptance criterion ac1–ac15: the criterion, the test names that exercise it, and the mutation IDs that proved those tests load-bearing. Where an AC is only partly covered, say so explicitly rather than claiming full coverage — an honest gap is a finding for the reviewer, a false green is not.

- [ ] **Step 4: Record the mutation results**

In the same document, one table with every mutation M1–M17: `exit`, `guardHit` (did the intended assertion fail, not merely some assertion), the failing assertion text, and the restoration proof (sha256 of the source before mutating and after restoring, and mirror equality). Any row with `guardHit = false` is redesigned and re-run; it must not be counted as effective.

- [ ] **Step 5: Commit**

```bash
git add docs/validation/hook-install-provenance-ac-matrix.md
git commit -m "docs(validation): AC traceability and mutation evidence for hook provenance"
```

---

## Out of scope for this plan

- `[0ce0]` health policy — nothing here assigns HEALTHY / DEGRADED / FAIL.
- `[hook-runtime-runnability]` — the shebang-inheritance and `core.hooksPath` installer gaps. This plan **observes and records** both; it repairs neither. The debt is not yet registered and must be registered separately before it can be worked.
- `dashboard-data.js:15` `hasManagedPostCommitHook()` — the second weaker authority. Untouched.
- Refusing to install on a nested target. `NESTED-TARGET` leaves legacy installer behaviour unchanged; changing it would be a behaviour change requiring its own ruling.
