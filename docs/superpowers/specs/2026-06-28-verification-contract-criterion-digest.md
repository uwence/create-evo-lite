---
id: spec:verification-contract-criterion-digest
status: draft
created: 2026-06-28
linkedPlan: plan:verification-contract-criterion-digest
---

# Verification Contract — Criterion Digest (PR2) Spec

## Goal

Bind each evidence record to the exact criterion definition it verified, so that
editing a criterion's verifier (command, params, type, or dependsOn list) STALEs
the old PASS. Today STALE only fires when a `dependsOn` *file* changes; a change
to the *contract itself* (e.g. swapping `verifier.cmd`) leaves an old PASS
standing, proving a contract that no longer exists. PR2 closes that gap.

## Why (the hole this fixes)

The external review's P0-2: evidence carries `commitSha` + `verifierType` but not
a fingerprint of the criterion, and `deriveVerdicts` only checks `dependsOn` file
changes. So:

```
edit verifier.cmd / params / dependsOn / type  →  old PASS survives  →  green ≠ verified
```

Worse for `manual`: it is STALE-exempt entirely, so a redefined manual criterion
keeps its old attestation forever.

## Design

### criterionDigest

A pure `criterionDigest(criterion)` → `"sha256:<hex>"`, the SHA-256 of a canonical
JSON of the criterion's **verification semantics only**:

```
{ id, verifier: { type, params }, dependsOn }
```

- Keys are sorted recursively (stable across author reordering of `params`).
- `description` is EXCLUDED — it is human prose, not verification semantics; a
  typo fix must not STALE evidence.
- `dependsOn` order is preserved (reordering is a deliberate edit → digest changes).

Lives in `validate-contract.js` (the contract module, dependency-light), exported
for both the writers (engine) and the reader (`deriveVerdicts`).

No `contractDigest`. A per-criterion digest is strictly more precise: editing one
criterion STALEs only that criterion, not the whole spec. The coarse whole-block
hash the review suggested is redundant and is dropped (YAGNI).

### Evidence record

Records gain `criterionDigest` (a `sha256:` string). `runSpec` and `attestSpec`
compute it from the criterion at write time and store it. `validateEvidenceRecord`
keeps it OPTIONAL (so the schema stays backward-tolerant and existing tests that
build minimal records still validate); presence is enforced semantically by the
STALE rule below.

### Verdict derivation

`deriveVerdicts(criteria, records, headSha, changedFiles)` already receives the
live `criteria`, so it computes each criterion's current digest and compares:

- **machine** PASS → STALE if: `record.criterionDigest` is absent, OR it ≠ the
  current digest, OR a `dependsOn` glob matches `changedFiles` (the existing rule),
  OR (no `changedFiles` supplied) `record.commitSha !== headSha`.
- **manual** PASS → STALE if: `record.criterionDigest` is absent OR ≠ current
  digest. Still exempt from the `dependsOn`/commit rules (an out-of-band
  attestation is not bound to code), but NOT exempt from criterion redefinition.
- FAIL / UNVERIFIED unchanged.

**Backward compatibility:** records written before PR2 have no `criterionDigest`
→ treated as STALE (their PASS is unprovable against the current definition).
Upgrading STALEs existing evidence once; re-running `verify-contract run`
(or re-`attest`) rebinds with a digest. This is the honest default.

## Acceptance Criteria

```json
{
  "criteria": [
    { "id": "ac-digest-stable-semantic",
      "description": "criterionDigest is stable across params key reordering and ignores description; changes when verifier/params/dependsOn change.",
      "dependsOn": ["templates/cli/verification/validate-contract.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-machine-stale-on-redef",
      "description": "deriveVerdicts STALEs a machine PASS when the criterion digest changes or is absent, even if dependsOn files are unchanged.",
      "dependsOn": ["templates/cli/verification/derive-verdicts.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-manual-stale-on-redef",
      "description": "A manual PASS STALEs when its criterion digest changes/absent, but stays PASS when only dependsOn files or HEAD change.",
      "dependsOn": ["templates/cli/verification/derive-verdicts.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-writers-set-digest",
      "description": "runSpec and attestSpec write criterionDigest into evidence records.",
      "dependsOn": ["templates/cli/verification/engine.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } }
  ]
}
```

## Non-Goals

- `contractDigest` / whole-spec hashing (per-criterion digest supersedes it).
- Changing what `dependsOn` means or the STALE file-glob rule.
- Migrating/auto-rebinding old evidence (upgrade STALEs; user re-runs).
- Signed/tamper-proof evidence (digest detects redefinition, not malicious edits).

## Testing notes

Synthetic-record governance tests (e.g. T35 computeLiveVerdicts) must add the
matching `criterionDigest` to records they expect to be PASS, since absent digest
now means STALE. Use `criterionDigest(criterion)` to compute the expected value in
the test rather than hard-coding a hash.
