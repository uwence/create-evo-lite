#!/usr/bin/env node

const path = require('path');
const { spawnSync } = require('child_process');

const ALLOWED_EVENTS = new Set(['sessionstart', 'pretooluse', 'posttooluse']);

function toDockerMountPath(targetPath) {
    if (process.platform !== 'win32') {
        return targetPath;
    }
    return targetPath.replace(/\\/g, '/');
}

function main() {
    const event = String(process.argv[2] || '').toLowerCase();
    if (!ALLOWED_EVENTS.has(event)) {
        process.exit(0);
    }

    const workspaceRoot = path.resolve(__dirname, '..', '..');
    const result = spawnSync(
        'docker',
        [
            'run',
            '--rm',
            '--init',
            '-i',
            '-e',
            'HOME=/data',
            '-v',
            'mcp-context-mode-data:/data',
            '-v',
            `${toDockerMountPath(workspaceRoot)}:/workspace`,
            '-w',
            '/workspace',
            'mcp-context-mode:local',
            'hook',
            'codex',
            event,
        ],
        {
            cwd: workspaceRoot,
            stdio: 'inherit',
        }
    );

    if (result.error) {
        if (process.env.EVO_LITE_DEBUG_HOOKS === '1') {
            console.error(`[context-mode-hook] ${result.error.message}`);
        }
        process.exit(0);
    }

    if (typeof result.status === 'number' && result.status !== 0 && process.env.EVO_LITE_DEBUG_HOOKS === '1') {
        console.error(`[context-mode-hook] context-mode exited with status ${result.status}`);
    }

    process.exit(0);
}

main();
