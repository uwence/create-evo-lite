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
  \x1b[32msync\x1b[0m                Check for unindexed raw_memory and ingest them.
  \x1b[32mrebuild\x1b[0m             Standard rebuild entry: backup memory.db, then rebuild from raw_memory/.
                      (compatibility command that rebuilds the local FTS index from archive files)
  \x1b[32mvectorize\x1b[0m           Compatibility alias for rebuild.
  \x1b[32mwash\x1b[0m                Compatibility entry that points you to rebuild / /wash workflow.
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

function formatHookScaffold(report) {
    const lines = [
        `hook_scaffold: ${report.valid ? 'ready' : 'needs-attention'}`,
        `workspace: ${report.workspaceRoot}`,
        `assets: ${report.assets.length}`,
    ];
    for (const asset of report.assets) {
        const syncLabel = asset.synced === null ? 'n/a' : asset.synced ? 'synced' : 'drift';
        lines.push(`- ${asset.label}: ${asset.status} (${syncLabel})`);
    }
    for (const warning of report.warnings) {
        lines.push(`warning: ${warning}`);
    }
    return lines.join('\n');
}

function formatHookInstall(result) {
    const lines = [
        `hook_install: ${result.valid ? 'complete' : 'partial'}`,
        `workspace: ${result.workspaceRoot}`,
        `installed: ${result.installed.length}`,
        `overwritten: ${result.overwritten.length}`,
        `skipped: ${result.skipped.length}`,
    ];
    for (const label of result.installed) {
        lines.push(`installed: ${label}`);
    }
    for (const label of result.overwritten) {
        lines.push(`overwritten: ${label}`);
    }
    for (const label of result.skipped) {
        lines.push(`skipped: ${label}`);
    }
    for (const label of result.missingTemplates) {
        lines.push(`warning: template missing for ${label}`);
    }
    lines.push(`next_step: node .evo-lite/cli/memory.js hooks verify${result.valid ? '' : ' --json'}`);
    return lines.join('\n');
}

function formatHookLifecycle(report) {
    const lines = [
        `hook_lifecycle: ${report.valid ? 'clear' : 'action-needed'}`,
        `event: ${report.event}`,
        `workspace: ${report.workspaceRoot}`,
        `focus: ${report.focus || '(empty)'}`,
        `active_tasks: ${report.activeTaskCount}`,
        `architecture_status: ${report.architectureStatus || 'unknown'}`,
        `blocked: ${report.blocked ? 'yes' : 'no'}`,
        `dirty: ${report.dirty === null ? 'unknown' : report.dirty ? 'yes' : 'no'}`,
        `track_needs_update: ${report.trackNeedsUpdate ? 'yes' : 'no'}`,
    ];
    if (report.tool) {
        lines.push(`tool: ${report.tool}`);
    }
    if (report.command) {
        lines.push(`command: ${report.command}`);
    }
    if (report.success !== null) {
        lines.push(`success: ${report.success ? 'yes' : 'no'}`);
    }
    if (report.latestTrajectory) {
        lines.push(`latest: ${report.latestTrajectory.line}`);
    }
    for (const reminder of report.reminders) {
        lines.push(`reminder: ${reminder}`);
    }
    for (const warning of report.warnings) {
        lines.push(`warning: ${warning}`);
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

    throw new Error(`Unknown context operation: '${op}'.`);
}

async function runHooksCommand(op = 'status', options = {}) {
    if (!['status', 'verify', 'install', 'advise'].includes(op)) {
        throw new Error(`Unknown hooks operation: '${op}'. Use status, verify, install, or advise.`);
    }
    if (op === 'install') {
        printPayload(memoryService.installHookScaffold({ force: options.force === true }), formatHookInstall, options);
        return;
    }
    if (op === 'advise') {
        const report = memoryService.inspectHookLifecycle(options.event || 'sessionstart', {
            command: options.command || null,
            output: options.output || null,
            success: parseSuccessOption(options.success),
            targets: Array.isArray(options.target) ? options.target : [],
            tool: options.tool || null,
        });
        printPayload(report, formatHookLifecycle, options);
        if (report.blocked) {
            process.exitCode = 2;
        }
        return;
    }
    printPayload(memoryService.inspectHookScaffold(), formatHookScaffold, options);
}

async function runMcpCommand(op = 'detect', options = {}) {
    const mcpDetect = require('./mcp-detect');
    if (!['detect', 'list', 'explain'].includes(op)) {
        throw new Error(`Unknown mcp operation: '${op}'. Use detect, list, or explain.`);
    }
    const report = mcpDetect.detectMcpCapabilities();
    printPayload(report, payload => mcpDetect.formatMcpReport(payload, { explain: op === 'explain' }), options);
}

function buildProgram() {
    const program = new Command();
    const contextCommand = program.command('context').description('Modify active_context.md anchors and inspect runtime state.');
    const hooksCommand = program.command('hooks').description('Inspect or install hook scaffold assets.');
    const mcpCommand = program.command('mcp').description('Read-only MCP capability discovery for the current workspace.');

    program
        .name('memory')
        .description('Evo-Lite runtime CLI')
        .showHelpAfterError();

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

    mcpCommand.command('detect').option('--json', 'Print JSON output').action(async options => {
        await runMcpCommand('detect', options);
    });
    mcpCommand.command('list').option('--json', 'Print JSON output').action(async options => {
        await runMcpCommand('list', options);
    });
    mcpCommand.command('explain').option('--json', 'Print JSON output').action(async options => {
        await runMcpCommand('explain', options);
    });
    mcpCommand.action(async () => {
        await runMcpCommand('detect');
    });

    hooksCommand.command('status').option('--json', 'Print JSON output').action(async options => {
        await runHooksCommand('status', options);
    });
    hooksCommand.command('verify').option('--json', 'Print JSON output').action(async options => {
        await runHooksCommand('verify', options);
    });
    hooksCommand.command('install')
        .option('--json', 'Print JSON output')
        .option('--force', 'Overwrite existing hook assets after backing them up')
        .action(async options => {
            await runHooksCommand('install', options);
        });
    hooksCommand.command('advise [event]')
        .option('--json', 'Print JSON output')
        .option('--tool <tool>', 'Tool name')
        .option('--command <command>', 'Associated command text')
        .option('--output <output>', 'Associated output text')
        .option('--target <path>', 'Touched target path', collectOption, [])
        .option('--success <state>', 'Normalized success state')
        .action(async (event, options) => {
            await runHooksCommand('advise', {
                ...options,
                event: event || 'sessionstart',
            });
        });
    hooksCommand.action(async () => {
        await runHooksCommand('status');
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

    program.command('inspect')
        .description('Run the inspector HTTP server.')
        .option('--port <port>', 'Preferred port', value => parseInt(value, 10), 0)
        .action(async options => {
            const inspector = require('./inspector');
            await inspector.runInspectCommand({ port: options.port || 0 });
            await new Promise(() => {});
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
    formatTrackResult,
    getCliText,
    run,
};
