#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ALLOWED_EVENTS = new Set(['sessionstart', 'pretooluse', 'posttooluse', 'precompact', 'stop']);
const TOOL_ENV_KEYS = [
    'GITHUB_COPILOT_TOOL_NAME',
    'COPILOT_TOOL_NAME',
    'VSCODE_TOOL_NAME',
    'VSCODE_HOOK_TOOL_NAME',
    'TOOL_NAME',
];

function getRuntimeRoot(workspaceRoot) {
    const override = typeof process.env.EVO_LITE_ROOT === 'string' ? process.env.EVO_LITE_ROOT.trim() : '';
    return override ? path.resolve(override) : path.join(workspaceRoot, '.evo-lite');
}

function getProvenanceFilePath(workspaceRoot) {
    return path.join(getRuntimeRoot(workspaceRoot), 'provenance', 'steps.ndjson');
}

function compactText(value, maxLength = 600) {
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

    const payload = {
        command: pickOfficialToolInputCommand(toolInput),
        output: compactText(parsed.tool_response || parsed.toolResponse, 1200),
        success: null,
        tool: compactText(parsed.tool_name || parsed.toolName),
    };

    if (!payload.command && payload.tool === 'runTerminalCommand') {
        payload.command = compactText(parsed.command || parsed.commandLine);
    }

    return payload;
}

