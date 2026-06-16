'use strict';

const fs = require('fs');
const path = require('path');

const SENTINEL_BEGIN = '# BEGIN evo-lite-hook';
const SENTINEL_END = '# END evo-lite-hook';

function buildHookBody() {
    const lines = [
        SENTINEL_BEGIN,
        '# Managed by create-evo-lite. Do not edit this block manually.',
        '[ -d ".evo-lite/cli" ] || exit 0',
        'CHANGED=$(git diff --name-only HEAD~1 HEAD 2>/dev/null || git diff --name-only HEAD 2>/dev/null || echo "")',
        'PLAN_CHANGED="" ARCH_CHANGED=""',
        'for f in $CHANGED; do',
        '  case "$f" in',
        '    docs/specs/*|docs/plans/*|docs/superpowers/specs/*|docs/superpowers/plans/*) PLAN_CHANGED=1 ;;',
        '    templates/cli/*|index.js|bin/*) ARCH_CHANGED=1 ;;',
        '  esac',
        'done',
        'NODE_BIN=$(command -v node 2>/dev/null)',
        '[ -z "$NODE_BIN" ] && exit 0',
        '[ -z "${PLAN_CHANGED}${ARCH_CHANGED}" ] && exit 0',
        'MEM="$NODE_BIN .evo-lite/cli/memory.js"',
        '[ -n "$PLAN_CHANGED" ] && { $MEM plan scan 2>/dev/null; true; }',
        '[ -n "$ARCH_CHANGED" ] && { $MEM architecture scan 2>/dev/null; true; }',
        '$MEM plan gaps 2>/dev/null; true',
        '$MEM dashboard build 2>/dev/null; true',
        SENTINEL_END,
    ];
    return lines.join('\n');
}

function installPostCommitHook(targetDir) {
    const hooksDir = path.join(targetDir, '.git', 'hooks');
    if (!fs.existsSync(hooksDir)) return;

    const hookBody = buildHookBody();
    const hookPath = path.join(hooksDir, 'post-commit');

    if (fs.existsSync(hookPath)) {
        let content = fs.readFileSync(hookPath, 'utf8');
        if (content.includes(SENTINEL_BEGIN)) {
            content = content.replace(
                new RegExp(`${SENTINEL_BEGIN}[\\s\\S]*?${SENTINEL_END}`),
                hookBody
            );
        } else {
            content = content.trimEnd() + '\n\n' + hookBody + '\n';
        }
        fs.writeFileSync(hookPath, content);
    } else {
        fs.writeFileSync(hookPath, '#!/bin/sh\n' + hookBody + '\n');
    }
    try { fs.chmodSync(hookPath, '755'); } catch (_) {}
}

function registerHookCommands(program) {
    const { getWorkspaceRoot } = require('./runtime');
    const hook = program.command('hook').description('Git hook management.');

    hook.command('install')
        .description('Install (or upgrade) the post-commit governance hook in .git/hooks/.')
        .action(() => {
            const projectRoot = getWorkspaceRoot();
            const hooksDir = path.join(projectRoot, '.git', 'hooks');
            if (!fs.existsSync(hooksDir)) {
                console.error('No .git/hooks/ directory found. Is this a git repository?');
                process.exitCode = 1;
                return;
            }
            installPostCommitHook(projectRoot);
            const hookPath = path.join(hooksDir, 'post-commit');
            console.log(`Post-commit hook installed: ${hookPath}`);
            console.log('Hook will auto-run plan scan + dashboard build after commits that touch docs/ or templates/cli/.');
        });

    hook.command('status')
        .description('Check whether the post-commit governance hook is installed.')
        .action(() => {
            const projectRoot = getWorkspaceRoot();
            const hookPath = path.join(projectRoot, '.git', 'hooks', 'post-commit');
            if (!fs.existsSync(hookPath)) {
                console.log('post-commit: not installed');
                console.log('  install: mem hook install');
                process.exitCode = 1;
                return;
            }
            const content = fs.readFileSync(hookPath, 'utf8');
            if (content.includes(SENTINEL_BEGIN)) {
                console.log('post-commit: evo-lite hook installed');
            } else {
                console.log('post-commit: exists (third-party, no evo-lite block)');
                console.log('  install: mem hook install  (will append without overwriting)');
            }
        });
}

module.exports = { installPostCommitHook, registerHookCommands };
