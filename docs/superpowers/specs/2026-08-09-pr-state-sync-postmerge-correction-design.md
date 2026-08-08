# [pr-state-sync-postmerge-correction] Design Amendment

## 0. Status and authorization boundary

Status: **DRAFT / PENDING CORRECTIVE SPEC-LEVEL REVIEW**.

Baseline:

```text
main@23b6b095c853366c07c14590342277604a274246
```

This document amends only the post-merge gaps proven after PR #33. It does not
rewrite or replace
`docs/superpowers/specs/2026-08-08-pr-state-sync-design.md`.

This amendment changes only:

- original section 7.1, PR-to-run binding identity;
- original section 7.2, discovery order;
- original section 7.4, merged-phase evidence mechanics;
- original acceptance groups E, F, G, and I where they exercise that binding;
- PS5 test-runtime cleanup robustness on Windows.

All other original contracts remain frozen. This document does not authorize an
implementation plan, runtime changes, test changes, PR-body mutation,
active-context mutation, or branch deletion.

## 1. Durable incident evidence

### 1.1 Windows Node 24 cleanup failure

The first attempt of post-merge release-gate run `31267393351` passed PS1, PS2,
PS3, and the PS5 real-CLI assertions, but failed in the PS5 `finally` block:

```text
fs.rmSync(runtime.workspaceRoot, { recursive: true, force: true })
-> EPERM, Permission denied
-> .evo-lite/cli/test/integration.js:1601
```

A failed-job-only diagnostic rerun completed successfully. On attempt 2,
Windows Node 24 passed runtime tests, pack, scaffold, and runtime readiness. The
rerun supports a transient Windows cleanup timing failure; it does not erase the
demonstrated zero-retry robustness gap.

### 1.2 Merged-PR association failure

PR #33 retained the correct feature-head pull-request run after merge:

```text
run id       31265842002
event        pull_request
head sha     f049e0e2af07071d65866e72c602b7106011a528
status       completed
conclusion   success
```

After merge, the workflow-run response still contained the run but exposed an
empty `pull_requests` array. The original validator therefore discarded the run
and emitted `CHECKS_MISSING`.

At the same time, the PR-scoped command below still returned all six successful
release-gate check rows, with every row linking to run `31265842002`:

```text
gh pr checks 33 --repo uwence/create-evo-lite \
  --json bucket,event,link,name,state,workflow
```

The commit-to-PR endpoint also continued to associate feature head
`f049e0e2...` with PR #33. That endpoint is diagnostic evidence only and is not
part of the amended checks identity.

## 2. Amendment goals

1. Preserve explicit target-PR association after GitHub clears
   `run.pull_requests` on a merged PR.
2. Preserve the original workflow-path, `pull_request` event, observed-head,
   full-pagination, and maximum-run-ID contracts.
3. Keep checks classification sourced only from the workflow-run API.
4. Keep validation read-only and fail closed on acquisition or parsing errors.
5. Add bounded retry tolerance to the PS5 test-runtime cleanup without hiding a
   persistent handle leak.

## 3. Non-goals

This amendment does not:

- infer PR ownership from a shared commit SHA;
- use the commit-to-PR endpoint as PR-to-run binding evidence;
- use expected `headSha` for discovery;
- accept main-push CI as PR checks evidence;
- classify checks from `gh pr checks` exit status, `bucket`, `state`, or
  `workflow` display name;
- query individual jobs to determine the checks result;
- change the expected-state block grammar or finding taxonomy;
- mutate a PR body, PR phase, branch, active context, or raw memory;
- catch or suppress a persistent cleanup failure;
- add a general-purpose filesystem retry subsystem.

## 4. Amended PR-to-run binding identity

### 4.1 Two-sided proof

A workflow run belongs to the target PR if and only if both halves below are
true.

PR-scoped association proof:

```text
gh pr checks <target PR number>
-> same-repository GitHub Actions run/job link
-> numeric run ID in PR_SCOPED_RUN_IDS
```

Workflow-run identity proof:

```text
run.id       is in PR_SCOPED_RUN_IDS
run.event    equals pull_request
run.head_sha equals the current observed PR head SHA
run          comes from the exact frozen release-gate workflow identity
```

`run.pull_requests` is no longer a binding requirement. Its presence, absence,
or contents cannot add or remove a matching run.

The PR-scoped probe supplies only PR-to-run-ID association. The workflow-run API
continues to supply workflow, event, head identity, ordering, status, and
conclusion.

### 4.2 Frozen PR-scoped command

The acquisition command is exactly the nested, read-only CLI surface:

```text
gh pr checks <PR_NUMBER>
  --repo <RESOLVED_REPOSITORY>
  --json bucket,event,link,name,state,workflow
```

`PR_NUMBER` is the same target PR already resolved by the validator.
`RESOLVED_REPOSITORY` is the same repository identity used for the remaining
GitHub observations. The command must not discover or substitute another PR.

### 4.3 PR-scoped JSON and exit contract

The command output must be a valid JSON array. Every array element must be an
object containing the requested fields with string values. The association
parser uses only `link`; the other fields remain diagnostics and do not classify
the run.

