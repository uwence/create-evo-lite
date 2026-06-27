const fs = require('fs');
const memoryService = require('./memory.service');
const { initDB } = require('./db');
const { Command } = require('commander');

function getCliText(argv = process.argv) {
    const action = argv[2];
    const contentIndex = argv.findIndex(arg => arg === '--content' || arg === '--query');
    if (contentIndex !== -1 && argv.length > contentIndex + 1) {
        return argv[contentIndex + 1];
    }

    if (action === 'context') {
        const op = argv[3];
        if (op === 'add' || op === 'focus' || op === 'inject') {
            return argv[4];
        }
        return argv[4];
    }

    if (['memorize', 'recall', 'remember'].includes(action)) {
        return argv[3];
    }

    return argv[3];
}

function readTextFromFile(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`❌ 指定的文件未找到: ${filePath}`);
    }
    return fs.readFileSync(filePath, 'utf8').trim();
}

function resolveCliText(text, options = {}) {
    if (options.file) {
        return readTextFromFile(options.file);
    }
    if (typeof options.content === 'string') {
        return options.content;
    }
    if (typeof options.query === 'string') {
        return options.query;
    }
    return typeof text === 'string' ? text : '';
}

function collectOption(value, previous = []) {
    previous.push(value);
    return previous;
}

function parseSuccessOption(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'ok', 'success'].includes(normalized)) {
        return true;
    }
    if (['false', '0', 'no', 'error', 'failed', 'failure'].includes(normalized)) {
        return false;
    }
    return null;
}

function withTextSourceOptions(command, mode = 'content') {
    command.option('--file <path>', 'Read input text from a file');
    if (mode === 'query') {
        command.option('--query <text>', 'Query text override');
        return command;
    }
    command.option('--content <text>', 'Text content override');
    return command;
}

async function bootstrap() {
    return initDB();
}

function printHelp() {
    console.log(`
🧠 \x1b[1mEvo-Lite Memory CLI\x1b[0m 🧠
=========================================
\x1b[36mUsage:\x1b[0m node .evo-lite/cli/memory.js <command> [arguments]

\x1b[36mCommands:\x1b[0m
  \x1b[32mremember\x1b[0m <text>     Write a new memory fragment into the database.
                      (Must be >40 chars and formatted correctly)
  \x1b[32mrecall\x1b[0m <query>      Local FTS/BM25 search against the memory database.
  \x1b[32mforget\x1b[0m <id>         Permanently purge specific memory by ID.
  \x1b[32mstats\x1b[0m               Display current database capacity and statistics.
  \x1b[32mexport\x1b[0m <file>       Export all memories to a JSON file.
  \x1b[32mimport\x1b[0m <file>       Import memories from a JSON file path.

  \x1b[32mcontext\x1b[0m <op>...     Modify active_context.md anchors (track, add, focus).
                      Read-only ops: read, summary, validate [--json].
  \x1b[32marchive\x1b[0m <text>      Save a summary to raw_memory/ and auto-index it.
    \x1b[32mcommit\x1b[0m <text>       Create code commit, context track, and runtime state meta-commit in one explicit flow.
  \x1b[32msync\x1b[0m                Check for unindexed raw_memory and ingest them.
  \x1b[32mrebuild\x1b[0m             Standard rebuild entry: backup memory.db, then rebuild from raw_memory/.
                      (compatibility command that rebuilds the local FTS index from archive files)
  \x1b[32mvectorize\x1b[0m           Compatibility alias for rebuild.
  \x1b[32mwash\x1b[0m                Compatibility entry that points you to rebuild / /wash workflow.
    \x1b[32mbootstrap\x1b[0m           Read active_context + architecture status + verify,
                                            then print a compact takeover report.
  \x1b[32mverify\x1b[0m              Run initialization checks, git state scans, and
                        database connection verifications.
    \x1b[32mmcp\x1b[0m detect|list|explain [--json]
                                            Read-only MCP capability discovery for the current workspace.
        \x1b[32mhooks\x1b[0m status|verify|install [--json] [--force]
                                                                                        Hook scaffold self-check or install for the current workspace.
  \x1b[32mhelp\x1b[0m                Show this help menu.
=========================================
`);
}

function printResults(results) {
    if (!Array.isArray(results)) {
        console.log(results);
        return;
    }

    if (results.length === 0) {
        console.log('[]');
        return;
    }

    console.log(results);
}

