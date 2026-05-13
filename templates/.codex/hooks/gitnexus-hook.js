#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ALLOWED_EVENTS = new Set(['posttooluse']);
const TOOL_ENV_KEYS = [
    'GITHUB_COPILOT_TOOL_NAME',
    'COPILOT_TOOL_NAME',
    'VSCODE_TOOL_NAME',
    'VSCODE_HOOK_TOOL_NAME',
    'TOOL_NAME',
];

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

    return {
        command: pickOfficialToolInputCommand(toolInput),
        success: typeof parsed.success === 'boolean' ? parsed.success : null,
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
        return { command: null, success: null, tool: null };
    }

    let raw = '';
    try {
        raw = fs.readFileSync(0, 'utf8');
    } catch {
        return { command: null, success: null, tool: null };
    }

    const normalizedRaw = normalizeRawText(raw);
    const text = compactText(normalizedRaw, 1200);
    if (!text) {
        return { command: null, success: null, tool: null };
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
            success: officialPayload.success ?? pickSuccess(entries),
            tool: officialPayload.tool || pickFirstString(entries, [
                /(^|\.)(toolName|tool_name|tool)$/i,
                /(^|\.)(invocationName|tool\.name)$/i,
            ]),
        };
    } catch {
        return {
            command: text,
            success: null,
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

function shouldAnalyze(command, tool, success) {
    if (success === false) {
        return false;
    }

    const commandLower = String(command || '').toLowerCase();
    const toolLower = String(tool || '').toLowerCase();
    return /\bgit\s+(commit|merge)\b/.test(commandLower) || /^git\.(commit|merge)$/.test(toolLower);
}

function resolveGitNexusExecutable() {
    const override = compactText(process.env.GITNEXUS_BIN, 1200);
    if (override) {
        return override;
    }

    if (process.platform !== 'win32') {
        return 'gitnexus';
    }

    const candidates = [
        process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'gitnexus.cmd') : null,
        process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'npm', 'gitnexus.cmd') : null,
        'gitnexus.cmd',
        'gitnexus.exe',
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (!path.isAbsolute(candidate) || fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return 'gitnexus.cmd';
}

function quoteWindowsArg(value) {
    const normalized = String(value || '');
    if (!normalized) {
        return '""';
    }

    if (!/[\s"]/u.test(normalized)) {
        return normalized;
    }

    return `"${normalized.replace(/"/g, '\\"')}"`;
}

function runGitNexus(args, workspaceRoot) {
    const executable = resolveGitNexusExecutable();
    const options = {
        cwd: workspaceRoot,
        encoding: 'utf8',
        windowsHide: true,
    };
    const result = process.platform === 'win32' && /\.cmd$/i.test(executable)
        ? spawnSync(
            process.env.ComSpec || 'cmd.exe',
            ['/d', '/s', '/c', [quoteWindowsArg(executable), ...args.map(quoteWindowsArg)].join(' ')],
            options
        )
        : spawnSync(executable, args, options);

    if (result.error) {
        throw result.error;
    }

    return {
        status: typeof result.status === 'number' ? result.status : 0,
        stdout: normalizeRawText(result.stdout || ''),
        stderr: normalizeRawText(result.stderr || ''),
    };
}

function buildAnalyzeArgs(workspaceRoot) {
    return ['analyze', workspaceRoot];
}

function deriveGitNexusUrls(baseUrl) {
    const normalizedBase = String(baseUrl || 'http://localhost:4747/api/mcp').replace(/\/+$/, '');
    const root = normalizedBase.endsWith('/api/mcp')
        ? normalizedBase.slice(0, -'/api/mcp'.length)
        : normalizedBase;
    try {
        return {
            mcp: normalizedBase,
            health: new URL('/api/health', `${root}/`).toString(),
            info: new URL('/api/info', `${root}/`).toString(),
            repos: new URL('/api/repos', `${root}/`).toString(),
        };
    } catch {
        return {
            mcp: normalizedBase,
            health: 'http://localhost:4747/api/health',
            info: 'http://localhost:4747/api/info',
            repos: 'http://localhost:4747/api/repos',
        };
    }
}

function normalizePath(value) {
    return String(value || '')
        .replace(/\\/g, '/')
        .replace(/\/+$/, '')
        .toLowerCase();
}

function extractSseJsonPayload(text) {
    const normalized = String(text || '');
    const dataLines = normalized
        .split(/\r?\n/)
        .filter(line => line.startsWith('data: '))
        .map(line => line.slice('data: '.length));
    if (dataLines.length === 0) {
        return null;
    }
    try {
        return JSON.parse(dataLines.join('\n'));
    } catch {
        return null;
    }
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, options);
    const text = await response.text();
    return { ok: response.ok, response, text };
}

async function checkGitNexusService(urls) {
    const healthResult = await requestJson(urls.health);
    if (!healthResult.ok) {
        throw new Error(`GitNexus health check failed: HTTP ${healthResult.response.status}`);
    }

    const initializeBody = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: {
                name: 'codex-gitnexus-hook',
                version: '1.0.0',
            },
        },
    });
    const initializeResult = await requestJson(urls.mcp, {
        method: 'POST',
        headers: {
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
        },
        body: initializeBody,
    });
    if (!initializeResult.ok) {
        throw new Error(`GitNexus MCP initialize failed: HTTP ${initializeResult.response.status}`);
    }

    const payload = extractSseJsonPayload(initializeResult.text);
    const sessionId = initializeResult.response.headers.get('mcp-session-id');
    if (!payload?.result?.serverInfo?.name) {
        throw new Error('GitNexus MCP initialize returned no serverInfo payload');
    }

    return {
        serverInfo: payload.result.serverInfo,
        sessionId,
    };
}