Exit handling is frozen as follows:

```text
exit 0 + valid JSON array
-> usable PR-scoped association observation

exit 1 + valid JSON array
-> usable PR-scoped association observation

exit 8 + valid JSON array
-> usable PR-scoped association observation

exit 2 or 4
-> operational error

any other exit
-> operational error

any exit + missing or malformed JSON
-> operational error
```

Exit `1` and exit `8` do not mean failed or pending to the validator. They only
permit the returned association rows to be consumed. Final checks state remains
derived from the selected workflow run.

### 4.4 Accepted link identity

The parser must use URL parsing, not substring matching. A row contributes a run
ID only when its `link` is a GitHub Actions run or job URL for the resolved
repository:

```text
https://<resolved GitHub host>/<owner>/<repo>/actions/runs/<run_id>
https://<resolved GitHub host>/<owner>/<repo>/actions/runs/<run_id>/job/<job_id>
```

The following rules apply:

- host and repository must identify the resolved repository;
- `run_id` and optional `job_id` must be canonical positive decimal integers;
- no alternate path shape, credentials, query string, or fragment is accepted;
- multiple job links for one run are deduplicated by numeric run ID;
- a well-formed check row with a nonqualifying link contributes no association;
- malformed row structure is an operational observation error.

Ignoring a nonqualifying link is not permission to infer ownership from the
remaining workflow-run fields. If no accepted run ID intersects the workflow-run
query, the normal `CHECKS_MISSING` contract applies.

## 5. Amended discovery order

After the original expected-block parser and semantic validation succeed, the
validator must:

1. resolve the target repository and PR;
2. obtain the current observed PR head SHA;
3. resolve the numeric workflow ID and require the exact path
   `.github/workflows/release-gate.yml`;
4. execute the frozen PR-scoped checks command for that target PR;
5. validate its exit status and JSON envelope;
6. parse and deduplicate accepted same-repository Actions run IDs into
   `PR_SCOPED_RUN_IDS`;
7. query workflow runs by the resolved numeric workflow ID, `event=pull_request`,
   and the current observed PR head SHA;
8. consume every workflow-run result page;
9. retain only runs whose numeric ID is in `PR_SCOPED_RUN_IDS`, whose event is
   `pull_request`, and whose head SHA is the observed current head;
10. select the retained run with the maximum numeric run ID;
11. normalize that selected workflow run using the original checks contract.

Expected `headSha` remains only a comparison operand. It must never appear in
the PR-scoped or workflow-run discovery arguments.

API order, timestamps, check-row order, duplicate job links, display names, and
`run.pull_requests` do not affect newest-run selection.

## 6. Merged-phase evidence

The amended association mechanism applies to `draft`, `ready`, and `merged`
phases. It is not a merged-only fallback.

For `phase: merged`:

- the selected evidence remains the feature-head `pull_request` run;
- main-push release-gate runs remain excluded;
- post-merge durable main CI remains a separate governance gate;
- PR-scoped check links establish PR-to-run association even when the workflow
  run's `pull_requests` array is empty.

No legal expected-state block may write `checks: missing` or use
`merged + pending`. The amendment restores the possibility of a valid
`phase: merged / checks: success` body when the feature-head PR run succeeded.

## 7. Checks findings and operational errors

The original checks taxonomy is preserved:

```text
no associated matching run after successful acquisition
-> CHECKS_MISSING

selected run nonterminal while expected checks is success
-> CHECKS_PENDING

selected run completed with non-success conclusion
-> CHECKS_FAILED

selected run success while expected checks is pending
-> CHECKS_EXPECTATION_DRIFT
```

The following remain operational errors rather than findings:

- unusable `gh pr checks` exit status;
- missing, malformed, or structurally invalid PR-scoped JSON;
- workflow resolution or exact-path failure;
- any workflow-run page acquisition failure;
- unknown selected-run status;
- completed selected run without a usable conclusion.

Error-over-drift-over-pass precedence and multi-finding accumulation remain
unchanged.

## 8. Read-only boundary

The new probe is read-only. It must not be replaced by a command that edits a
PR, reruns checks, changes readiness, merges, comments, or updates a body.

Commit-to-PR lookup may be retained as a manual diagnostic, but the validator
must not call it for checks identity. No URL returned by `gh pr checks` is opened
or followed; the link is parsed locally only.

## 9. PS5 bounded Windows cleanup amendment

The PS5 real-CLI acceptance block must clean its temporary runtime with the
following exact bounded call:

```js
fs.rmSync(runtime.workspaceRoot, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
});
```

This contract:

- uses only Node's built-in recursive removal retry behavior;
- tolerates only the transient removal errors supported by that API;
- bounds additional delay to five retries with a 100 ms linear retry delay;
- adds no catch block and does not swallow the terminal error;
- keeps a persistent handle leak release-gate-fatal after retries are exhausted;
- applies only to the PS5 temporary runtime cleanup proven flaky by run
  `31267393351`.

It does not change product runtime cleanup, the temp-root lifecycle harness, or
other integration-test cleanup sites.

