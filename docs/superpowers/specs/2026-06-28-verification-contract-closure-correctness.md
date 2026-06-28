---
id: spec:verification-contract-closure-correctness
status: draft
created: 2026-06-28
linkedPlan: plan:verification-contract-closure-correctness
---

# Verification Contract — Closure Correctness (PR-CC) Spec

## Goal

Fix six confirmed correctness/safety bugs the second external review raised about
the closure path. All six are real (verified against the code), none conflict with
the consciously-rejected full transaction directory, and none require the
philosophical "evidence-driven closure" redesign (that is deferred, see Non-Goals).

After this spec:

1. `verify-contract status --strict` exits non-zero on a NO-CONTRACT spec, matching
   `close --preview --strict` (today it fail-opens to exit 0 on an empty verdict set).
2. The single contract loader rejects a spec whose `id` is missing or not `spec:*`,
   and whose `linkedPlan` (when present) is not `plan:*` — so no path can write
   `evidence-undefined.json` or treat an identity-less spec as closeable.
3. `close --apply` propagates and prints the `tasks-incomplete` warning (today it
   only appears in `--preview`; a direct `--apply` closes silently).
4. `close --apply` sets the **plan** frontmatter `status: done`, not just the spec —
   so a standard `mem plan new` plan (born `status: draft`) doesn't stay `draft`
   with every box checked and the spec done.
5. The closure journal filename reuses the validated `evidenceSlug`, closing the
   path-traversal gap in `slugFor` (evidence is validated; the journal was not).
6. The success-journal write moves inside the rollback `try` so a failure there
   (disk full, permissions) rolls back the mutation instead of leaving it applied
   with a stale `applying` journal.

## Why these six (and not the rest of the review)

The review's first batch ("Closure Correctness") plus two of its second batch
("safe journal slug", "final journal write in rollback") are unambiguous bug fixes
with a single correct answer each. They are cheap and independently testable. The
remaining review items are **deferred by decision**, not oversight — see Non-Goals.

## Design

### 1. NO-CONTRACT strict parity (engine.js + close — already correct on close side)

`statusSpec` currently returns `[]` for a NO-CONTRACT spec, so the CLI's
`verdicts.some(v => v.verdict !== 'PASS')` is `false` → exit 0. Make `statusSpec`
emit a single synthetic verdict for the no-contract case:

```js
if (contract.noContract) {
    return [{ criterionId: '<contract>', verdict: 'NO-CONTRACT',
        detail: 'no machine-readable acceptance criteria' }];
}
```

This sits right after the `!contract.ok` INVALID branch (engine.js:61-63). The CLI
strict check is unchanged — a `NO-CONTRACT` verdict is `!== 'PASS'`, so
`--strict` now exits non-zero, consistent with `close --preview --strict`. The
human/JSON status output also now shows the NO-CONTRACT row instead of an empty
report. `previewClose` keeps its own dedicated `noContract` branch (close-preview.js:76)
and is unaffected (it calls `statusFn` only on the contract-ok path).

### 2. Spec/plan identity validation in the single loader (validate-contract.js)

`loadValidatedContract` is the one fail-closed entry every path uses. Add identity
validation there, after parsing frontmatter:

```js
const SPEC_ID_RE = /^spec:[a-z0-9][a-z0-9._-]*$/;
const PLAN_ID_RE = /^plan:[a-z0-9][a-z0-9._-]*$/;
// ...
if (typeof specId !== 'string' || !SPEC_ID_RE.test(specId)) {
    return { ok: false, noContract: false, specId, criteria: [],
        findings: [finding('id', `spec frontmatter id must match spec:<slug> (got ${JSON.stringify(specId)})`)] };
}
const linkedPlan = fm.linkedPlan;
if (linkedPlan != null && !PLAN_ID_RE.test(String(linkedPlan))) {
    return { ok: false, noContract: false, specId, criteria: [],
        findings: [finding('linkedPlan', `linkedPlan must match plan:<slug> (got ${JSON.stringify(linkedPlan)})`)] };
}
```

Identity is checked **before** the NO-CONTRACT opt-out: a spec with no criteria
block is still legal, but it must have a valid id to be one. This makes a
missing/garbage id a fail-closed INVALID across run/status/preview/apply/attest
uniformly. `runSpec`'s now-redundant `if (!specId)` guard (engine.js:23) is removed
(the loader covers it; `runSpec` already calls `loadValidatedContract`). `linkedPlan`
is `expose`d on the returned object for any caller that wants it.

### 3. Apply propagates + prints warnings (close-apply.js + close-commands.js)

`applyClose` already holds `preview` (close-apply.js:97). Thread its warnings out:

```js
return { applied: true, readiness: 'READY', actions, journalPath, staged,
    warnings: preview.warnings || [] };
```

`printApply` prints them after the action list, same `⚠` formatting as `printPreview`:

```js
for (const w of (r.warnings || [])) console.log(`  ⚠ ${w.message}`);
```

Warnings remain advisory — they never block `--apply`. PR4-A stands: criteria are
the only hard gate. This only makes a silent `--apply` no longer silent.

### 4. Plan frontmatter status: done (close-apply.js)

When `planAbs` is being mutated, also set its frontmatter `status: done` via the
existing `setStatusDone` helper, in the same write:

```js
if (planAbs) {
    const txt = fs.readFileSync(planAbs, 'utf8');
    const flipped = txt.replace(/- \[ \] /g, '- [x] ');
    fs.writeFileSync(planAbs, setStatusDone(flipped));
    actions.push(`flip ${plan.uncheckedBoxes} checkbox(es) + set plan status: done in ${plan.planPath}`);
}
```

`setStatusDone` is idempotent (rewrites the `status:` key if present, inserts if
absent), so a plan already `done` or with no `status` key is handled. The plan was
already a journaled rollback target, so a later failure still restores it.

Note: the global `- [ ] → - [x]` regex is **unchanged** here (P1-5, the
parser-driven replacement, is deferred — see Non-Goals). This task only adds the
frontmatter status flip, which is the standard-plan correctness bug.

### 5. Safe journal slug (close-apply.js)

`slugFor` is replaced with a call to the already-validated `evidenceSlug`
(evidence-store.js), which rejects any slug containing a path separator:

```js
const { evidenceSlug } = require('./evidence-store');
// journalPath:
const journalPath = path.join(root, '.evo-lite', 'verification',
    `close-journal-${evidenceSlug(fm.id)}.json`);
```

`fm.id` is guaranteed valid `spec:*` by this point because `applyClose` calls
`previewClose` → `loadValidatedContract`, which (task 2) fail-closes a bad id to
BLOCKED before any journal is written. The old `slugFor` basename fallback is
dropped (a valid id is now mandatory). `slugFor` stays exported but delegates to
`evidenceSlug` so existing importers/tests keep working.

### 6. Final journal write inside the transaction (close-apply.js)

Move the success-journal write (close-apply.js:154) from after the `try` to the end
of the `try` block, before the success return — so a write failure there hits the
same catch, rolls back the mutation + staging, and records `aborted`. The catch
already restores every journaled target.

## Acceptance Criteria

```json
{
  "criteria": [
    { "id": "ac-strict-no-contract",
      "description": "verify-contract status on a NO-CONTRACT spec returns a single NO-CONTRACT verdict (not an empty array) so --strict exits non-zero, matching close --preview --strict.",
      "dependsOn": ["templates/cli/verification/engine.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-identity-validation",
      "description": "loadValidatedContract fail-closes (ok:false) when the spec id is missing or not spec:* or when linkedPlan is present but not plan:*, before the NO-CONTRACT opt-out.",
      "dependsOn": ["templates/cli/verification/validate-contract.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-apply-warnings",
      "description": "applyClose returns warnings from the preview and printApply prints them; a tasks-incomplete warning surfaces on a direct --apply without blocking it.",
      "dependsOn": ["templates/cli/verification/close-apply.js", "templates/cli/verification/close-commands.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-plan-status-done",
      "description": "applyClose sets the linked plan frontmatter status: done (not just the spec) when it flips the plan checkboxes.",
      "dependsOn": ["templates/cli/verification/close-apply.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-safe-journal-slug",
      "description": "The closure journal filename uses evidenceSlug, so a spec id containing a path separator is rejected before any journal write (no path traversal).",
      "dependsOn": ["templates/cli/verification/close-apply.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-journal-write-in-txn",
      "description": "A failure of the success-journal write rolls back the mutation and records aborted (the write is inside the rollback try, not after it).",
      "dependsOn": ["templates/cli/verification/close-apply.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } }
  ]
}
```

## Non-Goals

- **P1-5 parser-driven checkbox flipping** (replace the global `- [ ] → - [x]`
  regex with Planning-Parser-located task steps). This is the "criteria-gated vs
  task-evidence-driven closure" model change — a separate debate, deferred.
- **Evidence durability** (split the monolithic `test.js`, per-criterion verifiers /
  `assertionId`, atomic evidence write). Real, but a separate scope; the STALE
  cascade is a known consequence of the whole-suite verifier choice.
- **Full crash-safe transaction dir** (on-disk priorBytes journal, recover/abort) —
  rejected in the prior closure-hardening spec; clean-tree + git remain the backstop.
- **Command-verifier trust boundary** (P1-8) and **trusted manual attestation
  identity** — already tracked separately.

## Testing notes

- Strict NO-CONTRACT: call `statusSpec` on a spec with a valid id but no criteria
  block → assert exactly one verdict, `verdict === 'NO-CONTRACT'`. (CLI strict is a
  thin wrapper already covered by the `!== 'PASS'` logic.)
- Identity: `loadValidatedContract` on `{ id: undefined }`, `{ id: 'nope' }`,
  `{ id: 'spec:ok', linkedPlan: 'bad' }` → each `ok === false` with an id/linkedPlan
  finding; `{ id: 'spec:ok' }` with no criteria block → `ok === true, noContract`.
- Apply warnings: `applyClose` with a `previewFn` returning READY + a
  tasks-incomplete warning → assert `result.applied === true` AND
  `result.warnings` contains the warning. (printApply covered by asserting the
  function body references `r.warnings`.)
- Plan status: `applyClose` on a fixture plan with `status: draft` and unchecked
  boxes → after apply, the plan text matches `/^status: done$/m` in its frontmatter.
- Safe slug: `applyClose` with a spec whose `fm.id` is `spec:../../evil` → preview
  fail-closes (BLOCKED, no journal written); assert no file is created outside
  `.evo-lite/verification/`. And a unit assert that `evidenceSlug('spec:a/b')` throws.
- Journal-in-txn: inject a `writeJournalFn`/`exec` such that the **success** journal
  write throws → assert result is `aborted`, files restored, journal status `aborted`.
