# [pr-state-sync] Read-Only PR Expected-State Validator — Design Spec

## 0. Status and Authorization Boundary

This document freezes the design for the `pr-state-sync` child-hive feedback item against:

```text
BASE
main@70c173b11ec64896780be67eb6b8bda94d2295fb

STATUS
DESIGN FROZEN
```

This design authorizes only a future implementation plan after separate review. It does not authorize implementation, tests, a Draft PR, feedback collection, PR mutation, active-context mutation, or selection of another NEXT scope.

The first release is a local, read-only validator. It compares an expected-state block in a PR body with observed GitHub and local Git facts. It does not decide whether a PR should become Ready or should merge.

## 1. Problem Statement

Long-lived governance PR bodies repeatedly become stale relative to the actual PR head, base, commit count, changed-file count, CI result, and Draft/Ready/merged state. Manual review then has to rediscover and rewrite those facts at every gate.

Free-text semantic parsing is not a safe solution. Narrative prose is intentionally flexible and cannot provide an unambiguous machine contract. Automatic rewriting is also outside the first-release trust boundary.

The narrow solution is an opt-in, fixed-marker expected-state block plus a deterministic read-only validator:

```text
expected state in PR body
        ↓
observed GitHub and local Git facts
        ↓
field-by-field comparison
        ↓
pass / structured drift findings / observation error
```

## 2. Goals

The first release must:

- expose one local CLI surface: `pr-state validate [pr] [--json]`;
- parse one strict expected-state block from the PR body;
- observe the target PR without mutating GitHub, Git, or repository files;
- compare all reliably observable contract fields in one run;
- bind CI observation to the target PR and its current observed head;
- prevent an old successful run from satisfying a newer head or newer run state;
- distinguish contract drift from parser or observation failure;
- emit a stable JSON envelope and deterministic finding order;
- remain testable through dependency-injected Git and `gh` runners;
- preserve live/template parity in any future implementation.

## 3. Non-Goals

The first release must not:

- parse or judge free-form PR prose;
- generate or rewrite the PR body;
- transition Draft/Ready state;
- approve or perform merge;
- inspect or resolve review threads;
- mutate `active_context.md`, `raw_memory`, or backlog state;
- collect or check off child-hive feedback;
- run from hooks or automatically react to lifecycle transitions;
- accept PR URLs, `--repo`, stdin, `--file`, `--body`, aliases, or mutation flags;
- treat mergeability as a durable expected-state field;
- use main-push CI as proof of PR-head CI;
- query or diagnose individual workflow jobs;
- introduce a dependency or change `.github/workflows/release-gate.yml`.

## 4. Frozen CLI Contract

### 4.1 Syntax

```text
pr-state validate [pr] [--json]
```

Examples through the shipped Node entry point:

```bash
node ./.evo-lite/cli/memory.js pr-state validate 31
node ./.evo-lite/cli/memory.js pr-state validate 31 --json
node ./.evo-lite/cli/memory.js pr-state validate
```

`pr-state` is a top-level command group. `context pr-state ...` is not an alias and must be rejected.

`[pr]`, when present, must match:

```text
^[1-9][0-9]*$
```

It must parse as a JavaScript safe integer. Canonical validation happens before numeric conversion; `parseInt()` acceptance alone is insufficient.

### 4.2 Omitted PR resolution

When `[pr]` is omitted, resolution is deliberately narrow:

```text
current HEAD
  must be attached to exactly one local branch
        ↓
gh pr view for that branch and repository
        ↓
exactly one resolvable PR
```

The following are errors:

- detached HEAD;
- the current branch has no PR;
- resolution is ambiguous;
- repository identity cannot be established.

The validator must not fall back to `gh pr list --limit 1`, the latest-created PR, the latest-updated PR, or any other heuristic.

### 4.3 Output modes

Default output is concise human-readable text. `--json` emits the frozen JSON contract in section 10. JSON is the automation surface; incidental human-readable wording is not a stable API.

No command form accepts content from stdin or writes to stdout for later implicit execution.

## 5. Frozen Expected-State Block

