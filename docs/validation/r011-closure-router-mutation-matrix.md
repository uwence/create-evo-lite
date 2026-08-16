# R011 closure router — consolidated mutation matrix

Task 5 of the `r011-closure-router` plan. Twenty-one mutations (`M0`–`M20`) run
across Tasks 1–5 of this change, each breaking one invariant guard and recording
whether the intended assertion goes red. A red that lands anywhere else — an
unrelated block, a crash, a non-zero exit for an unrelated reason — proves nothing
about the named guard and would be recorded as `INEFFECTIVE — guard is
decorative`. None of the 21 rows below are ineffective.

This document **assembles** the record from the four prior task reports plus
this task's own two mutations. It does not re-run any historical mutation to
fill a gap — every row's evidence traces to the report that produced it, cited
in the row. All 21 rows have complete evidence; none are incomplete.

## Baseline

| | |
|---|---|
| BASE for this task | `ec415dcaf9554a6371ceee5247ab3d640df9d475` on `feat/r011-closure-router` |
| Command | `node .evo-lite/cli/test.js` (no scope), run ALONE, foreground, output redirected to a file |
| Green before Task 5 | exit `0`, `444` blocks (measured directly at the start of this task) |
| Green after Task 5 | exit `0`, `445` blocks (measured directly; `T-r011-real-repo` is the one new block) |
| Mutation-only runs (M15, M16) | `node .evo-lite/cli/test.js governance`, foreground, output redirected to a file |

## Summary

| # | task | mutation | exact failing assertion (verbatim, trimmed to the message) | verdict |
|---|---|---|---|---|
| M0 | 1 | `readinessOf`'s final return hardcoded to `'READY'` (drops the `blockers.length ? 'BLOCKED' : 'READY'` ternary) | `non-PASS → BLOCKED` — lands in the **pre-existing** `T38`, not the new `T38a` | effective |
| M1 | 2 | map `'NO-CONTRACT'` → `'spec-closure-ready'` in `R011_TYPE_BY_READINESS` | `NO-CONTRACT maps to spec-closure-uncontracted` | effective |
| M7 | 2 | restore READY's `suggestedAction` to `Update status in ${spec.sourcePath} to: status: done` | `ready routes to the close transaction with the argument the CLI actually accepts: a PATH` — see qualification below | effective, landed one assertion earlier than predicted |
| M8 | 2 | revert `PLANNING_RULE_VERSIONS.R011` to `1` | `R011 ruleVersion must bump in the SAME commit as the semantics change — new claims published under the old version are what ruleVersion exists to prevent` | effective |
| M9 | 2 | change READY's action to `` mem close ${spec.id} --preview `` (id, not path) | `ready routes to the close transaction with the argument the CLI actually accepts: a PATH` — see qualification below | effective, landed one assertion earlier than predicted |
| M10 | 2 | drop the unevidenced clause from the uncontracted message | `the unevidenced task is named for the human` | effective |
| M17 | 2 | in `r011Unevidenced`, replace `e.evidence.hasPositiveEvidence === false` with a `gitRefs`/`linkedFilesTotal`/`linkedFilesExist` re-derivation | `a task with evidence is not listed as unevidenced` — see qualification below | effective against the forbidden implementation; separate controller probe carries the static guard |
| M18 | 2 | drop the `!t.readOnly` filter in `r011Unevidenced` | `a readOnly task is exempt from implementation evidence (R005, R008) — listing it as having no evidence of its own is a false prompt` | effective |
| M2 | 3 | set `dispositionable: true` on the unobservable branch | `a failure to observe is not a fact about the spec — it must not be dispositionable as accepted` | effective |
| M3 | 3 | delete the `observation.unavailable(...)` call on the unobservable branch | `the census degrades so sync writes no tombstone this round` | effective |
| M4 | 3 | delete the unobservable `findings.push({...})`, keep `continue` | `FORBIDDEN: dropping the finding — an absence in a COMPLETE census is read by sync as proof, and it tombstones the human decision terminally` | effective |
| M11 | 3 | route `r011Unevidenced`'s catch through `observation.unavailable` too | `unreadable presence evidence must NOT degrade the census — it is display context, not a fact input` | effective |
| M5 | 4 | remove `.sort()` from `blockerIds` in `gaps.js` | `a mere reordering by the verdict engine must NOT lapse a decision that nothing real invalidated` | effective |
| M6 | 4 | drop `blockers` from `factInputs` (healthy branch) | `FORBIDDEN: ac-1=FAIL and ac-3=STALE sharing one fingerprint — a decision taken about the first would be silently inherited by the second, which is the collapse the four types exist to prevent` | effective |
| M12 | 4 | drop `validationIdentity` from `factInputs` | `FORBIDDEN: validationIdentity not reaching factInputs — finding ids collapse every JSON failure to \`contract\`, so without it every malformed contract shares one fingerprint` | effective |
| M13 | 4 | in `validationIdentityOf`, replace `source` with `(c.findings \|\| []).map(f => f.message)` | `a validator or V8 rewording must NOT lapse a decision — CI runs three Node majors and the JSON parser message is engine prose with a character offset, not a contract` — see qualification below | effective, load carried by part (d) alone |
| M14 | 4 | drop `specId`/`linkedPlan` from `validationIdentityOf`'s input | `FORBIDDEN: two different rejected spec ids sharing one identity — they return before any block is parsed, so the rejected value is the only discriminator` | effective |
| M19 | 4 | drop `contractSource` from the criterion-validation return in `loadValidatedContract` | `FORBIDDEN: two different criterion-level failures sharing one identity — both report id ac-1 and verdict INVALID, so the block text is the only thing that tells them apart` | effective |
| M20 | 4 | truncate the digest with `.slice(0, 16)` after `digest('hex')` | `full SHA-256 with the repo prefix, like criterionDigest — a durable governance identity is not a UI short code` | effective |
| M15 | 5 (mine) | in `r011Unevidenced`, `return [];` unconditionally | `the unevidenced task is named for the human` — **NOT** `T-r011-real-repo`'s assertion; see below | effective against the property, masked for this task's own test |
| M16 | 5 (mine) | map `'NO-CONTRACT'` → `'spec-closure-not-ready'` in `R011_TYPE_BY_READINESS` | `NO-CONTRACT maps to spec-closure-uncontracted` — **NOT** `T-r011-real-repo`'s assertion; see below | effective against the property, masked for this task's own test |