## 10. Corrective acceptance matrix

### A. PR-scoped association acquisition

- exits `0`, `1`, and `8` with valid arrays are consumed;
- exits `2`, `4`, and any unrecognized exit are operational errors;
- malformed, missing, non-array, or structurally invalid JSON is an operational
  error for every exit status;
- `bucket`, `state`, `event`, and workflow display name never classify final
  checks state;
- the target PR number and resolved repository are present in the exact command;
- no mutating GitHub command is called.

### B. Link parsing and run-ID association

- same-repository run URLs are accepted;
- same-repository job URLs are accepted and yield their parent run ID;
- multiple job rows for one run deduplicate to one numeric run ID;
- wrong host, wrong repository, malformed URL, non-Actions path, query string,
  fragment, noncanonical run ID, and noncanonical job ID do not associate a run;
- nonqualifying well-formed rows are ignored without creating ownership;
- malformed row structure is an operational error;
- empty usable arrays and arrays with no qualifying links can yield
  `CHECKS_MISSING`, not an acquisition error.

### C. Workflow intersection and current-head identity

- a workflow run matches only when its ID is PR-scoped and its workflow, event,
  and observed head SHA all match;
- an empty `run.pull_requests` array does not disqualify a run;
- a populated `run.pull_requests` array cannot qualify an otherwise unrelated
  run;
- expected `headSha` never drives either acquisition path;
- wrong event, wrong head, wrong workflow, or unassociated run ID is ignored;
- main-push runs never satisfy the PR checks contract.

### D. Pagination and newest-run selection

- every workflow-run page is consumed before selection;
- maximum numeric run ID wins independent of API, row, or timestamp order;
- duplicate job links do not duplicate candidates;
- older success plus newer associated pending yields pending;
- older success plus newer associated failed yields failed;
- pagination failure remains an operational error.

### E. Merged lifecycle regression

- a merged PR with empty workflow-run `pull_requests`, six PR-scoped job links,
  and a successful exact-head run validates `checks: success`;
- the same fixture with `phase: ready` emits only `PHASE_DRIFT` after merge;
- after the body expects `phase: merged`, the fixture can pass with no checks
  finding;
- commit-to-PR acquisition is not invoked;
- post-merge main-push success is neither queried nor used.

### F. Checks taxonomy

- successful association and workflow acquisition with no intersection yields
  `CHECKS_MISSING`;
- selected pending, failed, and success runs retain the original finding rules;
- PR-scoped CLI exit `1` or `8` never overrides selected-run normalization;
- errors still outrank accumulated drift findings.

### G. Windows PS5 cleanup

- the PS5 cleanup uses `recursive`, `force`, `maxRetries: 5`, and
  `retryDelay: 100` exactly;
- a transient supported removal error may be retried and then succeed;
- retry exhaustion still propagates the removal error and fails the suite;
- no catch-and-ignore behavior is introduced;
- no unrelated cleanup site changes.

### H. Mirror, scope, and regression

- live/template service changes are byte-identical;
- live/template integration changes are byte-identical;
- the full governance and integration suites pass;
- Windows Node 22 and 24 release-gate coverage passes;
- original parser, phase, finding, JSON-envelope, and read-only acceptance remains
  green.

## 11. Expected corrective implementation surface

Exactly four files are expected:

```text
.evo-lite/cli/pr-state.service.js
templates/cli/pr-state.service.js

.evo-lite/cli/test/integration.js
templates/cli/test/integration.js
```

No change is expected in:

- `pr-state.js`;
- `memory.js`;
- `template-manifest.js`;
- `test.js` or `test/harness.js`;
- `sync-runtime.js`;
- workflows or package/dependency files;
- active context or raw memory;
- product source.

Any implementation need outside the four-file surface requires a reviewed
design amendment before that file is changed.

## 12. Alternatives rejected

### Keep `run.pull_requests` as a hard requirement

Rejected because GitHub clears that association after merge while retaining the
correct feature-head run.

### Accept workflow/event/SHA without PR-scoped evidence

Rejected because a shared head commit is not sufficient proof that a run belongs
to the target PR.

### Use commit-to-PR as checks identity

Rejected because a commit may be associated with multiple PRs. The endpoint is
diagnostic only.

### Infer checks state from `gh pr checks`

Rejected because the PR-scoped command supplies association, while the existing
workflow-run normalization remains authoritative for pending, success, and
failure.

### Treat the successful rerun as closure

Rejected because the first post-merge attempt already proved that the new PS5
cleanup can make the release gate flaky.

### Catch and suppress cleanup failures

Rejected because persistent leaks must remain visible and release-gate-fatal.

## 13. Next gate

After an ordinary docs-only commit and push, this amendment must receive an
independent corrective spec-level review.

Until that review approves and freezes this amendment:

```text
implementation plan       NOT AUTHORIZED
runtime/test changes      NOT AUTHORIZED
PR #33 body mutation      NOT AUTHORIZED
active_context/raw_memory NOT AUTHORIZED
feature branch deletion  NOT AUTHORIZED
durable closure          FROZEN
```
