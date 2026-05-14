#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ACCEPT_DECISION = JSON.stringify({ decision: 'accept' });

function getRuntimeRoot(workspaceRoot) {
    const override = typeof process.env.EVO_LITE_ROOT === 'string' ? process.env.EVO_LITE_ROOT.trim() : '';
    return override ? path.resolve(override) : path.join(workspaceRoot, '.evo-lite');
}

function getProvenanceFilePath(workspaceRoot) {
    return path.join(getRuntimeRoot(workspaceRoot), 'provenance', 'steps.ndjson');
}

function writeDecisionAndExit() {
    process.stdout.write(ACCEPT_DECISION);
    process.exit(0);
}

function compactText(value, maxLength = 240) {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return null;
    }

    return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function writeStderrLine(value) {
    const line = compactText(value, 480);
    if (!line) {
        return;
    }
    process.stderr.write(`${line}\n`);
}

function summarizeAdvice(report) {
    if (!report || typeof report !== 'object' || Array.isArray(report)) {
        return null;
    }

    const items = [];
    const reminders = Array.isArray(report.reminders) ? report.reminders : [];
    const warnings = Array.isArray(report.warnings) ? report.warnings : [];

    for (const reminder of reminders.slice(0, 2)) {
        const normalized = compactText(reminder);
        if (normalized) {
            items.push(normalized);
        }
    }
    for (const warning of warnings.slice(0, 1)) {
        const normalized = compactText(warning);
        if (normalized) {
            items.push(normalized);
        }
    }

    if (items.length === 0) {
        return null;
    }

    return `[evo-lite stop] ${items.join(' | ')}`;
}

function appendProvenanceRecord(workspaceRoot, record) {
    try {
        const filePath = getProvenanceFilePath(workspaceRoot);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
    } catch (error) {
        if (process.env.EVO_LITE_DEBUG_HOOKS === '1') {
            writeStderrLine(`[evo-lite-codex-stop-hook] provenance append failed: ${error.message}`);
        }
    }
}

function main() {
    const workspaceRoot = process.cwd();
    const memoryCli = path.join(workspaceRoot, '.evo-lite', 'cli', 'memory.js');
    if (!fs.existsSync(memoryCli)) {
        appendProvenanceRecord(workspaceRoot, {
            decision: 'accept',
            event: 'stop',
            note: 'memory-cli-missing',
            recordedAt: new Date().toISOString(),
            transport: 'codex-stop',
            workspaceRoot,
        });
        writeDecisionAndExit();
    }

    const result = spawnSync(
        process.execPath,
        [memoryCli, 'hooks', 'advise', 'stop', '--json'],
        {
            cwd: workspaceRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        }
    );

    if (result.error) {
        if (process.env.EVO_LITE_DEBUG_HOOKS === '1') {
            writeStderrLine(`[evo-lite-codex-stop-hook] ${result.error.message}`);
        }
        appendProvenanceRecord(workspaceRoot, {
            decision: 'accept',
            error: compactText(result.error.message, 240),
            event: 'stop',
            recordedAt: new Date().toISOString(),
            status: 'spawn-error',
            transport: 'codex-stop',
            workspaceRoot,
        });
        writeDecisionAndExit();
    }

    const rawStdout = typeof result.stdout === 'string' ? result.stdout.trim() : '';
    let report = null;
    let parseState = 'empty';
    if (rawStdout) {
        try {
            report = JSON.parse(rawStdout);
            parseState = 'parsed';
        } catch {
            parseState = 'invalid-json';
            if (process.env.EVO_LITE_DEBUG_HOOKS === '1') {
                writeStderrLine('[evo-lite-codex-stop-hook] stop advice returned non-JSON stdout; falling back to accept.');
            }
        }
    }

    const summary = summarizeAdvice(report);
    if (summary) {
        writeStderrLine(summary);
    } else if (process.env.EVO_LITE_DEBUG_HOOKS === '1' && typeof result.stderr === 'string' && result.stderr.trim()) {
        writeStderrLine(`[evo-lite-codex-stop-hook] ${result.stderr.trim()}`);
    }

    appendProvenanceRecord(workspaceRoot, {
        currentCommit: report && typeof report.currentCommit === 'string' ? report.currentCommit : process.env.EVO_LITE_GIT_COMMIT || null,
        decision: 'accept',
        dirty: report && typeof report.dirty === 'boolean' ? report.dirty : null,
        event: 'stop',
        parseState,
        recordedAt: new Date().toISOString(),
        reminders: report && Array.isArray(report.reminders) ? report.reminders.slice(0, 3).map(item => compactText(item, 240)).filter(Boolean) : [],
        sourceCommit: process.env.EVO_LITE_GIT_COMMIT || null,
        status: typeof result.status === 'number' ? result.status : 0,
        trackNeedsUpdate: report && typeof report.trackNeedsUpdate === 'boolean' ? report.trackNeedsUpdate : null,
        transport: 'codex-stop',
        warnings: report && Array.isArray(report.warnings) ? report.warnings.slice(0, 2).map(item => compactText(item, 240)).filter(Boolean) : [],
        workspaceRoot,
    });

    writeDecisionAndExit();
}

main();
