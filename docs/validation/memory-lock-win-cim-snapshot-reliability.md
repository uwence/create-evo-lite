# `[memory-lock-win-cim-snapshot-reliability]` — Phase 1 investigation

Status: **Phase 1 — observation only. No production code changed, no fix proposed.**

Scope of this document: record what is established, what is ruled out, and what
Phase 1 must measure. It deliberately stops short of a remedy.

## The failure

`T-lock-ident` asserts that the runtime can take a snapshot of its own process:

```js
const self = lock.getProcessSnapshot(process.pid);
assert.ok(self && self.alive === true, 'self snapshot alive');
```

On Windows this goes through `powershell.exe -NoProfile -NonInteractive -Command`
running `Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"`, with
`execFileSync` given `timeout: 10000`.

Observed failure: `actual: null`, `expected: true`.

## What is established

**The command reached its timeout.** Measured from the job logs, between the
`T-lock-ident` banner and the assertion failure:

| run | attempt | elapsed |
|---|---|---|
| `30694812371` | 1 | 10.123 s |
| `30694812371` | 2 | 10.020 s |

Both land on the 10 000 ms boundary. This is the strongest supported statement
and it is *not* the same as "CIM returned an empty row".

**Nothing narrower can be read from existing logs**, because
`getProcessSnapshot()` folds all of the following into one `null`:

```
powershell spawn failure
timeout
nonzero exit
empty stdout
JSON parse failure
empty CIM row
```

That collapse is why Phase 1 exists.

## What is ruled out

**Rerunning does not clear it, and "same bad machine" does not explain it.**
The two consecutive failures ran on different workers:

```
attempt 1   worker 213b4c51-...   region westus
attempt 2   worker b9bf56bb-...   region westus3
common      image windows-2025-vs2026, version 20260728.188.1
```

**The `push` event is not the cause.** I proposed this after the first data
points and it is now falsified:

| run | head | event | windows/node24 |
|---|---|---|---|
| `30693929859` | `f4183e9` | pull_request | pass (first attempt) |
| `30694812371` | `201ba1a` | push | fail, fail |
| `30695844354` | `9adfa9a` | pull_request | pass (first attempt) |
| `30696025798` | `a2a809f` | push | **pass (first attempt)** |

A `push` run passes on first attempt. The event type is not a causal variable.

**It is not a Node version.** The defect has now hit node 22 (`30690469066`) and
node 24 (`30694812371`).

**It is not a production fail-open.** `null` degrades to `unknown` / report-only;
no process is terminated on an unconfirmed snapshot. This remains an
availability and gate-reliability defect, not a safety defect.

**It is not a Task 5 regression.** Task 5 changed error *classification* and the
`memory-ab` entry gate. `getProcessSnapshot` is untouched, and the same product
content passed windows 22 and 24 on first attempt in `30693929859`.

## The actual shape of the fault

Failures are **persistent within a single run** (both attempts of `30694812371`)
but **not persistent across runs** (the next `push` run was green). Combined
with the different-worker evidence, the working hypothesis is:

> The PowerShell/CIM query chain has a long latency tail that varies across
> runners, and in some executions it exceeds the 10 s budget.

This is a hypothesis, not a conclusion. Phase 1 must locate the latency before
anyone proposes a remedy.

## Phase 1 results — the defect reproduced twice with instrumentation attached

Both reproductions: `release-gate`, `pull_request`, windows-latest / node 24,
runner reporting `COMPUTERNAME=runnervmr7g38`, image
`windows-2025-vs2026 / 20260714.173.1`, first attempt, no rerun. Different
workers and Azure regions. **A shared `COMPUTERNAME` is not proof of a shared
VM** and is not treated as one.

### Observation (measured, not interpreted)

**Capture 1 — run `30739096026`, head `3ff0d4d`**

```text
08:06:25.368   T-lock-ident banner
08:06:35.871   diagnostic D1 starts          -> the production call consumed 10.503 s
08:06:43.603   assertion fails
```

`powershell.exe` invocations on that runner, in order:

| # | caller | command | elapsed | result |
|---|---|---|---|---|
| 1 | production `getProcessSnapshot` | CIM production query | **> 10 000 ms** | killed at the timeout, `null` |
| 2 | diagnostic D1 | **the identical command** | **5 510.9 ms** | OK, correct row for pid 2232 |
| 3 | diagnostic D2 | `Write-Output "alive"` (no CIM) | 243.7 ms | OK |
| 4 | diagnostic D3 | `Get-Process -Id` (no CIM) | 383.2 ms | OK |
| 5 | diagnostic D4 | minimal CIM query | 344.0 ms | OK |
| 6-9 | `pwsh.exe` comparison | all four | 269-352 ms | OK |

**Capture 2 — run `30739383132`, head `f640755`**

```text
08:15:09.016   T-lock-ident banner
08:15:19.035   diagnostic D1 starts          -> the production call consumed 10.019 s
```

| # | caller | command | elapsed | result |
|---|---|---|---|---|
| 1 | production `getProcessSnapshot` | CIM production query | **10 019 ms** | killed at the timeout, `null` |
| 2 | diagnostic D1 | **the identical command** | **1 427.2 ms** | OK, correct row for pid 8332 |
| 3 | diagnostic D2 | `Write-Output "alive"` (no CIM) | 343.7 ms | OK |
| 4 | diagnostic D3 | `Get-Process -Id` (no CIM) | 741.0 ms | OK |
| 5 | diagnostic D4 | minimal CIM query | 484.2 ms | OK |

The two captures differ in a way that matters: the immediate follow-up cost was
5 511 ms in the first and 1 427 ms in the second.

**Capture 3 — run `30749412658`, head `f9fae8b`, PR #12, docs-only**

```text
13:13:06.728   T-lock-ident banner
13:13:16.747   assertion fails               -> the production call consumed 10.019 s
```

No Phase 1 instrumentation: that branch was cut from `main@a2a809f`, which
predates it. Runner image `windows-2025-vs2026 / 20260728.188.1` — a *different*
image from the two instrumented captures.

This capture cannot narrow the PowerShell internals any further. What it does
establish:

```text
the defect reproduces on a docs-only PR touching no code at all
it is unrelated to the PR #11 instrumentation
image 20260728.188.1 reproduces it too, not only 20260714.173.1
release-gate uncertainty is now high enough to redden a design-document PR
```

### How the failing call may and may not be described

Strictly:

> The direct external manifestation of the failure is a **timeout**. There is no
> evidence supporting a classification of `no-row`, `parse-error` or
> `nonzero-exit`. The identical command succeeding afterwards shows that the
> query and the PID still work *after* the reproduction — but the terminated
> first call cannot be observed retroactively, so whether it had already
> produced partial stdout is unknown.

It must **not** be written as "the follow-up succeeded, therefore every other
internal state of the first call is logically excluded". Succeeding later says
nothing about what the killed process had already done.

Healthy runners, corrected D1-first ordering (runs `30739094738` push and
`30739096038` pull_request, 4 jobs × 3 checkpoints):

```text
clean-runner    D1  3294 / 3311 / 3447 / 3184 ms      D2-D4  190-421 ms
after-install   D1   309 -  401 ms                    D2-D4  207-350 ms
after-tests     D1   329 -  462 ms                    D2-D4  204-365 ms
```

Original D2-first ordering, first invocation was a bare `Write-Output` with no
CIM at all (run `30696641425`): **1 949 ms and 2 403 ms**.

### Inference (supported by the above, still inference)

**The dominant cost is first-invocation warm-up, not the CIM query itself.** The
same command costs about ten times more as invocation #1 than as invocation #4:
D1 is 3 184-3 447 ms cold and 309-462 ms warm. Warm CIM (D4, 344 ms) and warm
non-CIM (D2, 244 ms) are the same order of magnitude, so a CIM query is not
inherently expensive here.

**Both layers appear to contribute to the cold cost.** Cold host startup *alone*
— a first invocation doing no CIM — measured 1.9-2.4 s. Cold host *plus* CIM
measured 3.2-3.4 s. The difference of roughly 0.8-1.4 s is attributable to CIM
first-use on top of host startup. This is a cross-run comparison between two
probe orderings, not a controlled experiment, and should be treated as
indicative only.