async function readIndexedRepos(urls) {
    const result = await requestJson(urls.repos, {
        headers: {
            Accept: 'application/json',
        },
    });
    if (!result.ok) {
        throw new Error(`GitNexus repos check failed: HTTP ${result.response.status}`);
    }

    try {
        return JSON.parse(result.text);
    } catch {
        throw new Error('GitNexus repos endpoint returned invalid JSON');
    }
}

function findMatchingRepo(repos, workspaceRoot) {
    const workspacePath = normalizePath(workspaceRoot);
    const workspaceName = path.basename(workspaceRoot).toLowerCase();

    for (const repo of Array.isArray(repos) ? repos : []) {
        const repoPath = normalizePath(repo?.path);
        const repoName = String(repo?.name || '').toLowerCase();
        if (!repoPath && !repoName) {
            continue;
        }

        if (repoPath === workspacePath || repoPath.endsWith(`/${workspaceName}`) || repoName === workspaceName) {
            return repo;
        }
    }

    return null;
}

function logDebug(message) {
    if (process.env.EVO_LITE_DEBUG_HOOKS === '1') {
        console.error(`[gitnexus-hook] ${message}`);
    }
}

function logInfo(message) {
    process.stdout.write(`${message}\n`);
}

async function checkGitNexus(workspaceRoot) {
    const analyzeResult = runGitNexus(buildAnalyzeArgs(workspaceRoot), workspaceRoot);
    if (analyzeResult.status === 0) {
        const summary = compactText(analyzeResult.stdout, 1200);
        if (summary) {
            logDebug(summary);
        }
        logInfo('ℹ️ [GitNexus] Local index refreshed for this repo.');
        return;
    }

    logDebug(compactText(analyzeResult.stderr || analyzeResult.stdout, 1200) || 'local GitNexus analyze failed');

    const urls = deriveGitNexusUrls(process.env.GITNEXUS_MCP_URL);
    const serviceState = await checkGitNexusService(urls);
    const repos = await readIndexedRepos(urls);
    const matchedRepo = findMatchingRepo(repos, workspaceRoot);

    logDebug(`connected to ${serviceState.serverInfo.name}@${serviceState.serverInfo.version}`);
    if (serviceState.sessionId) {
        logDebug(`initialize returned session ${serviceState.sessionId}`);
    }

    if (!matchedRepo) {
        logInfo(`ℹ️ [GitNexus] MCP service is reachable, but this repo is not indexed in the active GitNexus service yet.`);
        return;
    }

    const indexedAt = matchedRepo.indexedAt ? new Date(matchedRepo.indexedAt) : null;
    const ageMinutes = indexedAt && !Number.isNaN(indexedAt.getTime())
        ? Math.max(0, Math.round((Date.now() - indexedAt.getTime()) / 60000))
        : null;
    if (ageMinutes != null) {
        logDebug(`repo ${matchedRepo.name || '(unnamed)'} indexed ${ageMinutes} minute(s) ago`);
    } else {
        logDebug(`repo ${matchedRepo.name || '(unnamed)'} is indexed, but indexedAt is unavailable`);
    }
}

async function main() {
    const event = String(process.argv[2] || '').toLowerCase();
    if (!ALLOWED_EVENTS.has(event)) {
        return;
    }

    const hookPayload = readHookPayload();
    const tool = getToolName() || hookPayload.tool;
    const command = hookPayload.command;
    if (!shouldAnalyze(command, tool, hookPayload.success)) {
        return;
    }

    const workspaceRoot = process.cwd();
    if (!fs.existsSync(path.join(workspaceRoot, '.git'))) {
        return;
    }

    try {
        await checkGitNexus(workspaceRoot);
    } catch (error) {
        logDebug(error instanceof Error ? error.message : String(error));
    }
}

main().catch(error => {
    logDebug(error instanceof Error ? error.message : String(error));
    process.exitCode = 0;
});