function formatTrackResult(result) {
    const closureComplete = result.status.archive === 'written'
        && result.status.context === 'updated'
        && ['resolved', 'not_requested'].includes(result.status.resolve);
    const nextStep = closureComplete
        ? '可以向用户汇报：代码提交已固化，轨迹与 archive 已完成闭环。'
        : '不要宣称闭环完成；请先根据上面的状态补救 archive / context / resolve。';
    const lines = [
        '✅ Context track completed.',
        `- closure: ${closureComplete ? 'complete' : 'partial'}`,
        `- mechanism: ${result.mechanism}`,
        `- archive: ${result.status.archive}`,
        `- context: ${result.status.context}`,
        `- resolve: ${result.status.resolve}`,
        `- chunks: ${result.chunkCount}`,
        `- archive_path: ${result.archivePath}`,
        `- next_step: ${nextStep}`,
    ];

    if (result.resolvedLine) {
        lines.push(`- resolved_line: ${result.resolvedLine}`);
    }

    return lines.join('\n');
}

function formatCommitFlowResult(result) {
    const closureComplete = result.code.status === 'written'
        && result.track.status === 'complete'
        && result.runtime.status === 'written';
    const lines = [
        `${closureComplete ? '✅' : '⚠️'} Evo-Lite commit flow ${closureComplete ? 'completed' : 'ended partial'}.`,
        `- stage_mode: ${result.stageMode}`,
        `- code_snapshot: ${result.code.status}`,
    ];

    if (result.code.commitHash) {
        lines.push(`- code_commit: ${result.code.commitHash}`);
    }
    if (result.code.message) {
        lines.push(`- code_message: ${result.code.message}`);
    }

    lines.push(`- context_closure: ${result.track.status}`);
    if (result.track.result) {
        lines.push(`- mechanism: ${result.track.result.mechanism}`);
        lines.push(`- archive: ${result.track.result.status.archive}`);
        lines.push(`- context: ${result.track.result.status.context}`);
        lines.push(`- resolve: ${result.track.result.status.resolve}`);
        lines.push(`- archive_path: ${result.track.result.archivePath}`);
        if (result.track.result.resolvedLine) {
            lines.push(`- resolved_line: ${result.track.result.resolvedLine}`);
        }
    }

    lines.push(`- runtime_meta: ${result.runtime.status}`);
    if (result.runtime.commitHash) {
        lines.push(`- runtime_commit: ${result.runtime.commitHash}`);
    }
    if (result.runtime.message) {
        lines.push(`- runtime_message: ${result.runtime.message}`);
    }
    for (const file of result.runtime.files || []) {
        lines.push(`- runtime_file: ${file}`);
    }

    if (result.errorStage) {
        lines.push(`- error_stage: ${result.errorStage}`);
        lines.push(`- error: ${result.errorMessage}`);
    }

    const nextStep = closureComplete
        ? '可以向用户汇报：代码快照、context track、runtime state meta-commit 已完成一次显式闭环。'
        : result.errorStage === 'track'
            ? '代码快照已提交；请先补救 context track，然后再提交运行时状态文件。'
            : result.errorStage === 'meta-commit'
                ? 'context track 已完成；请补做 runtime state 的 meta-commit，不要再次运行 context track。'
                : '请先补齐当前闭环步骤，再继续下一个任务。';
    lines.push(`- next_step: ${nextStep}`);
    return lines.join('\n');
}

function printPayload(payload, formatter, options = {}) {
    if (options.json === true) {
        console.log(JSON.stringify(payload, null, 2));
        return;
    }
    console.log(formatter(payload));
}

function formatContextRead(snapshot) {
    return [
        `active_context: ${snapshot.path}`,
        '',
        'META:',
        snapshot.sections.meta || '(empty)',
        '',
        'FOCUS:',
        snapshot.sections.focus || '(empty)',
        '',
        'BACKLOG:',
        snapshot.sections.backlog || '(empty)',
        '',
        'TRAJECTORY:',
        snapshot.sections.trajectory || '(empty)',
    ].join('\n');
}

function formatContextSummary(summary) {
    const lines = [
        `active_context: ${summary.path}`,
        `focus: ${summary.focus || '(empty)'}`,
        `active_tasks: ${summary.activeTasks.length}`,
        `trajectory_entries: ${summary.trajectoryCount}`,
        `validation: ${summary.validation.valid ? 'valid' : 'invalid'}`,
    ];
    if (summary.latestTrajectory) {
        lines.push(`latest: ${summary.latestTrajectory.line}`);
    }
    for (const warning of summary.validation.warnings) {
        lines.push(`warning: ${warning}`);
    }
    for (const error of summary.validation.errors) {
        lines.push(`error: ${error}`);
    }
    return lines.join('\n');
}