**The evidence is consistent with a cold-start or first-use latency tail.** The
tail can exceed the 10-second production budget and may persist into one
immediate follow-up invocation, but **its multiplier and duration are not
stable**: the follow-up cost was 5 511 ms in the first capture and 1 427 ms in
the second, against a healthy first-invocation baseline of 3 184-3 447 ms. An
earlier draft of this document described the failure as "the same curve, roughly
three times slower"; the second capture does not support a stable scaling factor
and that wording is withdrawn. What both captures share is only this: the first
invocation exceeded the budget, and the same command succeeded shortly after.

### Not established

- **Why some runners exhibit the tail.** Image, region and worker vary; none has
  been isolated. Nor is the size of the tail predictable.
- **Which layer the production timeout belongs to.** The vocabulary asks for one
  of `POWERSHELL_SPAWN_TIMEOUT` / `CIM_QUERY_TIMEOUT` /
  `POWERSHELL_PARTIAL_STDOUT_TIMEOUT`, and this evidence does not settle it.
  `getProcessSnapshot()` discards the timed-out command's streams, and the
  diagnostic necessarily runs afterwards in a *new* process — so the production
  call's own partial-output state remains unobservable.

  Stated precisely, because an earlier draft of this bullet did not:

  > The only terminal classification this failure supports is **timeout**.
  > `no-row`, `parse-error` and `nonzero-exit` are not classifications the
  > current logs support as the terminal state. But the later success **cannot
  > retroactively prove** that the terminated first call never passed through
  > those states internally, nor that it produced no partial stdout.

  The earlier wording — "all ruled out, because the identical command succeeded
  seconds later" — reintroduced exactly the reasoning withdrawn two paragraphs
  above. Succeeding later describes the machine after the fact; it says nothing
  about what the killed process had already done.
- **Whether `pwsh` would be immune.** It was never measured as a first
  invocation — every `pwsh` number above was taken after `powershell.exe` had
  already warmed the machine. The `pwsh` figures say nothing about its cold cost.
- **Any remedy.** Out of scope for Phase 1.

### Checkpoint validity

```text
run 30696641425  clean-runner    data valid, ORDER-CONFOUNDED (D2 first)
                 after-install   data valid, ORDER-CONFOUNDED
                 after-tests     measurement valid, CHECKPOINT SEMANTICS INVALID
                                 — npm test died on a missing better-sqlite3, so
                                   this did not measure a post-suite machine;
                                   excluded from causal conclusions
run 30739094738  all three       valid, D1-first
run 30739096038  all three       valid, D1-first
run 30739096026  failure-site diagnostic — capture 1
run 30739383132  failure-site diagnostic — capture 2
run 30749412658  capture 3, NO instrumentation (branch predates it) — timing
                 only; usable for "it still reproduces", not for locating a layer
```

### A hypothesis of mine, falsified by this data

After the first ordering I wrote that PowerShell host startup dominates and CIM
adds only 50-250 ms. That reading came from `D2 > D3 > D4 > D1` on a clean
runner, which is exactly the probe execution order — an order effect, not a
finding. With D1 first the picture inverts: the *first* call is expensive
whatever it is, and CIM's own contribution is visible only by comparing the two
orderings.

## Local baseline (healthy Windows host)

`node scripts/diagnostics/memory-lock-cim-snapshot.js --label local-smoke`,
Windows 11 10.0.26200, Node v22.22.2:

```
D2 powershell startup     185 ms   OK
D3 Get-Process control    221 ms   OK
D4 CIM minimal            733 ms   OK
D1 production replica     711 ms   OK
```

CIM costs roughly half a second more than `Get-Process` here — three orders of
magnitude away from the boundary. Whatever happens on the failing runners is not
the normal cost of this query. Local results are an environment control only;
they cannot stand in for GitHub runner evidence.

## What Phase 1 measures

`scripts/diagnostics/memory-lock-cim-snapshot.js` records, per command:

```
command id, host executable, arguments, pid,
start timestamp, elapsed ms, timeout,
status, signal, error.code, error.errno, error.message,
stdout bytes, stderr bytes, stdout/stderr prefix+suffix,
JSON parse result, row ProcessId
```

plus a whitelisted runner and workflow identity block (`RUNNER_NAME`,
`COMPUTERNAME`, `ImageOS`, `ImageVersion`, run id / attempt / event / sha …).
The full environment is never dumped: it carries tokens and credentialed paths.