Evidence sourcing: M0 from `task-1-report.md`; M1, M7, M8, M9, M10, M17, M18 from
`task-2-report.md`; M2, M3, M4, M11 from `task-3-report.md`; M5, M6, M12, M13,
M14, M19, M20 from `task-4-report.md`; M15, M16 measured directly in this task.
All four report files live in this plan's directory,
`.superpowers/sdd/2026-08-15-r011-closure-router/`. **21/21 rows have complete
evidence — none are incomplete.**

---

## Qualified rows — reproduced faithfully, not flattened

### M7 and M9 — landed one assertion earlier than predicted

Both mutations touch READY's `suggestedAction`. The brief predicted each would
redden a `FORBIDDEN: ...status: done` (M7) or `FORBIDDEN: mem close <spec-id>`
(M9) negative assertion. Both instead reddened the **positive** assertion that
precedes those negatives in the same `T-r011-router` block:

```js
assert.match(ready.suggestedAction, /mem close docs\/specs\/u\.md --preview/,
    'ready routes to the close transaction with the argument the CLI actually accepts: a PATH');
```

Any wrong string in `suggestedAction` — reverting to the old `status: done`
text (M7) or to an id-based `mem close spec:u --preview` (M9) — necessarily
fails this earlier positive match before the later negative assertions are
ever reached. This is not masking in the sense of "proves nothing": both
mutations still corrupt the same field the later assertions guard, and the
positive assertion is at least as strong a check on that field. But the row
reflects where the mutation ACTUALLY landed, not where the brief predicted,
per Task 2's report.

### M17 — reddened a semantic assertion, not the AC2 static guard; carried separately by a controller probe

