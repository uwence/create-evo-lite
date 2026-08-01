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
runs the diagnostic on a clean runner, after `npm ci`, and after the full test
sequence, on windows-latest with node 22 and 24. `release-gate.yml` is untouched.
The suite's exit code is preserved and re-applied so the diagnostic job does not
paper over a failure.

The workflow is a **temporary asset**. It must be deleted, or converted into a
stable low-noise probe, before the investigation closes — it must not be left
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
CIM defect            active and unresolved
```

`30694812371` is preserved as failure evidence and is not rerun again.