Four probes, run against `powershell.exe` (production host) and `pwsh.exe`
(comparison only — nothing here proposes switching production to it):

| probe | command | what it separates |
|---|---|---|
| D1 | exact production replica | the baseline being explained |
| D2 | `Write-Output "alive"` | PowerShell startup alone |
| D3 | `Get-Process -Id <pid>` | same pid, same host, no CIM |
| D4 | `Get-CimInstance … Select ProcessId` | CIM lookup without the CommandLine/CreationDate projection |

Reading the matrix:

```
D2 slow                  -> the host process itself is slow to start
D2 fast, D3 fast, D4 slow -> CIM lookup / provider
D2 fast, D3 fast, D4 fast, D1 slow -> the CommandLine / CreationDate projection
partial stdout + timeout -> the query began answering and the process never exited
```

Every probe result is classified into exactly one of:

```
OK
POWERSHELL_SPAWN_TIMEOUT
POWERSHELL_NONZERO_EXIT
POWERSHELL_EMPTY_STDOUT
POWERSHELL_PARTIAL_STDOUT_TIMEOUT
CIM_NO_ROW
CIM_QUERY_TIMEOUT
JSON_PARSE_FAILURE
PID_NOT_FOUND_DESPITE_ALIVE
OTHER_WITH_EVIDENCE
```

## Where the evidence is collected

**At the failure site.** `T-lock-ident` now emits `CIM_SNAPSHOT_DIAG=<json>` when
the snapshot is null on win32, and then **fails exactly as before**. It does not
retry `getProcessSnapshot`, does not pass because the diagnostic succeeded, is
not downgraded to a warning, does not skip Windows, and does not extend the
timeout. CI stays honestly red; the log now says which layer is red.

**On a schedule of three time points.** `.github/workflows/memory-lock-cim-diagnostic.yml`
runs the diagnostic on a clean runner, after `npm ci`, and **after the suite
attempt**, on windows-latest with node 22 and 24. `release-gate.yml` is
untouched. The suite's exit code is preserved and re-applied so the diagnostic
job does not paper over a failure.

"After the suite attempt" is the precise name: it means the `npm test` process
has exited. It does **not** promise that every test ran — the suite can die
early, and in run `30696641425` it did.

The workflow is a **temporary asset**. Per design decision D5 it is **not** to be
merged into `main`; the diagnostic script and the failure-site output are kept,
the automatic workflow is not. It must not be left
attached to every pull request.

## Explicitly not done in Phase 1

```
increasing the timeout
retrying inside getProcessSnapshot
treating null as alive
downgrading T-lock-ident to a warning
removing the Windows integration test
skipping by Node version
switching production to pwsh
```

Each of these would hide the measurement Phase 1 exists to take. The eventual
goal is to separate the **deterministic identity contract** from the **Windows
CIM integration availability probe**, so that a slow runner degrades one without
destroying the other — but which of them to change, and how, is not a Phase 1
decision.

## Evidence ledger

```
PR run 30693929859    first-attempt 5/5
main@201ba1a          attempt 1 and 2 both 4/5, CIM defect on windows/node24
main@a2a809f          first-attempt 5/5
Task 5 closure        complete (qualified on the successor main)

PR run 30696673451    release-gate first-attempt 5/5 — instrumentation itself is not a regression
run 30696641425       diagnostic, FAILED on a missing better-sqlite3 (my workflow defect, not the CIM defect)
run 30696673453       same defect, same cause
run 30739094738       diagnostic, push, 2/2 pass, D1-first data
run 30739096038       diagnostic, pull_request, 2/2 pass, D1-first data
run 30739096026       release-gate, pull_request, 4/5 — first instrumented reproduction
run 30739383132       release-gate, pull_request, 4/5 — second instrumented reproduction
run 30749412658       release-gate, pull_request, 4/5 — PR #12, docs-only, no
                      instrumentation, image 20260728.188.1, ~10.019 s -> null
run 30750019232       release-gate, pull_request, first-attempt 5/5 — PR #12
                      head 1c28467, docs-only, windows/node24 SUCCESS

CIM defect            active and unresolved
Phase 1               accepted; PR #11 stays Draft, frozen at four commits,
                      as an evidence instrument rather than a change to merge
Phase 2               A1 adopted, A2 deferred; D1-D6 frozen in the design
```

