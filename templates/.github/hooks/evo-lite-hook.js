#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ALLOWED_EVENTS = new Set(['sessionstart', 'posttooluse', 'precompact', 'stop']);
const TOOL_ENV_KEYS = [
    'GITHUB_COPILOT_TOOL_NAME',
    'COPILOT_TOOL_NAME',
    'VSCODE_TOOL_NAME',
    'VSCODE_HOOK_TOOL_NAME',
    'TOOL_NAME',
];

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

function main() {
    const event = (process.argv[2] || '').toLowerCase();
    if (!ALLOWED_EVENTS.has(event)) {
        process.exit(0);
    }

    const workspaceRoot = process.cwd();
    const memoryCli = path.join(workspaceRoot, '.evo-lite', 'cli', 'memory.js');
    if (!fs.existsSync(memoryCli)) {
        process.exit(0);
    }

    const args = [memoryCli, 'hooks', 'advise', event];
    const tool = getToolName();
    if (tool) {
        args.push(`--tool=${tool}`);
    }

    const result = spawnSync(process.execPath, args, {
        cwd: workspaceRoot,
        stdio: 'inherit',
    });

    if (result.error && process.env.EVO_LITE_DEBUG_HOOKS === '1') {
        console.error(`[evo-lite-hook] ${result.error.message}`);
    }

    process.exit(0);
}

main();