M17 (replacing the published `hasPositiveEvidence` conclusion with a
`gitRefs`/`linkedFilesTotal`/`linkedFilesExist` re-derivation) reddened
`a task with evidence is not listed as unevidenced` — a **semantic** behavioral
assertion in `T-r011-router` — because the mutation changes behaviour (the
re-derivation evaluates `true` for every task once the evidence stub omits
those raw fields) and that semantic assertion sits earlier in the same test
block than the AC2 static source-grep assertion the mutation was predicted to
trip. The process throws at the earlier assertion, so the later static guard —
the loop that scans the `// --- R011 ---` section's source text for
`.gitRefs`, `.linkedFilesTotal`, etc. — is never reached in this run.

That the static guard bears load in its own right was proven **separately, by
a controller probe**. It is recorded in full — exact mutation, exact failing
assertion, exit code and restore hash — as **P2** in *Controller probes* at the
end of this document. That section, not a session report, is the durable
provenance for this claim.

Record M17 as **effective against the forbidden implementation** (the
re-derivation mutation), and record the neutral probe as the **separate**
evidence that the static AC2 guard itself bears load — the two are not the
same measurement and neither substitutes for the other.

**Standing lesson**, ruled by the project owner as a general check to apply
going forward, not scoped to M17 alone: a mutation that also breaks an
assertion earlier in file/execution order than its intended target cannot, by
itself, prove the later guard is non-decorative. The earlier assertion throwing
first only shows *a* guard held, not *which* one. Proving the later guard
specifically requires either reordering (not done here, to avoid fixture
massaging) or an isolated probe that reddens only the later guard, as done for
M17's static AC2 scan.

### M13 — load carried by part (d) alone

M13 replaces `validationIdentityOf`'s `source` field with
`(c.findings || []).map(f => f.message)`. It reddened
`T-contract-identity`'s part (d) — the Node-version-rewording invariance
check — as predicted. But parts (a), (b), and (c) of the same test do **not**
discriminate this mutation: their fixtures' `finding.message` values happen to
differ from each other for unrelated reasons (the malformed-JSON message
embeds the specific broken JSON text; the rejected-id/rejected-linkedPlan
messages embed the specific rejected value), so a message-based identity would
still, by coincidence, produce different identities for those fixtures and the
mutation would pass silently there.

Only part (d) is built to isolate the variable: two fixtures with the **same
authored cause** (same JSON, same criteria block) but **different diagnostic
message text** (simulating a Node/V8 version difference in the JSON parser's
error prose) must still produce the **same** identity. That is the one
assertion in the file that a message-based identity necessarily fails and a
source-based identity necessarily passes. Deleting part (d) as "redundant"
with (a)/(b)/(c) would silently make M13 decorative — it is the sole carrier
of this guard's load, not one of several redundant confirmations.

---

## M15 and M16 — this task's own mutations

Both target the new `T-r011-real-repo` block added in Step 1
(`templates/cli/test/governance.js`, inserted immediately after
`T-contract-identity` and before `T26b`). Both mutate
`templates/cli/planning/gaps.js`, mirrored to
`.evo-lite/cli/planning/gaps.js` before every run, never after. Restored by
copying the saved pre-mutation backup back over both mirrors — never
`git checkout --`.

Pre-mutation baseline sha256 for `gaps.js` (both mirrors, confirmed identical
before M15, after M15's restore, before M16, and after M16's restore):

```
46d54311a6ab8ba76e8c12f655be5a0ee234c655435b7320408e7ad3cf245a8e
```

This matches the value recorded as the post-Task-4 baseline in
`task-4-report.md`, confirming no drift entered `gaps.js` between Task 4's
commit and the start of Task 5's mutation work.

### M15 — `r011Unevidenced` returns `[]` unconditionally

**Mutation applied** (`templates/cli/planning/gaps.js`):

```js
function r011Unevidenced(planIR, plans, projectRoot, options) {
    return [];   // M15 mutation
    const evaluate = options.evidenceFn
        || ((task, root) => require('./progress').evaluateTask(task, root));
    // ...unreachable original body...
}
```

Run: `node .evo-lite/cli/test.js governance`, foreground, output redirected.
Result: exit `1`.

**Exact failing assertion (verbatim)**:

```
❌ Governance test failed: AssertionError [ERR_ASSERTION]: the unevidenced task is named for the human
    at runGovernanceTests (D:\Data\ProjectAgent\create-evo-lite\.evo-lite\cli\test\governance.js:3486:20)
...
  actual: 'Spec spec:u is [draft] and linked plan plan:u is checkbox-complete, but has no machine-readable acceptance contract — checkbox state is not closure evidence',
  expected: /task:u2/,
  operator: 'match',
```

This is `T-r011-router`'s pre-existing assertion at `governance.js:3486`, **not**
`T-r011-real-repo`'s `the unevidenced task must be named` assertion. `T-r011-router`
runs earlier in file order (it is the very first R011 test block, at line 3426;
`T-r011-real-repo` is the last, inserted just before `T26b`), and the harness
aborts at the first `AssertionError`.

**Masking answer — yes.** M15 also breaks an assertion that runs earlier than
its intended target. `T-r011-router` already asserts the same property this
task's brief predicted M15 would trip (`assert.match(unc.message, /task:u2/,
'the unevidenced task is named for the human')`, immediately followed by
`assert.ok(!/task:u1/.test(unc.message), 'a task with evidence is not listed
as unevidenced')`), against a synthetic fixture built specifically for that
purpose in Task 2. Because `r011Unevidenced` is a single shared function,
returning `[]` unconditionally breaks that earlier synthetic-fixture assertion
before the real-repo suite's own assertion is ever reached. **This row proves
the general "unevidenced task must be named" property is not decorative — it
does not independently prove `T-r011-real-repo`'s own assertion bears load in
isolation**, because that assertion never gets the chance to run under this
mutation. Per the standing lesson recorded under M17 above, this is reported
plainly rather than reclassified.

**Restore.** `gaps.js` copied back from the scratchpad backup to both mirrors.
sha256 confirmed on both: `46d54311a6ab8ba76e8c12f655be5a0ee234c655435b7320408e7ad3cf245a8e`
— matches the pre-mutation baseline exactly, and `diff` between the two mirrors
reported no output (byte-identical). Full suite re-confirmed green afterward
(see Baseline).

**Verdict: effective** (against the shared property `r011Unevidenced` protects),
**masked** with respect to `T-r011-real-repo`'s specific assertion.

### M16 — `'NO-CONTRACT'` maps to `'spec-closure-not-ready'`

**Mutation applied** (`templates/cli/planning/gaps.js`):

```js
const R011_TYPE_BY_READINESS = Object.freeze({
    'READY': 'spec-closure-ready',
    'BLOCKED': 'spec-closure-not-ready',
    'NO-CONTRACT': 'spec-closure-not-ready',   // was: 'spec-closure-uncontracted'
});
```

Run: `node .evo-lite/cli/test.js governance`, foreground, output redirected.
Result: exit `1`.

**Exact failing assertion (verbatim)**:

```
AssertionError [ERR_ASSERTION]: NO-CONTRACT maps to spec-closure-uncontracted
+ actual - expected

+ 'spec-closure-not-ready'
- 'spec-closure-uncontracted'
                ^

    at runGovernanceTests (D:\Data\ProjectAgent\create-evo-lite\.evo-lite\cli\test\governance.js:3479:20)
```

Again `T-r011-router`, not `T-r011-real-repo`. `T-r011-router` asserts
`assert.strictEqual(unc.type, 'spec-closure-uncontracted', 'NO-CONTRACT maps to
spec-closure-uncontracted')` at line 3479, seven lines before its own
unevidenced-clause checks and roughly 240 lines before `T-r011-real-repo`.

**Masking answer — yes**, for the same structural reason as M15:
`R011_TYPE_BY_READINESS` is one shared, module-level lookup table consumed by
every test that exercises `checkR011`, and `T-r011-router` is the first
consumer in file order. Mutating the table breaks its own type-mapping
assertion before `T-r011-real-repo`'s `no criteria block means no authoritative
verdict` assertion is ever reached — that assertion depends on
`f.type === 'spec-closure-uncontracted'` exactly as `T-r011-router`'s does, so
it cannot possibly survive to run once the earlier one has already thrown.
**This row proves the READY/BLOCKED/NO-CONTRACT → type mapping is not
decorative as a whole — it does not independently prove `T-r011-real-repo`'s
copy of that check bears load in isolation.**

**Restore.** `gaps.js` copied back from the scratchpad backup to both mirrors.
sha256 confirmed on both: `46d54311a6ab8ba76e8c12f655be5a0ee234c655435b7320408e7ad3cf245a8e`
— matches baseline, mirrors byte-identical (`diff` reported no output). Full
suite re-confirmed green afterward (see Baseline).

**Verdict: effective** (against the shared type-mapping table),
**masked** with respect to `T-r011-real-repo`'s specific assertion.

### Why this masking is expected, not a defect

`T-r011-real-repo`'s job (per the brief) is to prove the router's contract
holds **on the real repository's tracked specs**, built via
`scanPlanning(WORKSPACE_ROOT)` — not to independently re-prove properties
`T-r011-router` already proves against synthetic fixtures. The two target
specs it names (`spec:governance-observation-budget`,
`spec:planning-truth-controls`) are real, tracked, uncontracted specs; the
test's value is that it fails if the real repository's data ever stops
matching the router's contract (e.g. if someone adds a criteria block, or the
unevidenced tasks gain evidence), or if `checkR011`'s wiring to
`scanPlanning` breaks — not that it re-establishes the router's core
type-mapping and unevidenced-naming logic in isolation. That logic's isolated
proof is `T-r011-router`'s job, and M15/M16 correctly land there first. No
fixture was altered to force a different landing spot, per the brief's
prohibition on fixture massaging.

That reasoning explains why M15/M16 land where they do. It does **not** answer
whether `T-r011-real-repo` can fail at all on its own — and a block that cannot
fail is decorative however well its purpose reads. That question is settled
separately by **P1** in *Controller probes* below: it does fail on its own, on
its own assertion, while every synthetic block stays green.

---

## Controller probes — not part of M0–M20

M0–M20 are the twenty-one mutations frozen in the implementation plan. The
probes below are **not** members of that set and do not renumber it. They were
run by the controller after the fact, each to answer a question the planned
mutations could not, because a planned mutation broke an earlier assertion and
so never exercised the guard it was aimed at.

Each entry transcribes what was actually run and observed. Nothing here is
reconstructed from reasoning.

### P1 — real-repo default-readiness probe (settles `T-r011-real-repo`)

**Question.** M15 and M16 both redden `T-r011-router`'s earlier synthetic
assertions, so neither shows that `T-r011-real-repo` bears any load of its own.
Can that block fail at all?

**The seam that makes an isolated probe possible.** `checkR011` resolves its
readiness source as:

```js
const readinessFn = options.readinessFn
    || ((sp) => require('../verification/close-preview').readinessOf(sp, { root: projectRoot }));
```

`T-r011-real-repo` calls `gaps.checkR011(WORKSPACE_ROOT, ir, {}, null)` — it is
the **only** caller in the suite that passes no `readinessFn` and therefore the
only one that reaches the default. `T-r011-router`, `T-r011-unobservable` and
`T-r011-fingerprint` all inject their own.

**Mutation applied** (both mirrors), replacing only the default fallback:

```js
const readinessFn = options.readinessFn
    || ((sp) => ({ readiness: 'BLOCKED', blockers: [], contractStatus: 'valid', contractPresent: true }));
```

**Why it is neutral.** Every test that injects `readinessFn` never evaluates the
fallback expression, so their behaviour is bit-for-bit unchanged.

**Observed** — `node .evo-lite/cli/test.js governance`, exit **1**:

```
✅ T-r011-router passed
...
T-r011-real-repo. The two specs this defect was found on stop being told to close ...
❌ Governance test failed: AssertionError [ERR_ASSERTION]: spec:governance-observation-budget: no criteria block means no authoritative verdict
```

`T-r011-router` reached its own `✅` line — the probe passed through every
synthetic block untouched — and `T-r011-real-repo` failed on **its own**
assertion.

**Restore.** `templates/cli/planning/gaps.js` was copied aside before mutating
and copied back afterwards (never `git checkout --`). Template, live mirror and
backup all read
`46d54311a6ab8ba76e8c12f655be5a0ee234c655435b7320408e7ad3cf245a8e`, and the
full suite returned exit 0 at 445 blocks.

**Verdict: EFFECTIVE.** `T-r011-real-repo` carries independent integration
load: it fails when the real default readiness wiring is broken, even though
every synthetic block still passes.

### P2 — behaviour-neutral raw-material read (settles the AC2 static guard)

**Question.** M17 reddens a semantic assertion that runs before the AC2 static
source scan, so the scan itself is never executed under M17. Does that scan
bear load?

**Mutation applied** (both mirrors), inside `r011Unevidenced`'s filter callback:

```js
const _probe = e && e.evidence ? e.evidence.gitRefs : null;
```

**Why it is neutral.** The binding is declared and never read, so the callback's
return value — and therefore every finding, message and `factInputs` the suite
observes — is unchanged. Only the R011 section's *source text* changes.

**Observed** — `node .evo-lite/cli/test.js governance`, exit **1**:

```
❌ Governance test failed: AssertionError [ERR_ASSERTION]: FORBIDDEN: the R011 section reads .gitRefs — that is progress.js's raw material, and deciding from it here re-derives the evidence predicate AC2 forbids duplicating
```

**Restore.** Copied back from the pre-mutation copy; template, live mirror and
backup all read
`c81f123a6b8d4605e29b54e4ee4e873441bbf423880325f679b9e791ecb47e62`, and the
governance scope returned to green.

**Verdict: EFFECTIVE.** The AC2 source guard fails on a source-level
reintroduction of the forbidden read even when behaviour is identical, which is
precisely the property AC2 states.

*(P1 and P2 record different files at different points in this branch's
history, so their gaps.js hashes differ: `c81f123` is the Task 2 state, and
`46d54311` the Task 4 state that P1 ran against.)*

### P3 — unsupported readiness must fail closed (merge-preflight guard)

**Question.** The whole-branch review found that `R011_TYPE_BY_READINESS` has no
default case. An unmapped readiness produced `type: undefined`,
`dispositionable: true`, `closureState: "undefined"` — and, because both
renderers fall through to their last branch, the message *"has no
machine-readable acceptance contract"* and the advice *"Add or repair the
acceptance criteria block"*, about a spec that may well have one. A failure to
map the authority was being rendered as a fact about the spec, on a finding a
human was then invited to dispose of. Unreachable today, since `readinessOf` is
exhaustive over three keys — but it sits exactly on the authority/consumer seam
this whole feature exists to discipline, and it fell toward a positive claim
rather than toward "we could not look".

**Fix.** A guard inside the existing `try`, so an unmappable readiness throws
and is handled by the `spec-closure-unobservable` path already designed for a
failure to observe. No fifth state, no guess, and the catch block and healthy
branch are untouched.

**Mutation applied** (both mirrors): delete the guard, restoring the
fall-through.

**Observed** — `node .evo-lite/cli/test.js governance`, exit **1**:

```
❌ Governance test failed: AssertionError [ERR_ASSERTION]: FORBIDDEN: rendering an unknown authority value as a fact about the spec — the fall-through claims "no machine-readable acceptance contract" about a spec that may have one
```

Every assertion ahead of it in `T-r011-unobservable` — the healthy control, the
degraded-readiness round and the presence-blind round — passed first, so
nothing masked this one.

**Restore.** Copied back; template, live mirror and backup all read
`30caed86d0f4c7134f6cc882f55813020bee18aec112c9ec9949fef735429d11`, governance
scope green at 386 blocks, full suite exit 0 at 445.

**Verdict: EFFECTIVE.** The guard is the only thing standing between an
unrecognised authority value and a fabricated governance fact.

### What these probes have in common

Both exist because a planned mutation was aimed at a guard that something
**earlier** also asserts. That is the standing lesson stated under M17, seen
twice on this branch — M17 in Task 2, M15/M16 in Task 5 — which makes it a
pattern in how the matrix was designed rather than two isolated accidents.
When designing a mutation, ask first: *what else asserts this, and does it run
before my target?* If the answer is yes, the row needs a companion probe that
is neutral to everything ahead of it.
