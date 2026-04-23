const fs = require('fs');
const memoryService = require('./memory.service');
const { initDB } = require('./db');

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

const action = process.argv[2];
let text = getCliText(process.argv);

const typeArg = process.argv.find(arg => arg.startsWith('--type='));
const archiveType = typeArg ? typeArg.split('=')[1] : 'task';

const fileArg = process.argv.find(arg => arg.startsWith('--file='));
if (fileArg) {
    const filePath = fileArg.split('=')[1];
    if (fs.existsSync(filePath)) {
        text = fs.readFileSync(filePath, 'utf8').trim();
    } else {
        console.error(`❌ 指定的文件未找到: ${filePath}`);
        process.exit(1);
    }
}

async function bootstrap() {
    const { initEmbeddingModel, getActiveModelInfo } = require('./models');
    await initEmbeddingModel();
    const { model, dims } = getActiveModelInfo();
    return initDB(model, dims);
}

function printHelp() {
    console.log(`
🧠 \x1b[1mEvo-Lite Memory CLI\x1b[0m 🧠
=========================================
\x1b[36mUsage:\x1b[0m node .evo-lite/cli/memory.js <command> [arguments]

\x1b[36mCommands:\x1b[0m
  \x1b[32mremember\x1b[0m <text>     Write a new memory fragment into the database.
                      (Must be >40 chars and formatted correctly)
  \x1b[32mrecall\x1b[0m <query>      Semantic search against the memory database.
  \x1b[32mforget\x1b[0m <id>         Permanently purge specific memory by ID.
  \x1b[32mstats\x1b[0m               Display current database capacity and statistics.
  \x1b[32mexport\x1b[0m <file>       Export all memories to a JSON file.
  \x1b[32mimport\x1b[0m <file>       Import memories from a JSON file path.

  \x1b[32mcontext\x1b[0m <op>...     Modify active_context.md anchors (track, add, focus).
  \x1b[32marchive\x1b[0m <text>      Save a summary to raw_memory/ and auto-vectorize it.
  \x1b[32msync\x1b[0m                Check for unvectorized raw_memory and incrementally vectorize them.
  \x1b[32mrebuild\x1b[0m             Standard rebuild entry: backup memory.db, then rebuild from raw_memory/.
                      (remember-only cache entries are not guaranteed to survive this rebuild)
  \x1b[32mvectorize\x1b[0m           Low-level interactive rebuild command used by rebuild / wash.
  \x1b[32mwash\x1b[0m                Compatibility entry that points you to rebuild / /wash workflow.
  \x1b[32mverify\x1b[0m              Run initialization checks, git state scans, and
                        database connection verifications.
                      Use \x1b[33m--retry-reranker\x1b[0m to explicitly retry the reranker download.
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

async function runContextCommand() {
    const op = process.argv[3];
    if (op === 'track') {
        const mechanismArg = process.argv.find(arg => arg.startsWith('--mechanism='));
        const mechanism = mechanismArg ? mechanismArg.substring('--mechanism='.length) : null;
        const detailsArg = process.argv.find(arg => arg.startsWith('--details='));
        const details = detailsArg ? detailsArg.substring('--details='.length) : text || '';
        const resolveArg = process.argv.find(arg => arg.startsWith('--resolve='));
        const type = archiveType;
        const result = await memoryService.track(mechanism, details, {
            resolve: resolveArg ? resolveArg.substring('--resolve='.length) : null,
            type,
        });
        console.log(formatTrackResult(result));
        return;
    }

    if (op === 'add') {
        if (!text) {
            throw new Error('Usage: node .evo-lite/cli/memory.js context add "新任务描述"');
        }
        console.log(memoryService.addTask(text));
        return;
    }

    if (op === 'focus') {
        if (!text) {
            throw new Error('Usage: node .evo-lite/cli/memory.js context focus "新焦点内容"');
        }
        console.log(memoryService.setFocus(text));
        return;
    }

    if (op === 'inject') {
        memoryService.inject(text);
        return;
    }

    throw new Error(`Unknown context operation: '${op}'.`);
}

async function run() {
    if (action === 'remember' || action === 'memorize') {
        await bootstrap();
        if (!text) {
            throw new Error('Usage: node memory.js remember <"text message"> OR node memory.js remember --file=<path>');
        }
        await memoryService.memorize(text);
        return;
    }

    if (action === 'recall') {
        await bootstrap();
        if (!text) {
            throw new Error('Usage: node memory.js recall <"text message"> OR node memory.js recall --file=<path>');
        }
        printResults(await memoryService.recall(text));
        return;
    }

    if (action === 'forget') {
        await bootstrap();
        memoryService.forget(text);
        return;
    }

    if (action === 'list' || action === 'stats') {
        await bootstrap();
        console.log(action === 'stats' ? memoryService.stats() : memoryService.list());
        return;
    }

    if (action === 'export') {
        await bootstrap();
        memoryService.exportMemories(text);
        return;
    }

    if (action === 'import') {
        await bootstrap();
        await memoryService.importMemories(text);
        return;
    }

    if (action === 'archive') {
        await bootstrap();
        const archiveText = text && text.startsWith('--') ? '' : text;
        if (!archiveText) {
            throw new Error('Usage: node memory.js archive <"text message"> [--type=task|bug|note]');
        }
        console.log(await memoryService.archive(archiveText, archiveType));
        return;
    }

    if (action === 'sync') {
        await bootstrap();
        console.log(await memoryService.syncVectorMemory());
        return;
    }

    if (action === 'rebuild' || action === 'vectorize') {
        await bootstrap();
        await memoryService.vectorize();
        return;
    }

    if (action === 'wash') {
        memoryService.wash();
        return;
    }

    if (action === 'verify') {
        await memoryService.verify({
            retryReranker: process.argv.includes('--retry-reranker'),
        });
        return;
    }

    if (action === 'context') {
        await runContextCommand();
        return;
    }

    if (action === 'track') {
        process.argv.splice(2, 1, 'context', 'track');
        await runContextCommand();
        return;
    }

    if (action === 'focus') {
        process.argv.splice(2, 1, 'context', 'focus');
        await runContextCommand();
        return;
    }

    if (action === 'add') {
        process.argv.splice(2, 1, 'context', 'add');
        await runContextCommand();
        return;
    }

    if (action === 'inspect') {
        const inspector = require('./inspector');
        const portArg = process.argv.find(arg => arg.startsWith('--port='));
        const port = portArg ? parseInt(portArg.substring('--port='.length), 10) : 0;
        await inspector.runInspectCommand({ port });
        // Keep the process alive; runInspectCommand registers its own SIGINT handler.
        await new Promise(() => {});
        return;
    }

    if (!action || action === 'help') {
        printHelp();
        return;
    }

    throw new Error(`Unknown action: '${action}'. Run 'node .evo-lite/cli/memory.js help' for usage.`);
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