`30694812371`, `30739096026`, `30739383132` and `30749412658` are preserved as
failure evidence and are not rerun.

Both instrumented reproductions are `pull_request` runs. That closes the
event-type question for good: the defect has now been observed on both event
types, and both event types have also passed.

**The strongest form of "unrelated to the code under test":** `30749412658` and
`30750019232` are adjacent commits on the same branch, both docs-only. Product
code, test code and workflows are byte-identical between them. One is red on
windows/node24, the next is green. Nothing in the repository changed the
outcome — and this also re-confirms that the tail is not persistent across runs.

This closes the evidence ledger for the current failure mode. Further runs are
recorded in the pull-request description, not by amending this document; only a
**new failure type** warrants another evidence commit.

## Phase 3A — what was implemented

Contract only. CI run numbers for the implementation branch live in its pull
request, not here: recording them would mean a commit that triggers a run whose
result then needs another commit, and the record would always trail the final
head by one.

### The classification

```text
1  pidAlive false                          -> dead            (no command is issued)
2  err.code === 'ETIMEDOUT'                -> timeout         (the ONLY criterion)
3  err.code === 'ENOENT'                   -> spawn-error
4  any other error, or status !== 0        -> nonzero-exit    (incl. SIGTERM without ETIMEDOUT)
5  clean exit, blank stdout                -> empty-output
6  non-empty stdout that will not parse    -> parse-error
7  parses, but no result row               -> no-row
8  row present, identity field invalid     -> invalid-row
9  complete and valid                      -> alive
```

`SIGTERM` alone is deliberately **not** a timeout: an external kill looks
identical, and `timeout` is the one reason the gate forgives.

Transport asymmetry, by construction rather than by test omission:

```text
parse-error   reachable only through the win32 JSON transport
no-row        reachable only through win32 null / []
posix         blank stdout -> empty-output; anything not matching the ps line
              shape -> invalid-row
```

Every unavailable reason is covered independently of transport by the
seam-injected fail-closed matrix.

### The safety contract, unchanged

`unavailable` still maps to `unknown` / report-only at both entries, and no
reason value adds a path toward killing anything. `getProcessSnapshot` keeps its
exported behaviour: the old snapshot for alive and dead, `null` for unavailable.

### The CI contract — the actual point

`T-lock-ident` is split into two blocks that cannot compensate for each other:

```text
availability block          talks to the real machine
  alive                     -> strict field validation
  unavailable / timeout     -> emit CIM_SNAPSHOT_DIAG, do NOT fail
  any other reason          -> fail

deterministic safety block  seam-injected, always runs
  unavailable -> unknown / report-only, kill count 0, owner intact
```

Verified locally that the tolerance is narrow rather than nominal: with the
result forced, `timeout` is tolerated and produces an eight-probe diagnostic,
while `spawn-error`, `nonzero-exit`, `empty-output`, `parse-error`, `no-row` and
`invalid-row` are each rejected.

**Success is not the defect disappearing.** The external tail is still there and
this repository cannot remove it. Success is that the same tail event no longer
presents as a deterministic code failure. If `T-lock-ident` reddens on a
`timeout` after this, the split did not take effect — an implementation defect,
not an environment one.

### Diagnostic asset

`scripts/diagnostics/memory-lock-cim-snapshot.js` is extracted from PR #11 by
path, not by cherry-picking its commits, because those commits also carry
`.github/workflows/memory-lock-cim-diagnostic.yml`, which per design decision D5
must never reach `main`. The script now runs from the failure site only; there is
no automatic diagnostic workflow.

## Where this leaves Phase 2

The question Phase 2 has to answer is not "how do we make PowerShell faster".
It is:

> How do we separate the **deterministic process-identity safety contract** from
> the **non-deterministic availability of an external Windows query**, in the
> code and in the CI semantics?

The safety behaviour is already correct — an unconfirmed snapshot degrades to
`unknown` / report-only and never authorises terminating a process. What is
wrong is that a runner-availability event is indistinguishable, to both the
caller and the gate, from a deterministic code failure.

Design work is authorized; production changes are not.