function extractPatchTargets(value) {
    if (typeof value !== 'string') {
        return [];
    }

    const targets = [];
    const normalized = normalizeRawText(value);
    const patchRegex = /\*\*\* (?:Update|Add|Delete) File:\s+([^\r\n]+)/g;
    let match = patchRegex.exec(normalized);
    while (match) {
        targets.push(match[1].trim());
        match = patchRegex.exec(normalized);
    }
    return targets;
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

function collectTouchedTargets(entries) {
    const targets = [];
    const seen = new Set();

    const pushTarget = value => {
        if (typeof value !== 'string') {
            return;
        }
        const normalized = normalizeRawText(value);
        if (!normalized || seen.has(normalized)) {
            return;
        }
        seen.add(normalized);
        targets.push(normalized);
    };

    for (const entry of entries) {
        if (typeof entry.value !== 'string') {
            continue;
        }
        if (/(^|\.)(filePath|dirPath|path|old_path|new_path|oldPath|newPath|targetPath)$/i.test(entry.path)) {
            pushTarget(entry.value);
        }
        for (const patchTarget of extractPatchTargets(entry.value)) {
            pushTarget(patchTarget);
        }
    }

    return targets;
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

function pickSuccess(entries) {
    for (const entry of entries) {
        if (typeof entry.value === 'boolean' && /(^|\.)(success|ok)$/i.test(entry.path)) {
            return entry.value;
        }
    }

    for (const entry of entries) {
        if (typeof entry.value === 'number' && /(^|\.)(exitCode|code|statusCode)$/i.test(entry.path)) {
            return entry.value === 0;
        }
    }

    for (const entry of entries) {
        if (typeof entry.value === 'string' && /(^|\.)(status|result)$/i.test(entry.path)) {
            const normalized = entry.value.trim().toLowerCase();
            if (['ok', 'success', 'succeeded', 'completed'].includes(normalized)) {
                return true;
            }
            if (['error', 'failed', 'failure'].includes(normalized)) {
                return false;
            }
        }
    }

    return null;
}

function readHookPayload() {
    if (process.stdin.isTTY) {
        return {
            command: null,
            output: null,
            success: null,
            tool: null,
            targets: [],
        };
    }

    let raw = '';
    try {
        raw = fs.readFileSync(0, 'utf8');
    } catch {
        return {
            command: null,
            output: null,
            success: null,
            tool: null,
            targets: [],
        };
    }

    const normalizedRaw = normalizeRawText(raw);
    const text = compactText(normalizedRaw, 1200);
    if (!text) {
        return {
            command: null,
            output: null,
            success: null,
            tool: null,
            targets: [],
        };
    }

    try {
        const parsed = JSON.parse(normalizedRaw);
        const officialPayload = extractOfficialHookPayload(parsed) || {};
        const entries = flattenPayload(parsed);
        const targets = collectTouchedTargets(entries);
        const fallbackPayload = {
            command: pickFirstString(entries, [
                /(^|\.)(command|commandLine|shellCommand|terminalCommand)$/i,
                /(^|\.)(input|toolInput|tool_input|prompt|arguments)$/i,
            ]),
            output: pickFirstString(entries, [
                /(^|\.)(tool_response|toolResponse|stdout|stderr|output|resultText|message|summary)$/i,
            ]),
            success: pickSuccess(entries),
            tool: pickFirstString(entries, [
                /(^|\.)(toolName|tool_name|tool)$/i,
                /(^|\.)(invocationName|tool\.name)$/i,
            ]),
        };
        return {
            command: officialPayload.command || fallbackPayload.command,
            output: officialPayload.output || fallbackPayload.output,
            success: officialPayload.success ?? fallbackPayload.success,
            tool: officialPayload.tool || fallbackPayload.tool,
            targets,
        };
    } catch {
        return {
            command: text,
            output: null,
            success: null,
            tool: null,
            targets: extractPatchTargets(normalizedRaw),
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

function appendProvenanceRecord(workspaceRoot, record) {
    try {
        const filePath = getProvenanceFilePath(workspaceRoot);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
    } catch (error) {
        if (process.env.EVO_LITE_DEBUG_HOOKS === '1') {
            console.error(`[evo-lite-hook] provenance append failed: ${error.message}`);
        }
    }
}

function main() {
    const event = (process.argv[2] || '').toLowerCase();
    if (!ALLOWED_EVENTS.has(event)) {
        process.exit(0);
    }

    const hookPayload = readHookPayload();

    const workspaceRoot = process.cwd();
    const memoryCli = path.join(workspaceRoot, '.evo-lite', 'cli', 'memory.js');
    if (!fs.existsSync(memoryCli)) {
        process.exit(0);
    }

    const args = [memoryCli, 'hooks', 'advise', event];
    const tool = getToolName() || hookPayload.tool;
    if (tool) {
        args.push(`--tool=${tool}`);
    }
    if (hookPayload.command) {
        args.push(`--command=${hookPayload.command}`);
    }
    if (hookPayload.output) {
        args.push(`--output=${hookPayload.output}`);
    }
    if (typeof hookPayload.success === 'boolean') {
        args.push(`--success=${hookPayload.success}`);
    }
    for (const target of hookPayload.targets || []) {
        args.push(`--target=${target}`);
    }

    const result = spawnSync(process.execPath, args, {
        cwd: workspaceRoot,
        stdio: 'inherit',
    });

    if (result.error && process.env.EVO_LITE_DEBUG_HOOKS === '1') {
        console.error(`[evo-lite-hook] ${result.error.message}`);
    }

    if (result.error) {
        appendProvenanceRecord(workspaceRoot, {
            command: hookPayload.command || null,
            error: compactText(result.error.message, 240),
            event,
            output: hookPayload.output || null,
            recordedAt: new Date().toISOString(),
            status: 'spawn-error',
            success: hookPayload.success,
            targets: Array.isArray(hookPayload.targets) ? hookPayload.targets.slice(0, 8) : [],
            tool: tool || null,
            transport: 'shared-hook',
            workspaceRoot,
        });
        process.exit(1);
    }

    appendProvenanceRecord(workspaceRoot, {
        command: hookPayload.command || null,
        event,
        output: hookPayload.output || null,
        recordedAt: new Date().toISOString(),
        sourceCommit: process.env.EVO_LITE_GIT_COMMIT || null,
        status: typeof result.status === 'number' ? result.status : 0,
        success: hookPayload.success,
        targets: Array.isArray(hookPayload.targets) ? hookPayload.targets.slice(0, 8) : [],
        tool: tool || null,
        transport: 'shared-hook',
        workspaceRoot,
    });

    process.exit(typeof result.status === 'number' ? result.status : 0);
}

main();
