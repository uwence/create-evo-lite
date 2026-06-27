---
id: spec:verification-contract-phase1
status: done
created: 2026-06-27
linkedPlan: plan:verification-contract-phase1
---

# Verification Contract Phase 1 — Execution Engine Spec

## Goal

Make the Phase 0 data contract LIVE: run the machine verifiers, write
commit-bound evidence records, and surface live four-state verdicts. After
Phase 1, `mem verify-contract run <spec>` + `status <spec>` answers "is this
spec actually verified at HEAD?" with evidence, not narrative. Does NOT touch
`mem close` or the drift engine — those consume this in later phases.

## Why

Phase 0 shipped the schema, validators, and the pure `deriveVerdicts`, but
nothing produces real evidence records or runs verifiers. `deriveVerdicts` needs
`changedFiles`, which nothing computes. Phase 1 closes that loop so the contract
stops being inert.

## Builds on Phase 0

Reuses, unchanged: `contract-schema.json`, `parseSpecCriteria`,
`validateCriteria`, `validateEvidenceRecord`, and the pure `deriveVerdicts`
(`templates/cli/verification/`). Phase 1 adds the execution + storage + CLI layer
around them.

## CLI surface (the closed loop)

- `mem verify-contract run <spec>` — parse criteria, run every **machine**
  verifier (skip `manual`), overwrite each criterion's evidence record bound to
  the current HEAD sha, print a run summary. **Fail-closed on a dirty tree** (see
  Integrity).
- `mem verify-contract status <spec>` — read records, compute `changedFiles`
  per criterion, derive live four-state verdicts, print a table. `--strict`:
  exit non-zero if any criterion is not `PASS` (the gate interface a later
  `mem close` consumes). `--json` for machine output.
- `mem verify-contract attest <spec> <criterionId> --by <name> [--note <text>]`
  — write a `manual` evidence record (verdict `PASS`, `attestedBy` set). The only
  way a `manual` criterion becomes PASS.

## Integrity rules (the honesty mechanisms)

- **Dirty-tree fail-closed.** `run` refuses to write evidence when `git status
  --porcelain` is non-empty, with a clear message ("commit changes first;
  evidence must bind to a real commit"). Binding evidence to a HEAD that does not
  contain the tested working-tree state is the exact failure Phase 0 exists to
  prevent.
- **Raw verdict ∈ {PASS, FAIL} only.** A freshly-run verifier yields PASS or
  FAIL; `STALE`/`UNVERIFIED` are derived-only states and are never stored. `run`
  writes only PASS/FAIL records; every record passes `validateEvidenceRecord`.
- **Unreachable commit → STALE.** When `status` cannot resolve a record's
  `commitSha` (rebased/gone, `git diff` fails), it conservatively reports STALE
  rather than trusting unverifiable evidence.

## Verifier execution (`run-verifiers.js`)

Each verifier returns `{ verdict: 'PASS'|'FAIL', detail: string }`.

| type | behavior |
|------|----------|
| `command` | `execSync(params.cmd, { cwd: repoRoot, timeout: 120000 })`; exit 0 → PASS; capture exit code + truncated (≤500 char) stdout/stderr into `detail`; inherits env. No sandbox — specs are repo-authored (same trust as `test.js`). |
| `file-exists` | `fs.existsSync(resolve(repoRoot, params.path))` → PASS |
| `file-absent` | NOT existing → PASS |
| `json-path-equals` | read+parse `params.file` (repo-relative); navigate `params.path` (an **array of keys**, e.g. `["packages", "", "version"]` — supports empty-string keys); compare to `params.equals` (literal, deep-equal) or to the value at `params.equalsJsonPath` `{file, path}`. Missing file/path → FAIL with detail. |
| `manual` | never run; left for `attest` |

`params.path` for `json-path-equals` is an **array of keys**, not a dot-string,
so empty keys and arbitrary key names need no escaping. (Phase 0 only required
the `path` key to exist; Phase 1 fixes its type.)

## Evidence storage (`evidence-store.js`)

- File: `.evo-lite/verification/evidence-<specSlug>.json`, **git-tracked**.
- Shape: `{ version, specId, records: { <criterionId>: <record> } }` — one latest
  record per criterion (overwrite). Matches `deriveVerdicts` "last wins".
- Each record: `{ criterionId, verdict, commitSha, verifierType, ranAt, detail,
  attestedBy }` — validated by `validateEvidenceRecord` before write.
- `ranAt` is supplied by the caller (the CLI passes a timestamp); the store is a
  pure read/write module.

## status + changedFiles (per criterion)

`status` does NOT change `deriveVerdicts`. For each criterion it computes that
criterion's own `changedFiles = git diff <record.commitSha>..HEAD --name-only`
(records may carry different commitShas after partial runs), then calls the pure
`deriveVerdicts` per criterion with that set. Unreachable `commitSha` → STALE.
The git call is the only impurity and lives in `status`, never in the Phase 0
function.

## Acceptance Criteria

```json
{
  "criteria": [
    { "id": "ac-run-machine-verifiers",
      "description": "run executes command/file-exists/file-absent/json-path-equals and writes PASS/FAIL evidence records bound to HEAD.",
      "dependsOn": ["templates/cli/verification/run-verifiers.js", "templates/cli/verification/evidence-store.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-dirty-tree-fail-closed",
      "description": "run refuses to write evidence when the working tree is dirty.",
      "dependsOn": ["templates/cli/verification/commands.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-status-four-states",
      "description": "status derives PASS/FAIL/UNVERIFIED/STALE per criterion using per-record changedFiles; unreachable commit → STALE; --strict exits non-zero on any non-PASS.",
      "dependsOn": ["templates/cli/verification/commands.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-attest-manual",
      "description": "attest writes a manual PASS record with attestedBy; status then shows it PASS (STALE-exempt).",
      "dependsOn": ["templates/cli/verification/commands.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-json-path-array",
      "description": "json-path-equals navigates an array-of-keys path including empty-string keys (e.g. lock packages[''].version).",
      "dependsOn": ["templates/cli/verification/run-verifiers.js", "templates/cli/test.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } }
  ]
}
```

## Non-Goals

- `mem close --preview` / `--apply` (next phase; consumes `status --strict`).
- Wiring verdicts into the drift engine / dashboard (later phase).
- Sandboxing `command` verifiers (specs are repo-authored, trusted).
- Manual-attestation expiry (a manual PASS stays valid; revisit later).
- Open/extensible verifier-type registry.

## Testing notes

Governance tests T33+ use **fixture specs with cheap commands** (e.g. `node -e
"process.exit(0)"`), never the self-referential dogfood spec, to avoid recursive
test-suite invocation. Git interactions in `status` tests inject a fake
`git diff` (dependency-injected) so the pure verdict logic is tested without a
real repo.
