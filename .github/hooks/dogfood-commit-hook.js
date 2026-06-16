#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ALLOWED_EVENTS = new Set(['pretooluse']);
const TOOL_ENV_KEYS = [
    'GITHUB_COPILOT_TOOL_NAME',
    'COPILOT_TOOL_NAME',
    'VSCODE_TOOL_NAME',
    'VSCODE_HOOK_TOOL_NAME',
    'TOOL_NAME',
];
const DOGFOOD_MECHANISMS = new Set(['dogfood', 'hookdogfood']);

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
        tool: compactText(parsed.tool_name || parsed.toolName),
    };

    if (!payload.command && payload.tool === 'runTerminalCommand') {
        payload.command = compactText(parsed.command || parsed.commandLine);
    }

    return payload;
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

function readSection(markdown, anchor) {
    const regex = new RegExp(`<!-- BEGIN_${anchor} -->([\\s\\S]*?)<!-- END_${anchor} -->`);
    const match = markdown.match(regex);
    return match ? match[1] : null;
}

function parseTrajectoryEntry(line) {
    const match = String(line || '').match(/^- \[[^\]]+\]\s+\d{4}-\d{2}-\d{2}\s+([^:]+):\s*(.*)$/);
    return {
        line: line || null,
        mechanism: match ? match[1].trim() : null,
        summary: match ? match[2].trim() : String(line || '').trim(),
    };
}

function readLatestTrajectory(workspaceRoot) {
    const activeContextPath = path.join(workspaceRoot, '.evo-lite', 'active_context.md');
    if (!fs.existsSync(activeContextPath)) {
        return null;
    }

    const trajectory = readSection(fs.readFileSync(activeContextPath, 'utf8'), 'TRAJECTORY') || '';
    const entries = trajectory
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('-'));
    return entries.length > 0 ? parseTrajectoryEntry(entries[0]) : null;
}

function isCommitLikeActivity(command, tool) {
    const toolLower = String(tool || '').toLowerCase();
    const commandLower = String(command || '').toLowerCase();
    return /commit|release|ship|version/.test(toolLower)
        || /(git\s+commit\b|npm\s+version\b|pnpm\s+version\b|yarn\s+version\b|changeset\b|\brelease\b|\bship\b)/.test(commandLower);
}

function hasDogFoodEvidence(entry) {
    if (!entry || !entry.mechanism) {
        return false;
    }

    const normalizedMechanism = entry.mechanism
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
    return DOGFOOD_MECHANISMS.has(normalizedMechanism);
}

function main() {
    const event = (process.argv[2] || '').toLowerCase();
    if (!ALLOWED_EVENTS.has(event)) {
        process.exit(0);
    }

    const hookPayload = readHookPayload();
    const tool = getToolName() || hookPayload.tool;
    const command = hookPayload.command;

    if (!isCommitLikeActivity(command, tool)) {
        process.exit(0);
    }

    const workspaceRoot = process.cwd();
    const latestTrajectory = readLatestTrajectory(workspaceRoot);
    if (hasDogFoodEvidence(latestTrajectory)) {
        process.exit(0);
    }

    console.log('⚠️ [Dog Food 提醒] 检测到提交前操作，但最新 TRAJECTORY 里没有显式 DogFood / HookDogFood 证据。先 dog food，再提交。');
    console.log('💡 建议先完成当前改动的实际自测/试玩/回归验证，再执行 `node .evo-lite/cli/memory.js context track --mechanism="DogFood" --details="Completed dog food / smoke test for ..."` 或 `--mechanism="HookDogFood"` 记录闭环。');
    if (latestTrajectory) {
        console.log(`ℹ️ latest_trajectory: ${latestTrajectory.line}`);
        console.log(`ℹ️ latest_mechanism: ${latestTrajectory.mechanism || '(unparsed)'}`);
    } else {
        console.log('ℹ️ latest_trajectory: (missing)');
    }
}

main();
