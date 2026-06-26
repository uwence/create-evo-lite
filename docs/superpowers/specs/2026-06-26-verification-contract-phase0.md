---
id: spec:verification-contract-phase0
status: draft
created: 2026-06-26
linkedPlan: plan:verification-contract-phase0
---

# Verification Contract Phase 0 — Data Contract Spec

## Goal

Make acceptance criteria machine-readable and bind their verification to a
commit, so "verified" can no longer be an unfalsifiable human narrative. Phase 0
delivers the **data contract + pure logic only** — the criterion schema, the
evidence-record format, the four-state verdict, a schema validator, and a pure
verdict-derivation function. It does NOT execute verifiers and does NOT touch
`mem close`. Those are later phases that build on this contract.

## Why (the failure this fixes)

The 2.0.10 closure declared "verified green / fully closed" while three release
blockers shipped green, and the archive evidence read "green tests from a prior
lost session" — bound to no commit, no environment, no verifier. The root enabler:
acceptance criteria were prose, judged by a human who misread the code. Phase 0
removes the prose-judgment path for any criterion that opts into the contract.

## Concepts

### 1. Acceptance Criterion (authored, lives on the spec)

Specs MAY carry a structured criteria list, authored as a fenced **```json**
`{ "criteria": [...] }` block under the `## Acceptance Criteria` heading. JSON,
not YAML: the runtime ships no YAML parser, so JSON keeps parsing dependency-free
(`JSON.parse`). One criterion (shown annotated for readability; the authored block
is plain JSON):

```jsonc
{
  "id": "ac-1",                              // unique within the spec
  "description": "human-readable acceptance statement",
  "dependsOn": ["index.js", "templates/runtime/**"],  // globs; STALE trigger set (REQUIRED, ≥1)
  "verifier": { "type": "command", "params": { "cmd": "..." } }  // params shape per type
}
```

Criteria are **optional and additive**: a spec with no criteria block is simply
"no machine-readable acceptance yet" and parses exactly as today. The existing 12
specs are unaffected. The prose narrative stays beside the machine block.

### 2. Verifier types (closed enum — Phase 0 defines, does not run)

Verifier types are **atomic** — no type embeds a workflow inside another. A
criterion that needs setup-then-check is a `command` whose script does both.

| type | params | passes when |
|------|--------|-------------|
| `command` | `{ cmd: string, cwd?: string, scope?: string }` | the command exits 0 |
| `file-exists` | `{ path: string }` | path exists (repo-relative, static) |
| `file-absent` | `{ path: string }` | path does not exist |
| `json-path-equals` | `{ file: string, path: string, equals?: <literal>, equalsJsonPath?: { file, path } }` | the JSON value equals the literal, or the value at another json-path |
| `manual` | `{ reason: string }` | a human attests it (see verdict rules) |

This closed set is the minimal-yet-complete cover for the 2.0.10 failures:
`command` (npm test / pack-consume), `file-exists`/`file-absent` (skip-install
manifest), `json-path-equals` (version triple-equality, root-lock consistency),
`manual` (branch-protection required-check — genuinely not CLI-verifiable).
Open/extensible registry-keyed types are deferred to a later phase.

### 3. Evidence Record (generated, commit-bound)

One record per criterion per run, written to
`.evo-lite/generated/verification/evidence.json` (a generated artifact, never
hand-edited). Record shape:

```jsonc
{
  "criterionId": "ac-1",
  "specId": "spec:<slug>",
  "verdict": "PASS",                 // PASS | FAIL | UNVERIFIED | STALE (raw record; effective verdict is derived)
  "commitSha": "f505704",            // HEAD at the time the verifier ran
  "verifierType": "command",
  "ranAt": "2026-06-26T06:42:00Z",
  "detail": "exit=0",                // short human-facing evidence string
  "attestedBy": null                 // non-null ONLY for type: manual
}
```

Phase 0 defines this shape and its location and a pure derivation function; it
does NOT generate records by running verifiers (that is the next phase). Records
may be authored by tests/fixtures to exercise the derivation function.

### 4. Four-state Verdict (derived, pure function)

