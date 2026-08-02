'use strict';
// [memory-lock-win-cim-snapshot-reliability] Phase 1 — observation only.
//
// PURPOSE
// getProcessSnapshot() folds six distinct failure modes into one `null`:
// powershell spawn failure, timeout, nonzero exit, empty stdout, JSON parse
// failure, and an empty CIM row. On Windows GitHub runners that null has twice
// blocked the release gate at T-lock-ident, and the elapsed time (10.123s and
// 10.020s) landed on the production execFileSync `timeout: 10000`. That tells
// us the command reached its timeout — and nothing beyond that.
//
// This script does NOT fix anything and does NOT touch production behaviour.
// It answers exactly one question: WHERE do those ten seconds go?
//
// It never terminates a process, never opens a Zvec collection, never runs a
// native fixture, and never changes CIM/WMI or system policy. It queries only
// its own pid (or an explicitly passed one) and reads a whitelist of runner
// identity variables — never the full environment.

const childProcess = require('child_process');
const os = require('os');

const TIMEOUT_MS = 10000;               // the production boundary, deliberately unchanged
const STREAM_SAMPLE = 400;              // bytes kept from each end of a stream

// ---------------------------------------------------------------------------
// Classification vocabulary — every probe result maps to exactly one of these.
// ---------------------------------------------------------------------------
const CLASS = {
    OK: 'OK',
    POWERSHELL_SPAWN_TIMEOUT: 'POWERSHELL_SPAWN_TIMEOUT',
    POWERSHELL_NONZERO_EXIT: 'POWERSHELL_NONZERO_EXIT',
    POWERSHELL_EMPTY_STDOUT: 'POWERSHELL_EMPTY_STDOUT',
    POWERSHELL_PARTIAL_STDOUT_TIMEOUT: 'POWERSHELL_PARTIAL_STDOUT_TIMEOUT',
    CIM_NO_ROW: 'CIM_NO_ROW',
    CIM_QUERY_TIMEOUT: 'CIM_QUERY_TIMEOUT',
    JSON_PARSE_FAILURE: 'JSON_PARSE_FAILURE',
    PID_NOT_FOUND_DESPITE_ALIVE: 'PID_NOT_FOUND_DESPITE_ALIVE',
    OTHER_WITH_EVIDENCE: 'OTHER_WITH_EVIDENCE',
};

// Whitelist only. Dumping process.env would leak tokens and credentialed paths.
const RUNNER_KEYS = ['RUNNER_NAME', 'RUNNER_OS', 'RUNNER_ARCH', 'RUNNER_ENVIRONMENT',
    'ImageOS', 'ImageVersion', 'COMPUTERNAME'];
const GITHUB_KEYS = ['GITHUB_RUN_ID', 'GITHUB_RUN_NUMBER', 'GITHUB_RUN_ATTEMPT', 'GITHUB_JOB',
    'GITHUB_EVENT_NAME', 'GITHUB_SHA', 'GITHUB_REF', 'GITHUB_HEAD_REF', 'GITHUB_WORKFLOW_REF'];

function pick(keys) {
    const out = {};
    for (const key of keys) {
        if (process.env[key] !== undefined) out[key] = process.env[key];
    }
    return out;
}

function sample(buf) {
    const text = String(buf === undefined || buf === null ? '' : buf);
    if (text.length <= STREAM_SAMPLE * 2) return { prefix: text, suffix: '' };
    return { prefix: text.slice(0, STREAM_SAMPLE), suffix: text.slice(-STREAM_SAMPLE) };
}

// One measured execution. Every field the failure could hide behind is recorded
// — "success/failed" is exactly the granularity that got us stuck.
function runCommand(id, exe, args, options = {}) {
    const startedAt = new Date();
    const t0 = process.hrtime.bigint();
    let status = null;
    let signal = null;
    let error = null;
    let stdout = '';
    let stderr = '';
    try {
        const res = childProcess.spawnSync(exe, args, {
            encoding: 'utf8',
            timeout: options.timeout === undefined ? TIMEOUT_MS : options.timeout,
            windowsHide: true,
        });
        status = res.status;
        signal = res.signal;
        error = res.error || null;
        stdout = res.stdout || '';
        stderr = res.stderr || '';
    } catch (err) {
        error = err;
    }
    const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;

    const record = {
        commandId: id,
        hostExecutable: exe,
        arguments: args,
        pid: process.pid,
        startedAt: startedAt.toISOString(),
        elapsedMs: Math.round(elapsedMs * 1000) / 1000,
        timeoutMs: options.timeout === undefined ? TIMEOUT_MS : options.timeout,
        status,
        signal,
        errorCode: error ? (error.code || null) : null,
        errorErrno: error ? (error.errno === undefined ? null : error.errno) : null,
        errorMessage: error ? String(error.message) : null,
        stdoutBytes: Buffer.byteLength(stdout, 'utf8'),
        stderrBytes: Buffer.byteLength(stderr, 'utf8'),
        stdoutSample: sample(stdout),
        stderrSample: sample(stderr),
    };
    return { record, stdout, stderr, status, signal, error };
}