### 5.1 Exact form

```text
<!-- EVO-LITE:PR-STATE:BEGIN -->
schema: 1
base: main
baseSha: 70c173b11ec64896780be67eb6b8bda94d2295fb
head: codex/example
headSha: 0123456789abcdef0123456789abcdef01234567
commits: 3
changedFiles: 4
phase: draft
checks: success
<!-- EVO-LITE:PR-STATE:END -->
```

The block expresses governance expectations. It is not a second copy of GitHub state whose values are trusted for discovery.

### 5.2 Marker grammar

- The marker strings are case-sensitive.
- Each marker must occupy a line by itself with no leading or trailing whitespace.
- Exactly one BEGIN marker and one END marker must exist in the entire body.
- BEGIN must occur before END.
- A second standalone marker anywhere in prose or a code fence is a duplicate-marker error.
- Text outside the two marker lines is otherwise opaque Markdown.
- LF and CRLF line termination are both accepted. The parser removes only the line terminator; it does not trim marker or field lines.

### 5.3 Field grammar

The block contains exactly the nine field lines shown above, in that fixed order.

- The delimiter is exactly `: `.
- Every field occurs exactly once.
- Empty lines, tabs, comments, quoted-scalar syntax, inline comments, unknown keys, duplicate keys, missing keys, reordered keys, and extra content are invalid.
- Values may not contain CR or LF and may not have leading or trailing whitespace.

Scalar rules:

```text
schema
  canonical decimal 1 only

base, head
  must pass: git check-ref-format --branch <value>
  compared case-sensitively with observed GitHub ref names

baseSha, headSha
  ^[0-9a-f]{40}$
  full lowercase SHA only; abbreviations and uppercase are invalid

commits
  canonical decimal integer in 1..2147483647

changedFiles
  canonical decimal integer in 0..2147483647

phase
  draft | ready | merged

checks
  pending | success
```

Canonical decimal syntax is:

```text
0               valid only when the field lower bound permits zero
[1-9][0-9]*      valid
03               invalid
+3               invalid
-1               invalid
3.0              invalid
3e2              invalid
```

### 5.4 Cross-field invariants

`phase: merged` requires `checks: success`.

These combinations are valid:

```text
draft  + pending
draft  + success
ready  + pending
ready  + success
merged + success
```

`merged + pending` is a semantic contract error and must fail before workflow-run acquisition.

Expected `baseSha` and `headSha` are comparison operands only. They must never identify a PR, branch, workflow run, or other observed fact.

### 5.5 Parser pipeline

After the PR body has been obtained from the PR core-facts request, parsing proceeds as follows:

```text
1. marker scan
2. exact block extraction
3. lexical grammar validation
4. fixed field and order validation
5. scalar canonical validation
6. git ref-name syntax validation
7. cross-field semantic validation
```

Any failure ends validation before workflow identity or workflow runs are queried. It returns `result: error`, exit code 2, and performs no mutation.

## 6. Observed PR Core Facts

The validator obtains PR core facts from GitHub for the resolved repository and PR number. The observed source is authoritative for discovery; expected values only participate in comparison.

Required observed facts are:

```text
repository identity
PR number and URL
body
base.ref
base.sha
head.ref
head.sha / headRefOid
commit count
changed-file count
state
draft
merged / merged_at
```

Every required field receives shape and type validation. Missing fields, contradictory lifecycle fields, malformed JSON, command failure, authentication failure, timeout, network failure, HTTP failure, and rate limiting are observation errors. They must not be converted into contract drift.

### 6.1 Phase normalization

```text
OPEN + draft=true + not merged
→ draft

OPEN + draft=false + not merged
→ ready

merged=true / merged_at non-null with a consistent closed state
→ merged

CLOSED + not merged
→ closed
```

Expected phase is limited to `draft | ready | merged`. Observed `closed` is therefore a valid observation that produces `PHASE_DRIFT`, not a parser error.

Contradictory facts, such as `state=OPEN` together with `merged=true`, must not be guessed into a phase. They are observation errors.

## 7. Workflow and Current-Head Checks Contract