function formatContextValidation(validation) {
    const lines = [`active_context validation: ${validation.valid ? 'valid' : 'invalid'}`];
    for (const warning of validation.warnings) {
        lines.push(`warning: ${warning}`);
    }
    for (const error of validation.errors) {
        lines.push(`error: ${error}`);
    }
    return lines.join('\n');
}

function formatContextEvents(events) {
    if (!Array.isArray(events) || events.length === 0) {
        return 'session_events: 0';
    }
    const lines = [`session_events: ${events.length}`];
    for (const row of events) {
        lines.push(`- [${row.id}] ${row.timestamp} event=${row.event} tool=${row.tool || 'n/a'} success=${row.success === null ? 'unknown' : row.success ? 'yes' : 'no'}`);
    }
    return lines.join('\n');
}

function formatBootstrapReport(payload) {
    const context = payload.context;
    const sessionstart = payload.sessionstart;
    const verify = payload.verify;
    const takeoverRecall = payload.takeoverRecall || { status: 'no-match', effect: 'fresh-takeover', queries: [], hits: [] };
    const nextSteps = [...new Set([...(sessionstart.reminders || []), ...(verify.nextSteps || [])])].slice(0, 4);
    const warnings = [...new Set([...(sessionstart.warnings || []), ...((context.validation && context.validation.warnings) || [])])].slice(0, 3);
    const needsBootstrap = ['placeholder', 'missing'].includes(sessionstart.contextStatus)
        || ['placeholder', 'missing'].includes(sessionstart.architectureStatus);
    const takeover = verify.hasAlerts
        ? 'attention-needed'
        : needsBootstrap
            ? 'bootstrap-pending'
            : 'ready';

    const lines = [
        `takeover: ${takeover}`,
        `focus: ${sessionstart.focus || '(empty)'}`,
        `active_tasks: ${sessionstart.activeTaskCount}`,
        `trajectory_entries: ${context.trajectoryCount}`,
        `context_status: ${sessionstart.contextStatus || 'unknown'}`,
        `architecture_status: ${sessionstart.architectureStatus || 'unknown'}`,
        `git_status: ${verify.git}`,
        `template_sync: ${verify.templateSync}`,
        `local_engine: ${verify.localEngine}`,
        `entity_store: ${verify.entityStore}`,
        `memory_status: ${takeoverRecall.status || 'no-match'}`,
    ];

    if (Array.isArray(takeoverRecall.queries)) {
        for (const query of takeoverRecall.queries) {
            if (query && query.source && query.text) {
                lines.push(`memory_query: ${query.source}:${query.text}`);
            }
        }
    }

    if (Array.isArray(takeoverRecall.hits) && takeoverRecall.hits.length > 0) {
        for (const hit of takeoverRecall.hits) {
            if (hit.label) {
                lines.push(`memory_hit: ${hit.label}`);
            }
            if (hit.effect) {
                lines.push(`memory_effect: ${hit.effect}`);
            }
        }
    } else {
        lines.push(`memory_effect: ${takeoverRecall.effect || 'fresh-takeover'}`);
    }

    if (context.latestTrajectory) {
        lines.push(`latest: ${context.latestTrajectory.line}`);
    }

    for (const warning of warnings) {
        lines.push(`warning: ${warning}`);
    }
    for (const step of nextSteps) {
        lines.push(`next_step: ${step}`);
    }

    if (Array.isArray(takeoverRecall.reflections) && takeoverRecall.reflections.length > 0) {
        lines.push('');
        lines.push('================================================================================');
        lines.push('💡 Evo-Lite 历史避坑与决策联想 (Technical Avoidance & Architecture Reflections)');
        lines.push('--------------------------------------------------------------------------------');
        for (const item of takeoverRecall.reflections) {
            lines.push(`🔍 召回技术词: [${item.keyword}] | Memory ID: ${item.memoryId} | Namespace: ${item.namespace}`);
            lines.push('');
            const indentedReflection = item.reflection
                .split('\n')
                .map(line => '   ' + line)
                .join('\n');
            lines.push(indentedReflection);
            lines.push('--------------------------------------------------------------------------------');
        }
        lines.push('================================================================================');
    }

    return lines.join('\n');
}