The effective verdict is **derived** from (the criterion + its evidence record +
the current HEAD sha + the set of files changed since the record's commit), never
read raw. The derivation is a pure function — it does NOT run git or verifiers;
the caller supplies `headSha` and `changedFiles` (a later phase computes
`changedFiles` from `git diff record.commitSha..HEAD`).

`deriveVerdicts(criteria, records, headSha, changedFiles) -> [{ criterionId, verdict, detail }]`

Rules per criterion (latest record for its id):

- **UNVERIFIED** — no record exists. (The true state behind the 2.0.10 "verified
  green" claim.)
- **FAIL** — record's raw verdict is FAIL.
- **PASS** — record's raw verdict is PASS AND it is still valid:
  - `manual` records are always valid (an out-of-band attestation, not bound to
    code; exempt from STALE) — they carry `attestedBy` and are surfaced distinctly
    so a manual attestation can never masquerade as a machine verification;
  - machine records are valid when none of the criterion's `dependsOn` globs match
    a path in `changedFiles`.
- **STALE** — a machine PASS record whose `dependsOn` intersects `changedFiles`
  (the "green from a prior commit" killer). Fallback: when `changedFiles` is not
  supplied (null/undefined), STALE reduces to the strict `record.commitSha !==
  headSha`. An empty `changedFiles` array means "nothing changed" → not STALE.

The `dependsOn`-based rule is why HEAD moving for unrelated reasons does NOT
invalidate evidence — only a change to the criterion's own dependency set does.

## Phase 0 Deliverables (the testable units)

1. **contract-schema.json** — the shipped asset enumerating the closed verifier
   types (+ per-type required/optional params) and the four verdict states; the
   single source of truth the validator and derivation read.
2. **Criterion + evidence validator** — `validateCriteria(criteria)` and
   `validateEvidenceRecord(record)`: ids unique; `verifier.type` in the enum;
   required params present; `dependsOn` non-empty; verdict in the enum; `manual`
   ⇔ `attestedBy`. Plus `parseSpecCriteria(specText)` to extract the JSON block.
3. **Pure verdict-derivation function** — `deriveVerdicts(criteria, records,
   headSha, changedFiles)` implementing §4. Testable without running any verifier.
4. **`mem verify-contract lint <spec>`** — CLI surface over the validator; the
   phase-0 spec validates against its own contract (dogfood).

All ship as runtime modules under `templates/cli/verification/`, mirrored to
`.evo-lite/cli/verification/`, guarded by the governance test slice.

## Relationship to existing governance (orthogonal, not wired in Phase 0)

R008 archive-evidence (task-level, narrative) and `task.verify` (freeform) remain
unchanged. Criterion verdicts are a NEW spec-level, machine-checkable layer. They
coexist; a later phase may let criterion verdicts supersede narrative acceptance
evidence. Phase 0 does not modify R008, the planning IR, the drift engine, or the
dashboard.

## Acceptance Criteria

```json
{
  "criteria": [
    { "id": "ac-schema-file-present",
      "description": "The verifier-type + verdict schema ships as a contract asset.",
      "dependsOn": ["templates/cli/verification/**"],
      "verifier": { "type": "file-exists", "params": { "path": "templates/cli/verification/contract-schema.json" } } },
    { "id": "ac-validator-rejects-bad",
      "description": "validateCriteria/validateEvidenceRecord reject unknown type, missing params, empty dependsOn, dup ids, bad verdict, and manual/attestedBy mismatch.",
      "dependsOn": ["templates/cli/verification/**", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-derive-four-states",
      "description": "deriveVerdicts returns UNVERIFIED (no record), STALE (machine PASS with dependsOn in changedFiles), PASS (machine PASS, deps untouched; or manual), FAIL.",
      "dependsOn": ["templates/cli/verification/**", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-manual-attestation-distinct",
      "description": "A manual criterion is STALE-exempt and its evidence requires attestedBy; machine evidence must not carry attestedBy.",
      "dependsOn": ["templates/cli/verification/**", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-lint-dogfood",
      "description": "mem verify-contract lint validates this spec's own criteria block.",
      "dependsOn": ["templates/cli/verification/**", "docs/superpowers/specs/2026-06-26-verification-contract-phase0.md"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } }
  ]
}
```

## Non-Goals

- Executing verifiers / generating real evidence records (next phase).
- Computing `changedFiles` from git inside the contract (caller/later phase supplies it).
- `mem close --preview` / `--apply` (later phase; consumes this contract).
- Wiring the four-state verdict into the drift engine or dashboard (later phase).
- Open/extensible verifier-type registry.
