---
id: spec:mother-child-hive-nurture
linkedPlan: plan:mother-child-hive-nurture
status: draft
---

# Mother-Child Hive — Registry + Nurture (Fleet Upgrade Channel)

## Context

Evo-Lite is a *mother hive*: it holds the canonical runtime under `templates/`
and mirrors it byte-identically into its own `.evo-lite/cli/**` via
`sync-runtime`. When `create-evo-lite <path>` scaffolds a project, it stamps a
frozen copy of that runtime into the target and walks away. The target — a
*child hive* — then has no further tie to the mother.

On 2026-07-02 the first real child, `hungersnakegame4` (deployed ~2026-05-22 at
workspace version 2.0.8), was upgraded to 2.1.0. There was no command for this.
The upgrade was done by hand: copy the mother's three managed template families
into the child, bump the child's `.evo-lite/package.json`, add a missing
dependency, and lean on a manually-created git branch for rollback. It worked
(verify green, 11 memory records intact, all 2.1.0 subcommands present) but the
process was manual, unrecorded, unverified, and unsafe by construction.

Shadow-Genesis (the author's prior PowerShell mother-child prompt template)
named this the *Nurture* loop: "one node evolves, all benefit." Evo-Lite already
owns the hard half of that loop — a machine-readable gene boundary
(`template-manifest.js` `MANAGED_TEMPLATE_FAMILIES`) and a content-hash drift
check (`sync-runtime.verifyRuntimeLock`). What is missing is the cross-repo
channel that carries genes from one mother to many children, and a registry that
records the children exist.

## Root Cause

`sync-runtime` is single-repo: it copies `templates/cli/**` to
`.evo-lite/cli/**` *within the same project root*, and it no-ops entirely when a
project has no `templates/` tree — which is every child. So the mother's upgrade
mechanism physically cannot reach a child. There is also no record on the mother
side that any child was ever deployed, at what version, or whether it has since
drifted. The fleet is invisible and unreachable.

## Goal

Give the mother a **child registry** and a **nurture** command that pushes the
managed gene families from `templates/` into a registered child's runtime
locations, copying genes only, never project state, with a dry-run preview, a
drift/version report, and a safe rollback path. Make the shipped test harness
runnable (or gracefully skipped) inside a child so a nurtured child can be
verified in place.

## Non-Goals

- **Evolution / absorption (child → mother)** — reading a child's self-recorded
  improvements and merging them back into `templates/`. Designed below as a
  future phase, but **not implemented in this spec** and, when built, must stay
  behind an explicit human approval gate. A governance runtime must never
  auto-rewrite its own governing genes from an untrusted child.
- **Remote / networked children** — this spec covers children reachable on the
  local filesystem by path. No git remotes, no SSH, no fetch protocol.
- **Merging project state** — active_context, memory.db, raw_memory,
  index_memory, walkthroughs are the child's own operational memory and are
  never touched by nurture. Not now, not ever.
- **Auto-installing native dependencies** — nurture *detects and reports* a
  dependency gap (e.g. a new subsystem needs a package the child lacks); it does
  not silently run `npm install` or rebuild native modules in the child.
- **Bidirectional live sync** — nurture is a one-way, mother-initiated push. No
  watchers, no daemons.

## Design

### Gene vs. state boundary (reuse the manifest)

The boundary between "gene" (mother-owned, safe to overwrite in a child) and
"project state" (child-owned, never touched) already exists:
`MANAGED_TEMPLATE_FAMILIES` in `template-manifest.js`. Its three families —
`core-cli` (→ `.evo-lite/cli/**`), `agents-workflows` (→ `.agents/workflows/`),
`hook-scaffold` (→ `.github/**`, `.codex/**`) — are exactly the files the manual
upgrade copied. Nurture consumes the same list via
`buildManagedTemplateEntries`. Anything not in a managed family (notably
`.agents/rules/`, `active_context.md`, `memory.db`, `raw_memory/`) is
categorically out of scope. **One source of truth for the boundary; nurture and
sync-runtime cannot disagree about what a gene is.**

### Child registry (mother side)

A registry file on the mother, `.evo-lite/hive/children.json`:

```json
{
  "version": "evo-hive-registry@1",
  "children": [
    {
      "id": "hungersnakegame4",
      "path": "D:/Data/ProjectAgent/hungersnakegame4",
      "registeredAt": "2026-07-02T00:00:00.000Z",
      "lastNurturedAt": "2026-07-02T00:00:00.000Z",
      "lastNurturedVersion": "2.1.0"
    }
  ]
}
```

Commands (under a new `mem hive` group):

- `mem hive register <path> [--id <id>]` — validate the path is an evo-lite
  child (has `.evo-lite/cli/` and `.evo-lite/package.json`), append/update its
  registry entry. `id` defaults to the child directory basename.
- `mem hive list [--json]` — print registered children with their recorded
  version and last-nurture time.
- `mem hive status [<id>] [--json]` — for each child, compare the child's
  managed-file content hashes against the mother's current `templates/` genes
  and its recorded version against the mother's package version; report per
  child: `up-to-date` | `behind (X→Y)` | `drifted (<files>)` | `unreachable`.

Registry path resolution and id validation reuse the same
`^[a-z0-9._-]+$`-style guard as `evidence-store.evidenceSlug` so an id can never
escape the registry file or a path segment.

**Mother-only guard:** `hive/*.js` lives in the `core-cli` family, so nurture
ships it into every child — a child therefore *has* the hive commands but no
`templates/` tree to push from. Every `mem hive` subcommand preflights
"am I a mother" (`templates/cli` exists); in a child it exits non-zero with
`this is a child hive — run hive commands from the mother` before touching any
file. (A child that wants to become a mother of its own fleet simply grows a
`templates/` tree; the guard is environmental, not identity-hardcoded.)

**Gitignore note:** the mother's `.gitignore` ignores `.evo-lite/*` with an
explicit allowlist (`!.evo-lite/verification/` etc.). `children.json` is fleet
state and must be versioned — add `!.evo-lite/hive/` + `!.evo-lite/hive/**/*.json`
to the allowlist, mirroring the verification pattern. (Without this the registry
silently never enters git — same trap the close-journal files hit before.)

### Nurture (mother → child)

`mem hive nurture <id> [--family <key>] [--check] [--dry-run] [--force] [--json]`:

1. Resolve the child from the registry; fail clearly if unregistered or the path
   is unreachable.
2. Build managed entries with the child as the active root and the mother's
   `templates/` as the source: `buildManagedTemplateEntries({ workspaceRoot:
   childRoot, activeCliDir: childRoot/.evo-lite/cli, templateRootPath:
   motherTemplates, templateCliPath: motherTemplates/cli, scopes:
   ['sync-always'] })`. This is `sync-runtime`'s copy loop with a **split root**:
   source in the mother, destination in the child.
   - **`--family <key>` selects a subset** of the managed families to push
     (`core-cli` | `agents-workflows` | `hook-scaffold`); omitted → all families.
     (Borrowed from Shadow-Genesis's `distribute.ps1 -Component`, but keyed to
     the manifest families instead of ad-hoc names, so the selector and the gene
     boundary stay the same source of truth.)
3. **Preflight safety:**
   - If the child working tree is dirty in a managed path, refuse without
     `--force` (a nurture must not silently clobber a child's uncommitted gene
     edits — those may themselves be evolution candidates). If the child is not
     a git repo, the dirty check is impossible: warn explicitly and require
     `--force` to proceed (consistent with the rollback fallback below —
     a non-git child gets neither safety net for free).
   - **Record a rollback point as a child-side git tag** `evo-nurture-pre-<motherVersion>`
     (annotated) on the child's current HEAD when the child is a clean git repo;
     rollback is then native `git reset --hard <tag>` in the child. This is what
     the manual upgrade did by hand (a backup branch) and matches Shadow-Genesis's
     Chronos snapshot/rollback (git tag, not a JSON copy). If the child is not a
     git repo, fall back to a hash manifest at `.evo-lite/hive/nurture-<id>.lastrun.json`
     on the mother and warn that rollback is manual.
4. `--dry-run` / `--check` computes and reports the copy/skip/missing sets and
   the dependency gap **without writing**. `--check` exits non-zero if the child
   is not already up-to-date (CI/gate use).
5. On apply: copy each changed managed file mother→child (anchor-merging hybrid
   files, see below), write the child's
   `.evo-lite/generated/runtime-mirror.lock.json`, write a **child-side receipt**
   `.evo-lite/hive/nurture-received.json` (source mother version, families pushed,
   file list, timestamp — the child can self-report its lineage without reaching
   the mother), bump the child's `.evo-lite/package.json` version to the mother's
   package version, and update the mother registry entry's `lastNurturedAt` /
   `lastNurturedVersion`. (The child receipt is borrowed from Shadow-Genesis's
   per-child `nurture_log.json`; the mother registry update mirrors its
   `nurture_history.json`.)
6. **Dependency reconciliation (report-only):** diff the mother's shipped
   runtime manifest — `templates/runtime/package.json`, the same file T18e
   already governance-checks against `RUNTIME_DEPENDENCIES` — against the
   child's `.evo-lite/package.json` dependencies **by package name**; if the
   child is missing any, print an explicit "run `npm install` in
   `<child>/.evo-lite`" instruction naming the missing packages. Version-range
   differences are reported informationally, never auto-bumped. Never install
   automatically. (This is the `@modelcontextprotocol/sdk` gap from the manual
   upgrade, surfaced instead of silently broken.)

### Anchor-merge for hybrid files (preserve child-local content)

Most managed files are pure genes — overwrite wholesale. But some are *hybrid*:
they carry a mother-owned template body **and** a child-local block that must
survive an upgrade. Shadow-Genesis solved this in `distribute.ps1` with
`Merge-ActivateShadow`: it overwrites everything except a
`<!-- LEGION_CONTEXT_START --> … <!-- LEGION_CONTEXT_END -->` block, which it
carries over from the child. Evo-Lite already speaks this dialect natively —
`active_context.md` is delimited by `BEGIN_FOCUS/END_FOCUS`,
`BEGIN_BACKLOG/END_BACKLOG`, `BEGIN_TRAJECTORY/END_TRAJECTORY` anchors.

Rule: a managed file **opts in** to anchor-merge via the manifest. Schema: a
family's `files` array entry is today a plain string (pure gene, full
overwrite); a hybrid gene uses the object form
`{ path: 'workflows/x.md', mergeAnchors: [['BEGIN_X','END_X'], …] }`.
`buildEntry` normalizes both forms (`typeof file === 'string' ? { path: file } :
file`), so existing string entries and `sync-runtime` are untouched. For an
anchored file,
nurture replaces the mother's inter-anchor regions but **preserves the child's
content inside each declared anchor pair**; a file with no `mergeAnchors` is a
pure overwrite (today's behavior). In this spec no managed family declares
anchors (the current gene set is all pure-overwrite code), so the mechanism ships
**dormant but tested** — it exists for the moment a hybrid gene (e.g. a workflow
doc with a project-specific tail) enters a managed family, and it keeps nurture
from clobbering a child's legitimate local customization. `active_context.md`
itself stays out of every managed family, so this is about future hybrid *genes*,
not project state.

### Self-brick avoidance

The known partial-mirror self-brick (a loaded file requiring a
newly-managed-but-not-yet-copied sibling) applies across the split root too.
Ordering is strict: **preflight verifies every selected source file exists on
the mother BEFORE the first byte is written to the child** — any missing source
aborts with zero writes (true all-or-nothing, not copy-then-notice). Only after
the full existence pass does nurture copy all entries (manifest `files` order),
then write the lock, then the receipt. A failure mid-copy (I/O error) is
reported with the list of files already written and the rollback tag to reset
to — the tag from preflight is the recovery path, not a partial-state parser.

### Test-harness portability

`test/harness.js` hard-codes
`TEMPLATE_CONTEXT_PATH = WORKSPACE_ROOT/templates/active_context.md` and reads it
unconditionally in `createTempRuntimeRoot`. In a child there is no `templates/`,
so the governance and integration suites throw ENOENT and cannot verify a
nurtured child in place. Fix: `createTempRuntimeRoot` falls back to an
**embedded minimal context fixture** (a small constant string with the same
anchor markers) when `TEMPLATE_CONTEXT_PATH` does not exist, instead of reading
the file. Behavior in the mother is unchanged (file exists, is read); behavior
in a child becomes runnable (file absent, embedded fixture used). No `templates/`
tree is shipped into children.

The fixture fallback alone is **not** enough: the governance suite references
`TEMPLATE_CLI_DIR` ~65 times (T17 sync-runtime, the T18 pack/manifest series,
initializer tests via `INIT_ENTRY`) — those tests are inherently *mother-bound*
and cannot run where no `templates/` tree exists. Policy: harness exports
`IS_CHILD_RUNTIME = !fs.existsSync(TEMPLATE_CLI_DIR)`; each mother-bound test
block gates on it and **self-skips with an explicit `⏭️ skipped (child runtime)`
notice** — never a silent pass. In a child, the suite runs the runtime-local
tests, prints the skip count, and exits 0; in the mother nothing changes. A
skipped test must be visibly skipped so a child-side green run cannot be
mistaken for full mother coverage.

### Evolution (child → mother) — designed, deferred

Recorded here so the registry schema anticipates it, but **out of scope to
build**: a child accumulates gene edits (a refined workflow, a fixed rule) in
its managed paths; `mem hive status` already surfaces these as `drifted`. A
future `mem hive harvest <id>` would produce a **read-only diff proposal**
(child managed file vs mother gene) for a human to review and, if it is a
genuine general-purpose improvement rather than project-specific noise, merge
into `templates/` by hand. The absorption step is never automatic.

Deliberate divergence from Shadow-Genesis's `evolve_core.ps1`, which prompts
`Read-Host "Absorb evolution? (y/n)"` per file: evo-lite CLI frequently runs
headless (agent, hook, CI), where an interactive prompt **hangs the process**.
Harvest therefore emits a diff artifact for out-of-band human review, never an
inline blocking prompt. Its mother-side backup before any hand-merge is a git
tag (Chronos-style), not a zip.

## Error Handling

- Unregistered/unreachable child, invalid id, missing `.evo-lite/` in target →
  fail with a clear message and non-zero exit; write nothing.
- Any `mem hive` subcommand invoked where `templates/cli` is absent (i.e. inside
  a child) → refuse with the mother-only message, non-zero exit, zero writes.
- Dirty managed path in the child without `--force` → refuse, name the dirty
  files, exit non-zero.
- Any `missingTemplates` during a nurture apply → abort before writing the lock;
  the child is left untouched (all-or-nothing).
- `mem hive status` on an unreachable child path → report `unreachable` for that
  child and continue with the rest; do not abort the whole report.

## Testing

- **Registry round-trip:** `register` then `list` returns the child with the
  recorded fields; a second `register` of the same id updates in place, does not
  duplicate.
- **Id safety:** an id containing a path separator or `..` is rejected.
- **Nurture copies genes only:** after nurture into a temp child, every managed
  file matches the mother gene byte-for-byte, and the child's `active_context.md`
  + `memory.db` are unchanged (hash equal to pre-nurture). This is the
  load-bearing "never touch project state" assertion.
- **Dry-run writes nothing:** `--dry-run` reports a non-empty copy set while the
  child's managed files remain at their pre-run hashes.
- **Status detects behind + drift:** a child pinned one version back reports
  `behind`; a child with one managed file hand-edited reports `drifted` naming
  that file.
- **Dependency gap reported:** a child whose `.evo-lite/package.json` lacks a
  mother runtime dep gets an explicit missing-package instruction, and nurture
  still completes the file copy (report, don't block).
- **Harness portability:** `createTempRuntimeRoot` succeeds with no `templates/`
  tree present (embedded fixture path), and still succeeds unchanged when the
  file exists.
- **Child-mode skip visibility:** with `IS_CHILD_RUNTIME` true, mother-bound
  tests emit an explicit `⏭️ skipped (child runtime)` line and the suite exits 0;
  the skip count is printed in the summary (a silent skip is a defect).
- **All-or-nothing abort:** a simulated `missingTemplates` leaves the child's
  runtime-mirror lock and managed files untouched.
- **Family filter:** `nurture --family agents-workflows` copies only that family's
  files; `core-cli` managed files in the child stay at their pre-run hashes.
- **Anchor-merge preserves child block:** for a fixture managed file declaring a
  `BEGIN_X/END_X` anchor pair, nurture replaces the outside-anchor body with the
  mother's version while the child's inside-anchor content is byte-preserved; a
  fixture file with no declared anchors is fully overwritten.
- **Child receipt written:** after nurture, `.evo-lite/hive/nurture-received.json`
  in the child records the mother version, families, and file list.

## Acceptance Criteria

```json
{
  "criteria": [
    { "id": "ac-hive-registry",
      "description": "mem hive register/list persists a child (path, version, timestamps) in .evo-lite/hive/children.json; re-registering the same id updates in place; ids with path separators or .. are rejected.",
      "dependsOn": ["templates/cli/hive/registry.js", "templates/cli/hive/commands.js", "templates/cli/test/governance.js", "templates/cli/test/harness.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-nurture-genes-only",
      "description": "mem hive nurture copies every MANAGED_TEMPLATE_FAMILIES file from the mother templates/ into a registered child byte-for-byte, and leaves the child's active_context.md and memory.db unchanged (project state never touched).",
      "dependsOn": ["templates/cli/hive/nurture.js", "templates/cli/template-manifest.js", "templates/cli/test/governance.js", "templates/cli/test/harness.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-nurture-dry-run",
      "description": "mem hive nurture --dry-run/--check reports the copy/skip/missing sets and any dependency gap without writing; the child's managed files stay at their pre-run hashes and --check exits non-zero when the child is not up-to-date.",
      "dependsOn": ["templates/cli/hive/nurture.js", "templates/cli/test/governance.js", "templates/cli/test/harness.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-nurture-family-filter",
      "description": "mem hive nurture --family <key> pushes only the selected manifest family; managed files of other families in the child stay at their pre-run hashes.",
      "dependsOn": ["templates/cli/hive/nurture.js", "templates/cli/template-manifest.js", "templates/cli/test/governance.js", "templates/cli/test/harness.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-nurture-anchor-merge",
      "description": "For a managed file declaring mergeAnchors, nurture overwrites the outside-anchor body from the mother gene while byte-preserving the child's inside-anchor content; a file with no mergeAnchors is fully overwritten.",
      "dependsOn": ["templates/cli/hive/nurture.js", "templates/cli/test/governance.js", "templates/cli/test/harness.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-nurture-receipt",
      "description": "After nurture, the child has .evo-lite/hive/nurture-received.json recording the mother version, families pushed, and file list, and a clean git child gets an evo-nurture-pre-<version> rollback tag.",
      "dependsOn": ["templates/cli/hive/nurture.js", "templates/cli/test/governance.js", "templates/cli/test/harness.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-hive-status-drift",
      "description": "mem hive status reports up-to-date | behind (version) | drifted (naming the file) | unreachable per registered child by hashing child managed files against mother genes, and continues past an unreachable child.",
      "dependsOn": ["templates/cli/hive/status.js", "templates/cli/sync-runtime.js", "templates/cli/test/governance.js", "templates/cli/test/harness.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } },
    { "id": "ac-harness-portable",
      "description": "With no templates/ tree present, the governance suite still exits 0: createTempRuntimeRoot falls back to an embedded context fixture, and mother-bound tests (IS_CHILD_RUNTIME) self-skip with an explicit skip notice instead of throwing; mother behavior is unchanged.",
      "dependsOn": ["templates/cli/test/harness.js", "templates/cli/test/governance.js"],
      "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } } }
  ]
}
```

## Follow-up

- **Evolution phase (`mem hive harvest`)** — read-only child→mother gene diff
  proposals, human-gated absorption. Highest-value next step once two-plus
  children exist and start diverging.
- **`create-evo-lite <path>` should auto-register** the new child into the
  mother's registry at scaffold time, so the fleet is visible from birth rather
  than registered after the fact.
- **`hungersnakegame4` is the standing integration child** — after this ships,
  re-run the real nurture through the command (not by hand) and record the
  before/after in the registry, closing the dogfood loop that motivated the spec.
