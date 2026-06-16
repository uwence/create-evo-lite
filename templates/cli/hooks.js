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
        'CHANGED=$(git diff-tree --no-commit-id --name-only -r --root HEAD 2>/dev/null || git diff --name-only HEAD~1 HEAD 2>/dev/null || git diff --name-only HEAD 2>/dev/null || echo "")',
        'PLAN_CHANGED="" ARCH_CHANGED="" CODE_CHANGED=""',
        'for f in $CHANGED; do',
        '  case "$f" in',
        '    docs/specs/*|docs/plans/*|docs/superpowers/specs/*|docs/superpowers/plans/*) PLAN_CHANGED=1 ;;',
        '    templates/cli/*|index.js|bin/*|.agents/rules/*|.agents/workflows/*|docs/contracts/*|docs/architecture/*) ARCH_CHANGED=1 ;;',
        '    .evo-lite/generated/*|.evo-lite/raw_memory/*|.evo-lite/index_memory/*|.evo-lite/.cache/*) ;;',
        '    *) CODE_CHANGED=1 ;;',
        '  esac',
        'done',
        'NODE_BIN=$(command -v node 2>/dev/null)',
        '[ -z "$NODE_BIN" ] && exit 0',
        '[ -z "${PLAN_CHANGED}${ARCH_CHANGED}${CODE_CHANGED}" ] && exit 0',
        'REPORT_DIR=".evo-lite/generated/governance"',
        'REPORT_PATH="$REPORT_DIR/post-commit-last-run.json"',
        'mkdir -p "$REPORT_DIR"',
        'COMMAND_RESULTS=""',
        'append_result() {',
        '  label="$1"',
        '  ok="$2"',
        '  COMMAND_RESULTS="${COMMAND_RESULTS}${label}\t${ok}\n"',
        '}',
        'run_mem() { "$NODE_BIN" .evo-lite/cli/memory.js "$@"; }',
        'run_and_record() {',
        '  label="$1"',
        '  shift',
        '  if run_mem "$@" 2>/dev/null; then',
        '    append_result "$label" true',
        '  else',
        '    append_result "$label" false',
        '  fi',
        '}',
        '[ -n "$PLAN_CHANGED" ] && run_and_record "plan scan" plan scan',
        '[ -n "$ARCH_CHANGED" ] && run_and_record "architecture scan" architecture scan',
        'run_and_record "plan progress" plan progress',
        '[ -n "$ARCH_CHANGED" ] && run_and_record "architecture diff" architecture diff',
        'EVO_LITE_CHANGED_FILES="$CHANGED" run_and_record "plan gaps" plan gaps --last-commit --changed-files-from-env',
        'run_and_record "dashboard build" dashboard build',
        'HOOK_CHANGED="$CHANGED" HOOK_PLAN_CHANGED="$PLAN_CHANGED" HOOK_ARCH_CHANGED="$ARCH_CHANGED" HOOK_CODE_CHANGED="$CODE_CHANGED" HOOK_COMMANDS="$COMMAND_RESULTS" HOOK_REPORT_PATH="$REPORT_PATH" "$NODE_BIN" -e "const fs=require(\'fs\'); const path=require(\'path\'); const execFileSync=require(\'child_process\').execFileSync; const changed=(process.env.HOOK_CHANGED||\'\').split(/\\s+/).filter(Boolean); const categories=[]; if(process.env.HOOK_PLAN_CHANGED) categories.push(\'plan\'); if(process.env.HOOK_ARCH_CHANGED) categories.push(\'architecture\'); if(process.env.HOOK_CODE_CHANGED) categories.push(\'code\'); const commands=(process.env.HOOK_COMMANDS||\'\').split(/\\n/).filter(Boolean).map(line=>{ const parts=line.split(/\\t/); return { name: parts[0], ok: parts[1]===\'true\' }; }); let commit=\'unknown\'; try { commit=execFileSync(\'git\', [\'rev-parse\', \'--short\', \'HEAD\'], { encoding: \'utf8\' }).trim() || \'unknown\'; } catch (_) {} const payload={ event:\'post-commit\', commit, changedFiles:changed, categories, commands, ok:commands.every(item=>item.ok) }; fs.mkdirSync(path.dirname(process.env.HOOK_REPORT_PATH), { recursive:true }); fs.writeFileSync(process.env.HOOK_REPORT_PATH, JSON.stringify(payload, null, 2), \'utf8\');"',
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

function parseBooleanOption(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
    return null;
}

function registerHookCommands(program) {
    const { getWorkspaceRoot } = require('./runtime');
    const memoryService = require('./memory.service');
    const hook = program.command('hook').alias('hooks').description('Git hook management.');

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
            console.log('Hook will auto-refresh governance data after commits, including code-only commits that need plan gap checks.');
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

    hook.command('advise <event>')
        .description('Inspect Evo-Lite lifecycle advice for hook wrappers.')
        .option('--tool <name>', 'Tool name')
        .option('--command <text>', 'Command text')
        .option('--output <text>', 'Observed output text')
        .option('--success <boolean>', 'Whether the wrapped tool succeeded')
        .option('--target <path>', 'Touched target path', (value, previous) => {
            previous.push(value);
            return previous;
        }, [])
        .option('--json', 'Print JSON output')
        .action((event, options) => {
            const report = memoryService.inspectHookLifecycle(event, {
                command: options.command || '',
                output: options.output || '',
                success: parseBooleanOption(options.success),
                targets: options.target || [],
                tool: options.tool || '',
            });

            if (options.json) {
                console.log(JSON.stringify(report, null, 2));
            } else {
                console.log(`event: ${event}`);
                console.log(`blocked: ${report.blocked ? 'yes' : 'no'}`);
                if (options.tool) {
                    console.log(`tool: ${options.tool}`);
                }
                if (options.command) {
                    console.log(`command: ${options.command}`);
                }
                for (const reminder of report.reminders || []) {
                    console.log(`reminder: ${reminder}`);
                }
                for (const warning of report.warnings || []) {
                    console.log(`warning: ${warning}`);
                }
            }

            if (report.blocked) {
                process.exitCode = 2;
            }
        });
}

module.exports = { installPostCommitHook, registerHookCommands };