// spawnSync reports a timeout kill as signal SIGTERM with error.code ETIMEDOUT
// on most platforms; treat either as evidence of the boundary being hit.
function timedOut(run) {
    return run.record.errorCode === 'ETIMEDOUT'
        || run.signal === 'SIGTERM'
        || run.record.elapsedMs >= run.record.timeoutMs;
}

function classify(run, opts = {}) {
    const { record } = run;
    if (timedOut(run)) {
        // A timeout with bytes already on stdout is a materially different fault
        // from one with nothing: the query started answering and the process
        // never exited.
        if (record.stdoutBytes > 0) return CLASS.POWERSHELL_PARTIAL_STDOUT_TIMEOUT;
        return opts.cim ? CLASS.CIM_QUERY_TIMEOUT : CLASS.POWERSHELL_SPAWN_TIMEOUT;
    }
    if (record.errorCode) return CLASS.OTHER_WITH_EVIDENCE;
    if (record.status !== 0) return CLASS.POWERSHELL_NONZERO_EXIT;
    if (record.stdoutBytes === 0) {
        return opts.cim ? CLASS.CIM_NO_ROW : CLASS.POWERSHELL_EMPTY_STDOUT;
    }
    if (!opts.json) return CLASS.OK;
    try {
        const parsed = JSON.parse(run.stdout);
        if (opts.cim) {
            const row = Array.isArray(parsed) ? parsed[0] : parsed;
            if (!row || row.ProcessId === undefined || row.ProcessId === null) {
                return CLASS.PID_NOT_FOUND_DESPITE_ALIVE;
            }
            record.rowProcessId = row.ProcessId;
        }
        record.jsonParse = 'ok';
        return CLASS.OK;
    } catch (err) {
        record.jsonParse = `failed: ${err.message}`;
        return CLASS.JSON_PARSE_FAILURE;
    }
}

const PS_BASE_ARGS = ['-NoProfile', '-NonInteractive', '-Command'];

// D1 — an exact replica of the production command, same host, same flags, same
// 10s budget. If only this one stalls, the fault is in what the production
// query asks for, not in PowerShell or in the pid.
//
// D1 RUNS FIRST, and that ordering is load-bearing. The first run of this
// script put D1 last, so it was warmed by three prior PowerShell invocations
// while D2 absorbed the whole cold-start cost. The resulting "D2 > D3 > D4 > D1"
// was pure execution order, not query cost — an order effect that would have
// been read as evidence. In production, T-lock-ident's call IS the first
// PowerShell invocation of the suite, so only a D1-first probe reproduces the
// path being explained.
function d1(pid, exe) {
    const script = `Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}" | `
        + "Select-Object Name,ProcessId,ParentProcessId,CommandLine,"
        + "@{n='StartedAt';e={$_.CreationDate.ToUniversalTime().ToString('o')}} | ConvertTo-Json";
    const run = runCommand('D1_production_replica', exe, PS_BASE_ARGS.concat([script]));
    run.record.classification = classify(run, { json: true, cim: true });
    return run.record;
}

// D2 — PowerShell startup control. No CIM at all. If this also hits ten
// seconds, nothing downstream can be blamed: the host process itself is slow
// to start on this runner.
function d2(exe) {
    const run = runCommand('D2_powershell_startup', exe, PS_BASE_ARGS.concat(['Write-Output "alive"']));
    run.record.classification = classify(run, { json: false });
    return run.record;
}

// D3 — same pid, same host, no CIM. Get-Process reads the process table
// directly. D3 fast + D1 slow narrows the fault to CIM/WMI rather than to the
// pid or to PowerShell.
function d3(pid, exe) {
    const script = `Get-Process -Id ${Number(pid)} | Select-Object Id,ProcessName,StartTime | ConvertTo-Json`;
    const run = runCommand('D3_get_process_control', exe, PS_BASE_ARGS.concat([script]));
    run.record.classification = classify(run, { json: true });
    return run.record;
}

