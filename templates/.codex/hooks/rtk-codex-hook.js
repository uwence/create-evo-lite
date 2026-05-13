#!/usr/bin/env node

const fs = require('fs');
const { spawnSync } = require('child_process');

const ALLOWED_EVENTS = new Set(['pretooluse']);
const TOOL_ENV_KEYS = [
    'GITHUB_COPILOT_TOOL_NAME',
    'COPILOT_TOOL_NAME',
    'VSCODE_TOOL_NAME',
    'VSCODE_HOOK_TOOL_NAME',
    'TOOL_NAME',
];

function compactText(value, maxLength = 800) {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return null;
    }

    return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function normalizeRawText(value) {
    if (typeof value !== 'string') {
        return '';
    }

    return value
        .replace(/^\uFEFF/, '')
        .replace(/\u0000/g, '')
        .trim();
}

function pickOfficialToolInputCommand(toolInput) {
    if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) {
        return null;
    }

    for (const key of ['command', 'commandLine', 'shellCommand', 'terminalCommand']) {
        const value = compactText(toolInput[key]);
        if (value) {
            return value;
        }
    }

    return null;
}

function extractOfficialHookPayload(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
    }

    const toolInput = parsed.tool_input && typeof parsed.tool_input === 'object'
        ? parsed.tool_input
        : parsed.toolInput && typeof parsed.toolInput === 'object'
            ? parsed.toolInput
            : null;

    return {
        command: pickOfficialToolInputCommand(toolInput),
        tool: compactText(parsed.tool_name || parsed.toolName),
    };
}

function flattenPayload(value, pathPrefix = '', entries = [], depth = 0) {
    if (value == null || depth > 5 || entries.length > 200) {
        return entries;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        entries.push({ path: pathPrefix, value });
        return entries;
    }

    if (Array.isArray(value)) {
        value.slice(0, 12).forEach((item, index) => {
            flattenPayload(item, `${pathPrefix}[${index}]`, entries, depth + 1);
        });
        return entries;
    }

    if (typeof value === 'object') {
        for (const [key, nestedValue] of Object.entries(value).slice(0, 30)) {
            const nextPath = pathPrefix ? `${pathPrefix}.${key}` : key;
            flattenPayload(nestedValue, nextPath, entries, depth + 1);
        }
    }

    return entries;
}

function pickFirstString(entries, patterns) {
    for (const pattern of patterns) {
        const match = entries.find(entry => typeof entry.value === 'string' && pattern.test(entry.path) && entry.value.trim());
        if (match) {
            return compactText(match.value);
        }
    }
    return null;
}

function readHookPayload() {
    if (process.stdin.isTTY) {
        return { command: null, tool: null };
    }

    let raw = '';
    try {
        raw = fs.readFileSync(0, 'utf8');
    } catch {
        return { command: null, tool: null };
    }

    const normalizedRaw = normalizeRawText(raw);
    const text = compactText(normalizedRaw, 1200);
    if (!text) {
        return { command: null, tool: null };
    }

    try {
        const parsed = JSON.parse(normalizedRaw);
        const officialPayload = extractOfficialHookPayload(parsed) || {};
        const entries = flattenPayload(parsed);
        return {
            command: officialPayload.command || pickFirstString(entries, [
                /(^|\.)(command|commandLine|shellCommand|terminalCommand)$/i,
                /(^|\.)(input|toolInput|tool_input|prompt|arguments)$/i,
            ]),
            tool: officialPayload.tool || pickFirstString(entries, [
                /(^|\.)(toolName|tool_name|tool)$/i,
                /(^|\.)(invocationName|tool\.name)$/i,
            ]),
        };
    } catch {
        return {
            command: text,
            tool: null,
        };
    }
}

function getToolName() {
    const explicitTool = process.argv[3];
    if (explicitTool) {
        return explicitTool;
    }

    for (const key of TOOL_ENV_KEYS) {
        const value = process.env[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }

    return null;
}

function normalizeCommand(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function shouldSkip(command, tool) {
    const normalizedCommand = normalizeCommand(command);
    if (!normalizedCommand) {
        return true;
    }

    if (tool && !/^bash$/i.test(String(tool).trim())) {
        return true;
    }

    if (/^rtk(?:\.exe)?\s+/i.test(normalizedCommand)) {
        return true;
    }

    if (/RTK_DISABLED/i.test(normalizedCommand)) {
        return true;
    }

    return false;
}

function logDebug(message) {
    if (process.env.EVO_LITE_DEBUG_HOOKS === '1') {
        console.error(`[rtk-codex-hook] ${message}`);
    }
}

function checkRewrite(command) {
    const executable = process.platform === 'win32' ? 'rtk.exe' : 'rtk';
    const result = spawnSync(
        executable,
        ['hook', 'check', command],
        {
            encoding: 'utf8',
            windowsHide: true,
        }
    );

    if (result.error) {
        throw result.error;
    }

    const stdout = normalizeRawText(result.stdout || '');
    return {
        status: typeof result.status === 'number' ? result.status : 0,
        rewritten: compactText(stdout, 1200),
        stderr: compactText(result.stderr || '', 1200),
    };
}

function printDeny(reason) {
    process.stdout.write(JSON.stringify({
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
    }));
}

function main() {
    const event = String(process.argv[2] || '').toLowerCase();
    if (!ALLOWED_EVENTS.has(event)) {
        return;
    }

    const hookPayload = readHookPayload();
    const tool = getToolName() || hookPayload.tool;
    const command = hookPayload.command;
    if (shouldSkip(command, tool)) {
        return;
    }

    try {
        const rewriteCheck = checkRewrite(command);
        const normalizedOriginal = normalizeCommand(command);
        const normalizedRewritten = normalizeCommand(rewriteCheck.rewritten);

        if (rewriteCheck.status !== 0 || !normalizedRewritten || normalizedOriginal.toLowerCase() === normalizedRewritten.toLowerCase()) {
            if (rewriteCheck.stderr) {
                logDebug(rewriteCheck.stderr);
            }
            return;
        }

        printDeny(`RTK can compact this shell command for Codex. Re-run as: ${normalizedRewritten}`);
    } catch (error) {
        logDebug(error instanceof Error ? error.message : String(error));
    }
}

main();