### 7.1 Binding identity

Checks observation is bound to all four identity dimensions:

```text
target PR number
workflow path .github/workflows/release-gate.yml
event pull_request
current observed PR head SHA
```

All four must match. A run must explicitly associate the target PR number in its GitHub response. Workflow path, event, and SHA alone are insufficient to infer PR ownership.

The workflow display name is diagnostic only and cannot establish workflow identity.

### 7.2 Discovery order

The validator must:

1. obtain the current observed PR `head.sha` / `headRefOid`;
2. resolve workflow metadata for `release-gate.yml`;
3. require the returned workflow path to equal `.github/workflows/release-gate.yml` exactly;
4. query workflow runs by the resolved numeric workflow ID;
5. consume every result page;
6. filter runs by explicit target PR association, `event=pull_request`, and the current observed head SHA;
7. choose the matching run with the maximum numeric run ID.

GitHub API return order and timestamps do not define newest-run selection. `max(run_id)` does. All run pages must be consumed before selection.

Expected `headSha` must never drive CI discovery. A stale expected SHA can produce `HEAD_SHA_DRIFT`, but CI observation still uses the current observed PR head.

### 7.3 Run normalization

```text
requested | queued | waiting | pending | in_progress
→ pending

completed + conclusion=success
→ success

completed + known non-success conclusion
→ failed

no matching run after a successful complete query
→ missing
```

An unknown status, a completed run with missing or invalid conclusion, a malformed run, or an incomplete/failed query is an observation error.

An older successful run must never override a matching run with a larger run ID that is pending or failed.

### 7.4 Deliberate exclusions

- Main-push runs do not satisfy the PR contract, including for `phase: merged`.
- `phase: merged` still checks the feature-head `pull_request` run.
- Post-merge durable main verification remains a separate governance activity.
- The first release does not call the jobs endpoint.
- Run ID, URL, timestamps, display name, mergeability, and similar details may appear in diagnostics but do not create findings or determine the result.

## 8. Expected-to-Observed Mapping

| Expected field | Observed source | Mismatch finding |
|---|---|---|
| `base` | PR `base.ref` | `BASE_REF_DRIFT` |
| `baseSha` | PR `base.sha` | `BASE_SHA_DRIFT` |
| `head` | PR `head.ref` | `HEAD_REF_DRIFT` |
| `headSha` | PR current head SHA/OID | `HEAD_SHA_DRIFT` |
| `commits` | PR scalar commit count | `COMMIT_COUNT_DRIFT` |
| `changedFiles` | PR scalar changed-file count | `CHANGED_FILE_COUNT_DRIFT` |
| `phase` | normalized lifecycle | `PHASE_DRIFT` |
| `checks` | newest matching current-head run | checks taxonomy below |

Core-field drift does not stop later comparisons. In particular, `HEAD_SHA_DRIFT` does not suppress current-head CI observation.

## 9. Findings and Error Taxonomy

### 9.1 Checks findings

```text
observed missing
→ CHECKS_MISSING

observed pending + expected success
→ CHECKS_PENDING

observed failed
→ CHECKS_FAILED

observed success + expected pending
→ CHECKS_EXPECTATION_DRIFT

observed equals expected
→ no checks finding
```

`CHECKS_MISSING` has one narrow meaning: the workflow and run queries completed successfully, all pages were consumed, and zero runs matched the frozen four-part identity.

It must not represent a missing executable, unauthenticated client, HTTP 401/403, rate limit, timeout, network error, malformed response, workflow identity error, or pagination failure.

### 9.2 Multi-finding accumulation

One run accumulates every reliably established mismatch. Findings have stable schema order:

```text
BASE_REF_DRIFT
BASE_SHA_DRIFT
HEAD_REF_DRIFT
HEAD_SHA_DRIFT
COMMIT_COUNT_DRIFT
CHANGED_FILE_COUNT_DRIFT
PHASE_DRIFT
CHECKS_*
```

Fields without drift are omitted from `findings`.

### 9.3 Error priority

Overall priority is:

```text
error > drift > pass
```