// D4 — minimal CIM query: same provider, same filter, one projected column.
// D4 fast + D1 slow would point at the CommandLine / CreationDate projection
// rather than at CIM lookup itself.
function d4(pid, exe) {
    const script = `Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}" | `
        + 'Select-Object ProcessId | ConvertTo-Json';
    const run = runCommand('D4_cim_minimal', exe, PS_BASE_ARGS.concat([script]));
    run.record.classification = classify(run, { json: true, cim: true });
    return run.record;
}

function collect(options = {}) {
    const pid = options.pid === undefined ? process.pid : Number(options.pid);
    const label = options.label || process.env.CIM_DIAG_LABEL || 'unlabelled';
    const report = {
        schema: 'memory-lock-cim-snapshot-diagnostic@1',
        label,
        phase: 'observation-only',
        collectedAt: new Date().toISOString(),
        targetPid: pid,
        platform: process.platform,
        nodeVersion: process.version,
        osRelease: os.release(),
        runner: pick(RUNNER_KEYS),
        github: pick(GITHUB_KEYS),
        // Recorded explicitly: elapsed times are only comparable against each
        // other once the reader knows which probe paid the cold-start cost.
        probeOrder: [
            'D1_production_replica',
            'D2_powershell_startup',
            'D3_get_process_control',
            'D4_cim_minimal',
        ],
        probes: [],
        summary: {},
    };

    if (process.platform !== 'win32') {
        report.summary = { skipped: 'not win32 — the production Windows branch is not reachable here' };
        return report;
    }

    const hosts = [{ exe: 'powershell.exe', primary: true }];
    // pwsh is a comparison only. Nothing here proposes switching production to
    // it; the point is to see whether the stall follows the host or the query.
    if (options.includePwsh !== false) hosts.push({ exe: 'pwsh.exe', primary: false });

    for (const host of hosts) {
        // D1 first — see the note on d1(). At the clean-runner checkpoint this
        // makes D1 the script's very first powershell.exe invocation, matching
        // production, where T-lock-ident is the suite's first PowerShell call.
        for (const probe of [
            () => d1(pid, host.exe),
            () => d2(host.exe),
            () => d3(pid, host.exe),
            () => d4(pid, host.exe),
        ]) {
            let record;
            try {
                record = probe();
            } catch (err) {
                record = {
                    commandId: 'probe_threw',
                    hostExecutable: host.exe,
                    errorMessage: String(err && err.message),
                    classification: CLASS.OTHER_WITH_EVIDENCE,
                };
            }
            record.hostRole = host.primary ? 'production-host' : 'comparison-host';
            report.probes.push(record);
        }
    }

    const primary = report.probes.filter(p => p.hostRole === 'production-host');
    const byId = id => primary.find(p => p.commandId === id) || null;
    const verdictOf = rec => (rec ? rec.classification : 'NOT_RUN');
    report.summary = {
        probeOrder: report.probeOrder,
        D1_production_replica: verdictOf(byId('D1_production_replica')),
        D2_powershell_startup: verdictOf(byId('D2_powershell_startup')),
        D3_get_process_control: verdictOf(byId('D3_get_process_control')),
        D4_cim_minimal: verdictOf(byId('D4_cim_minimal')),
        elapsedMs: primary.reduce((acc, p) => {
            acc[p.commandId] = p.elapsedMs === undefined ? null : p.elapsedMs;
            return acc;
        }, {}),
    };
    return report;
}

// Single-line structured output so it survives CI log interleaving and can be
// grepped out of a job log without a parser.
function emitLine(report) {
    process.stdout.write(`CIM_SNAPSHOT_DIAG=${JSON.stringify(report)}\n`);
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const opts = {};
    for (let i = 0; i < args.length; i += 1) {
        if (args[i] === '--label') { opts.label = args[i + 1]; i += 1; }
        else if (args[i] === '--pid') { opts.pid = args[i + 1]; i += 1; }
        else if (args[i] === '--no-pwsh') { opts.includePwsh = false; }
        else if (args[i] === '--pretty') { opts.pretty = true; }
    }
    const report = collect(opts);
    if (opts.pretty) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
        emitLine(report);
    }
    // Observation only: this script never fails the build. The assertion it
    // explains is the one that must stay red.
    process.exitCode = 0;
}

module.exports = { collect, emitLine, CLASS, RUNNER_KEYS, GITHUB_KEYS };