async function runContextCommand(op, text, options = {}) {
    if (op === 'read') {
        printPayload(memoryService.readActiveContext(), formatContextRead, options);
        return;
    }

    if (op === 'summary') {
        printPayload(memoryService.summarizeActiveContext(), formatContextSummary, options);
        return;
    }

    if (op === 'validate') {
        printPayload(memoryService.validateActiveContextFile(), formatContextValidation, options);
        return;
    }

    if (op === 'events') {
        const limit = Number.isInteger(options.limit) ? options.limit : Number.parseInt(String(options.limit || '20'), 10);
        const rows = memoryService.readSessionEvents({
            event: options.event || null,
            limit: Number.isFinite(limit) ? limit : 20,
        });
        printPayload(rows, formatContextEvents, options);
        return;
    }

    if (op === 'track') {
        const details = typeof options.details === 'string'
            ? options.details
            : resolveCliText(text, options);
        const result = await memoryService.track(options.mechanism, details, {
            resolve: options.resolve || null,
            type: options.type || 'task',
        });
        console.log(formatTrackResult(result));
        return;
    }

    if (op === 'add') {
        const taskText = resolveCliText(text, options);
        if (!taskText) {
            throw new Error('Usage: node .evo-lite/cli/memory.js context add "新任务描述"');
        }
        console.log(memoryService.addTask(taskText));
        return;
    }

    if (op === 'focus') {
        const focusText = resolveCliText(text, options);
        if (!focusText) {
            throw new Error('Usage: node .evo-lite/cli/memory.js context focus "新焦点内容"');
        }
        console.log(memoryService.setFocus(focusText));
        return;
    }

    if (op === 'inject') {
        memoryService.inject(resolveCliText(text, options));
        return;
    }

    if (op === 'auto-refresh') {
        const result = memoryService.autoRefreshContext();
        printPayload(result, formatAutoRefreshResult, options);
        return;
    }

    if (op === 'advance-focus') {
        const result = memoryService.advanceFocusFromCommit({
            commitMessage: typeof options.message === 'string' ? options.message : undefined,
        });
        printPayload(result, formatAdvanceFocusResult, options);
        return;
    }

    throw new Error(`Unknown context operation: '${op}'.`);
}

function formatAdvanceFocusResult(result) {
    if (!result) return 'no-op';
    switch (result.status) {
        case 'disabled': return 'focus auto-advance disabled (EVO_LITE_NO_FOCUS_AUTOADVANCE=1)';
        case 'no-plan-ir': return 'no plan-ir.json; run `mem plan scan` first';
        case 'no-reference': return 'commit references no plan/spec; focus unchanged';
        case 'no-match': return `commit references ${result.ref} but no matching plan in IR; focus unchanged`;
        case 'unchanged': return `focus already current for ${result.plan} ("${result.focusAfter}")`;
        case 'ok': return `focus advanced from "${result.focusBefore || '<empty>'}" → "${result.focusAfter}" (${result.plan})`;
        default: return `focus auto-advance: ${result.status}`;
    }
}

function formatAutoRefreshResult(result) {
    if (!result) return 'no-op';
    if (result.status === 'no-plan-ir') return `no plan-ir.json: ${result.hint}`;
    const lines = [];
    if (result.focusChanged) {
        lines.push(`focus: "${result.focusBefore || '<empty>'}" → "${result.focusAfter}"`);
    } else {
        lines.push(`focus: unchanged ("${result.focusAfter || result.focusBefore || '<empty>'}")`);
    }
    lines.push(`backlog pruned: ${result.backlogPruned.length}`);
    for (const line of result.backlogPruned) lines.push(`  - ${line}`);
    return lines.join('\n');
}

async function runBootstrapCommand(options = {}) {
    await bootstrap();
    const context = memoryService.summarizeActiveContext();
    const verify = await memoryService.verify({ silent: true });
    const sessionstart = memoryService.inspectLocalState('sessionstart');
    const takeoverRecall = await memoryService.buildTakeoverRecall(context, verify);
    printPayload({ context, sessionstart, verify, takeoverRecall }, formatBootstrapReport, options);
}

async function runCommitCommand(details, options = {}) {
    await bootstrap();
    const commitDetails = typeof options.details === 'string'
        ? options.details
        : resolveCliText(details, options);
    if (!commitDetails) {
        throw new Error('Usage: node .evo-lite/cli/memory.js commit "闭环详情" --code-message="feat(...): ..." --mechanism="机制名"');
    }
    const result = await memoryService.commitWithContext(options.codeMessage, options.mechanism, commitDetails, {
        resolve: options.resolve || null,
        silent: options.json === true,
        type: options.type || 'task',
        stage: options.stage || 'staged',
        metaMessage: options.metaMessage || 'chore(meta): snapshot evo-lite runtime state',
    });
    printPayload(result, formatCommitFlowResult, options);
    if (result.errorStage) {
        process.exitCode = 2;
    }
}