A later observation error may coexist with findings that were already reliably established. Those findings remain in the response, but the result is `error`, exit code 2, because validation is incomplete.

```text
findings
  only reliably established contract mismatches

errors
  failures that prevented complete validation

result:error
  findings, if present, are necessarily incomplete
```

Parser and contract-shape failures are errors, not drift. Operational failures are also errors. Neither may be disguised as a complete drift result.

## 10. Result and JSON Contract

### 10.1 Exit contract

```text
result: pass    exit 0
result: drift   exit 1
result: error   exit 2
```

### 10.2 Fixed envelope

```json
{
  "schema": 1,
  "result": "pass | drift | error",
  "pr": {},
  "expected": {},
  "observed": {},
  "findings": [],
  "errors": []
}
```

All six top-level members are always present. `expected` and `observed` may be partial when an error prevents later stages, but they are never omitted.

A finding contains stable machine fields:

```json
{
  "code": "HEAD_SHA_DRIFT",
  "field": "headSha",
  "expected": "0123456789abcdef0123456789abcdef01234567",
  "observed": "fedcba9876543210fedcba9876543210fedcba98"
}
```

An error contains a stable code and human-readable message. Human-readable messages are not stable matching keys.

`observed.diagnostics` is non-contract information. It must not create a drift finding or decide `result`. The selected run's ID, URL, status, conclusion, and timestamps may be included because they explain the checks observation. Job data is excluded from the first release.

## 11. Read-Only Acquisition and Safety

All process execution uses an executable plus an argument array. No branch name, PR input, ref, SHA, repository name, or URL may be interpolated into a shell command string.

Repository identity is resolved once and explicitly bound to subsequent `gh` calls.

The allowed command families are read-only:

```text
git rev-parse
git symbolic-ref
git check-ref-format
gh repo view
gh pr view
gh api GET
```

The implementation must not invoke `gh pr edit`, `gh pr ready`, `gh pr merge`, a non-GET API mutation, `git commit`, `git checkout`, file writes, or any active-context command.

The validator does not require a clean worktree because it performs no writes. It also does not infer authorization from a passing result.

## 12. Internal Module Boundary

### `pr-state.service.js`

Owns:

- marker and block parsing;
- scalar and cross-field validation;
- phase and checks normalization;
- deterministic field comparison and finding order;
- repository, PR, workflow, pagination, and run acquisition orchestration;
- result precedence;
- dependency-injected Git and `gh` runner interfaces.

It must not own Commander registration or lifecycle authorization.

### `pr-state.js`

Owns:

- the `pr-state validate [pr] [--json]` command registration;
- CLI argument validation routing;
- human-readable and JSON rendering;
- exit-code mapping.

### `memory.js`

Owns registration only. Parser, acquisition, and comparison logic must not be placed in `memory.js`.

## 13. Acceptance Matrix

### A. Marker and line grammar

- exact LF block passes;
- exact CRLF block passes;
- missing BEGIN or END fails before workflow query;
- duplicate marker anywhere in the body fails;
- reversed markers fail;
- leading/trailing marker whitespace fails;
- marker-like inline prose remains opaque;
- blank line, tab, comment, quote syntax, extra line, or malformed delimiter fails.

### B. Fields and scalar grammar

- fixed order succeeds;
- duplicate, unknown, missing, or reordered key fails;
- abbreviated or uppercase SHA fails;
- valid full lowercase SHA succeeds;
- canonical decimal boundaries succeed;
- `03`, `+3`, `-1`, `3.0`, and `3e2` fail;
- invalid Git branch names fail through `git check-ref-format --branch`;
- `merged + pending` fails before workflow query;
- all other frozen phase/check combinations pass parsing.

### C. PR resolution

- canonical explicit PR number bypasses branch discovery;
- omitted PR resolves from exactly one attached current branch;
- detached HEAD fails;
- branch with no PR fails;
- ambiguous resolution fails;
- no latest-PR heuristic is invoked.

### D. Core observation and comparison

