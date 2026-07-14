'use strict';

// Secure command runner for the CodeGraph adapter — the security seam every
// CodeGraph-spawning task routes through. execFile with shell:false, args
// always as an array, a subcommand allowlist gate BEFORE spawn, an enforced
// timeout, an output cap, ANSI stripping, and a Local-First network-env
// boundary that a caller cannot override. This module NEVER throws: every
// spawn/timeout/oversize/bad-input failure becomes a structured result with
// diagnostics instead of a thrown error.
//
// SUPPORTS_POSITIONAL_SEPARATOR is a frozen constant proven by cg-fixtures
// (commander.js, no passThroughOptions) — it must NOT be re-derived by
// reading the fixture manifest at runtime; it is a hard-coded production
// fact that happens to match the manifest (a test enforces the match).

const { execFile } = require('child_process');

// Frozen ARRAY (not a Set): Object.freeze(new Set()) does NOT block .add(),
// so the exported allowlist is an array and the lookup structure stays
// module-private below.
const ALLOWED_SUBCOMMANDS = Object.freeze([
    'status', 'files', 'query', 'callers', 'callees',
    'impact', 'affected', 'explore', 'node', 'version', 'help',
]);
const ALLOWED_SET = new Set(ALLOWED_SUBCOMMANDS);

// Proven upstream conclusion (cg-fixtures manifest): codegraph's CLI is built
// on commander.js with no passThroughOptions()/enablePositionalOptions()
// override, so `--` always ends option parsing and everything after it is a
// literal positional operand. Hard-coded here; NOT read from the manifest.
const SUPPORTS_POSITIONAL_SEPARATOR = true;

const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g;

function stripAnsi(s) {
    if (typeof s !== 'string') {
        return '';
    }
    return s.replace(ANSI_RE, '');
}

// Local-First network-env boundary. The forced values are applied AFTER the
// caller's env so a caller cannot smuggle telemetry/network back on by
// passing DO_NOT_TRACK='0' — this module always wins unless allowNetwork
// is explicitly true, in which case it omits the forced vars entirely and
// leaves the decision to the caller.
function childEnv(baseEnv, callerEnv, allowNetwork) {
    const env = { ...(baseEnv || {}), ...(callerEnv || {}) };
    if (!allowNetwork) {
        env.DO_NOT_TRACK = '1';
        env.CODEGRAPH_NO_UPDATE_CHECK = '1';
    }
    return env;
}

// Guards a user-derived operand before an adapter places it after `--`.
// Since SUPPORTS_POSITIONAL_SEPARATOR is true, a leading-dash operand is
// safe when passed after the separator. Written defensively so the check
// stays correct even if the constant were ever false.
function safeOperand(value) {
    if (!SUPPORTS_POSITIONAL_SEPARATOR && /^-/.test(String(value))) {
        return { ok: false, reason: 'unsafe-argument' };
    }
    return { ok: true, value: String(value) };
}

function diag(code, message) {
    return { code, message: message || code };
}

function emptyResult(overrides) {
    return Object.assign({
        ok: false,
        code: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        truncated: false,
        diagnostics: [],
    }, overrides);
}

// async: wraps execFile's callback style in a Promise. Never throws — every
// rejection path is caught and converted into a structured result instead.
async function runCodegraph(spec) {
    const {
        executable, prefixArgs, subcommand, args, cwd,
        timeoutMs = 15000, maxBytes = 8 * 1024 * 1024,
        allowNetwork = false, env,
    } = spec || {};

    try {
        if (!ALLOWED_SET.has(subcommand)) {
            return emptyResult({
                diagnostics: [diag('disallowed-subcommand', `subcommand "${subcommand}" is not allowlisted`)],
            });
        }

        const fullArgs = [...(prefixArgs || []), subcommand, ...(args || [])];
        const spawnEnv = childEnv(process.env, env || {}, allowNetwork);

        return await new Promise((resolve) => {
            execFile(executable, fullArgs, {
                cwd,
                timeout: timeoutMs,
                maxBuffer: maxBytes,
                env: spawnEnv,
                shell: false,
                windowsHide: true,
            }, (err, stdout, stderr) => {
                if (!err) {
                    resolve(emptyResult({
                        ok: true,
                        code: 0,
                        stdout: stripAnsi(stdout),
                        stderr: stripAnsi(stderr),
                    }));
                    return;
                }

                if (err.killed || err.signal) {
                    resolve(emptyResult({
                        timedOut: true,
                        diagnostics: [diag('command-timeout', `command timed out after ${timeoutMs}ms`)],
                    }));
                    return;
                }

                if (err.code === 'ENOBUFS' || /maxBuffer/i.test(String(err.message || ''))) {
                    resolve(emptyResult({
                        truncated: true,
                        diagnostics: [diag('output-truncated', 'command output exceeded the configured maxBytes')],
                    }));
                    return;
                }

                if (typeof err.code === 'number') {
                    resolve(emptyResult({
                        code: err.code,
                        stdout: stripAnsi(stdout),
                        stderr: stripAnsi(stderr),
                        diagnostics: [diag('nonzero-exit', `exit ${err.code}`)],
                    }));
                    return;
                }

                // ENOENT (missing executable) and any other spawn-time failure.
                resolve(emptyResult({
                    diagnostics: [diag('spawn-failed', err.message || String(err))],
                }));
            });
        });
    } catch (err) {
        // Defensive: even a synchronous throw building the spec/env never
        // escapes this function.
        return emptyResult({
            diagnostics: [diag('spawn-failed', err && err.message ? err.message : String(err))],
        });
    }
}

module.exports = {
    runCodegraph,
    ALLOWED_SUBCOMMANDS,
    SUPPORTS_POSITIONAL_SEPARATOR,
    stripAnsi,
    childEnv,
    safeOperand,
};