function buildProgram() {
    const program = new Command();
    const contextCommand = program.command('context').description('Modify active_context.md anchors and inspect runtime state.');

    program
        .name('memory')
        .description('Evo-Lite runtime CLI')
        .showHelpAfterError();

    program.command('bootstrap')
        .alias('evo-start')
        .description('Read active_context, inspect architecture bootstrap state, and print a compact takeover report.')
        .option('--json', 'Print JSON output')
        .action(async options => {
            await runBootstrapCommand(options);
        });

    withTextSourceOptions(
        program.command('commit [details]').description('Create code commit, context track, and runtime state snapshot in one flow.')
    )
        .requiredOption('--code-message <message>', 'Commit message for the code snapshot')
        .requiredOption('--mechanism <mechanism>', 'Mechanism label for trajectory tracking')
        .option('--details <text>', 'Detailed archive text override')
        .option('--resolve <hash>', 'Resolve a backlog hash')
        .option('--type <type>', 'Archive type', 'task')
        .option('--stage <mode>', 'How to prepare the code snapshot: staged or all', 'staged')
        .option('--meta-message <message>', 'Commit message for the runtime state snapshot', 'chore(meta): snapshot evo-lite runtime state')
        .option('--json', 'Print JSON output')
        .action(async (details, options) => {
            await runCommitCommand(details, options);
        });

    withTextSourceOptions(
        program.command('remember [text]').alias('memorize').description('Write a new memory fragment into the database.')
    ).action(async (text, options) => {
        await bootstrap();
        const memoryText = resolveCliText(text, options);
        if (!memoryText) {
            throw new Error('Usage: node memory.js remember <"text message"> OR node memory.js remember --file=<path>');
        }
        await memoryService.memorize(memoryText);
    });

    withTextSourceOptions(
        program.command('recall [query]').description('Local FTS/BM25 search against the memory database.'),
        'query'
    ).action(async (query, options) => {
        await bootstrap();
        const recallQuery = resolveCliText(query, options);
        if (!recallQuery) {
            throw new Error('Usage: node memory.js recall <"text message"> OR node memory.js recall --file=<path>');
        }
        printResults(await memoryService.recall(recallQuery));
    });

    program.command('forget <id>').description('Permanently purge specific memory by ID.').action(async id => {
        await bootstrap();
        memoryService.forget(id);
    });

    program.command('list').description('List all stored memories.').action(async () => {
        await bootstrap();
        console.log(memoryService.list());
    });

    program.command('stats').description('Display current database capacity and statistics.').action(async () => {
        await bootstrap();
        console.log(memoryService.stats());
    });

    program.command('export <file>').description('Export all memories to a JSON file.').action(async file => {
        await bootstrap();
        memoryService.exportMemories(file);
    });

    program.command('import <file>').description('Import memories from a JSON file path.').action(async file => {
        await bootstrap();
        await memoryService.importMemories(file);
    });

    withTextSourceOptions(
        program.command('archive [text]').description('Save a summary to raw_memory/ and auto-index it.')
    )
        .option('--type <type>', 'Archive type', 'task')
        .action(async (text, options) => {
            await bootstrap();
            const archiveText = resolveCliText(text, options);
            if (!archiveText) {
                throw new Error('Usage: node memory.js archive <"text message"> [--type=task|bug|note]');
            }
            console.log(await memoryService.archive(archiveText, options.type || 'task'));
        });

    program.command('sync').description('Check for unindexed raw_memory and ingest them.').action(async () => {
        await bootstrap();
        console.log(await memoryService.syncIndexMemory());
    });

    program.command('rebuild').alias('vectorize').description('Rebuild the local FTS index from archive files.').action(async () => {
        await bootstrap();
        await memoryService.rebuildLocalIndex();
    });

    program.command('wash').description('Compatibility entry that points you to rebuild / /wash workflow.').action(() => {
        memoryService.wash();
    });

    program.command('verify').description('Run initialization checks, git state scans, and database verifications.').action(async () => {
        await memoryService.verify();
    });



    contextCommand.command('read').option('--json', 'Print JSON output').action(async options => {
        await runContextCommand('read', '', options);
    });
    contextCommand.command('summary').option('--json', 'Print JSON output').action(async options => {
        await runContextCommand('summary', '', options);
    });
    contextCommand.command('validate').option('--json', 'Print JSON output').action(async options => {
        await runContextCommand('validate', '', options);
    });
    contextCommand.command('events')
        .option('--limit <number>', 'Max rows to return', value => parseInt(value, 10), 20)
        .option('--event <name>', 'Filter by event name')
        .option('--json', 'Print JSON output')
        .action(async options => {
            await runContextCommand('events', '', options);
        });
    withTextSourceOptions(
        contextCommand.command('track [details]').description('Persist a completed action into trajectory and archive.')
    )
        .requiredOption('--mechanism <mechanism>', 'Mechanism label for trajectory tracking')
        .option('--details <text>', 'Detailed archive text override')
        .option('--resolve <hash>', 'Resolve a backlog hash')
        .option('--type <type>', 'Archive type', 'task')
        .action(async (details, options) => {
            await runContextCommand('track', details, options);
        });
    withTextSourceOptions(
        contextCommand.command('add [text]').description('Add a new backlog item.')
    ).action(async (text, options) => {
        await runContextCommand('add', text, options);
    });
    withTextSourceOptions(
        contextCommand.command('focus [text]').description('Set the current focus text.')
    ).action(async (text, options) => {
        await runContextCommand('focus', text, options);
    });
    contextCommand.command('auto-refresh')
        .description('Re-derive focus from active plan + prune backlog entries whose linked task is implemented. Idempotent.')
        .option('--json', 'Print JSON output')
        .action(async options => {
            await runContextCommand('auto-refresh', '', options);
        });
    contextCommand.command('advance-focus')
        .description('Conservatively advance focus to a plan referenced in the latest commit message. No-op unless the commit explicitly names a known plan/spec. Opt out with EVO_LITE_NO_FOCUS_AUTOADVANCE=1.')
        .option('--message <text>', 'Override the commit message to inspect (defaults to HEAD).')
        .option('--json', 'Print JSON output')
        .action(async options => {
            await runContextCommand('advance-focus', '', options);
        });
    withTextSourceOptions(
        contextCommand.command('inject [text]').description('Internal/experimental context inject command.')
    ).action(async (text, options) => {
        await runContextCommand('inject', text, options);
    });
    contextCommand.action(() => {
        contextCommand.outputHelp();
    });

    withTextSourceOptions(
        program.command('track [details]').description('Alias for context track.')
    )
        .requiredOption('--mechanism <mechanism>', 'Mechanism label for trajectory tracking')
        .option('--details <text>', 'Detailed archive text override')
        .option('--resolve <hash>', 'Resolve a backlog hash')
        .option('--type <type>', 'Archive type', 'task')
        .action(async (details, options) => {
            await runContextCommand('track', details, options);
        });
    withTextSourceOptions(program.command('add [text]').description('Alias for context add.')).action(async (text, options) => {
        await runContextCommand('add', text, options);
    });
    withTextSourceOptions(program.command('focus [text]').description('Alias for context focus.')).action(async (text, options) => {
        await runContextCommand('focus', text, options);
    });

    require('./planning').registerPlanCommands(program);
    require('./architecture').registerArchitectureCommands(program);
    require('./verification/commands').registerVerificationCommands(program);
    require('./verification/close-commands').registerCloseCommands(program);
    require('./dashboard-data').registerDashboardCommands(program);
    require('./hooks').registerHookCommands(program);
    require('./sync-runtime').registerSyncRuntimeCommands(program);

    program.command('inspect')
        .description('Run the inspector HTTP server.')
        .option('--port <port>', 'Preferred port', value => parseInt(value, 10), 0)
        .action(async options => {
            const inspector = require('./inspector');
            await inspector.runInspectCommand({ port: options.port || 0 });
            await new Promise(() => {});
        });

    program.command('mcp')
        .description('Start the Evo-Lite MCP server (stdio transport).')
        .action(async () => {
            const { runMcpServer } = require('./mcp-server');
            await runMcpServer();
        });

    program.action(() => {
        program.outputHelp();
    });

    return program;
}

async function run(argv = process.argv) {
    const program = buildProgram();
    if (!Array.isArray(argv) || argv.length <= 2) {
        program.outputHelp();
        return;
    }
    await program.parseAsync(argv);
}

if (require.main === module) {
    run().catch(error => {
        console.error(`❌ CLI 执行出错: ${error.message}`);
        process.exit(1);
    });
}

module.exports = {
    formatCommitFlowResult,
    formatTrackResult,
    getCliText,
    run,
};