- each of the seven core fields produces its exact drift code;
- ref comparison is case-sensitive;
- all simultaneous core mismatches are reported in stable order;
- observed closed-unmerged PR produces `PHASE_DRIFT`;
- contradictory lifecycle facts produce an observation error;
- malformed or incomplete PR JSON produces an observation error.

### E. Current-head CI identity

- expected `headSha` is never present in workflow-query arguments;
- observed current head SHA is always the workflow-query SHA;
- wrong PR number is ignored;
- wrong workflow path is rejected as an identity error;
- wrong event is ignored;
- wrong head SHA is ignored;
- a run without explicit target-PR association is ignored;
- all four identity dimensions are required.

### F. Pagination and newest-run selection

- every page is consumed before selection;
- maximum numeric run ID is selected independent of API order;
- older success plus newer pending does not pass;
- older success plus newer failed does not pass;
- equal timestamps do not affect max-run-ID selection;
- pagination failure is an observation error, not `CHECKS_MISSING`.

### G. Checks taxonomy

- successful complete query with no matching run yields `CHECKS_MISSING`;
- nonterminal current run plus expected success yields `CHECKS_PENDING`;
- completed non-success yields `CHECKS_FAILED`;
- success plus expected pending yields `CHECKS_EXPECTATION_DRIFT`;
- matching pending/pending and success/success yield no checks finding;
- unknown status and completed-without-conclusion yield observation errors.

### H. Result precedence and envelope

- no findings/errors returns pass and exit 0;
- complete observation with findings returns drift and exit 1;
- parser or observation error returns error and exit 2;
- a reliable core finding survives a later workflow-query error;
- that partial response still returns error and exit 2;
- JSON always contains `schema`, `result`, `pr`, `expected`, `observed`, `findings`, and `errors`;
- findings retain frozen order.

### I. Read-only boundary and CLI surface

- fake runners record only the frozen read-only Git and `gh` command families;
- no filesystem write occurs on pass, drift, or error;
- no GitHub mutation occurs on pass, drift, or error;
- `context pr-state`, URL input, `--repo`, stdin, aliases, and mutation flags are rejected;
- `memory.js` contains registration only;
- live/template implementations and tests remain byte-identical;
- full governance and integration regressions pass.

## 14. Expected Implementation Surface

The design-time expected surface is limited to these live/template pairs:

```text
.evo-lite/cli/pr-state.service.js
templates/cli/pr-state.service.js

.evo-lite/cli/pr-state.js
templates/cli/pr-state.js

.evo-lite/cli/memory.js
templates/cli/memory.js

.evo-lite/cli/test/integration.js
templates/cli/test/integration.js
```

This is an expected implementation surface, not a requirement to manufacture changes in all eight files. A future implementation must remain within this set unless a separately reviewed design amendment proves another file necessary.

Not authorized by this design:

```text
new dependencies
workflow changes
active_context changes
raw_memory changes
feedback collection
PR mutation
test harness changes
product source changes
```

## 15. Alternatives Rejected

### Free-text semantic parsing

Rejected because prose has no stable machine grammar and would create false positives and false confidence.

### Automatic PR body synchronization

Rejected because it changes external state, expands authorization, and can overwrite reviewer-owned narrative.

### Expected SHA-driven CI lookup

Rejected because a stale expected SHA could select an old green run and hide current-head CI state.

### Workflow display-name identity

Rejected because display names are not a sufficient durable workflow identity. Exact workflow path is required.

### Latest run by timestamp or API position

Rejected because timestamp ties and unstated API ordering create ambiguity. The maximum numeric run ID is deterministic.

### GitHub Action or hook-only validator

Rejected for the first release because operators need an explicit local, read-only command and lifecycle authorization remains human-owned.

### Offline snapshot input

Rejected for the first release because caller-provided observed facts can be stale and would not solve live PR-state drift.

## 16. Review and Next Gate

After this design spec is committed, work must stop for independent spec-level review.

The following remain unauthorized until a new explicit gate:

```text
implementation plan
runtime or test implementation
Draft PR
Ready or merge actions
active-context mutation
feedback collection
adjacent NEXT scopes
```
