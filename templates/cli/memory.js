const fs = require('fs');
const path = require('path');
const memoryService = require('./memory.service');
const { initDB } = require('./db');

const action = process.argv[2];
let text;
const contentIndex = process.argv.findIndex(arg => arg === '--content' || arg === '--query');

if (contentIndex !== -1 && process.argv.length > contentIndex + 1) {
  text = process.argv[contentIndex + 1];
} else if (action !== 'memorize' && action !== 'recall' && action !== 'remember') {
  text = process.argv[3];
}
const typeArg = process.argv.find(arg => arg.startsWith('--type='));
const archiveType = typeArg ? typeArg.split('=')[1] : 'task';

// Support reading long/complex inputs from file to prevent shell truncation
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

async function run() {
    const { initEmbeddingModel, getActiveModelInfo } = require('./models');

    await initEmbeddingModel();
    const { model, dims } = getActiveModelInfo();
    initDB(model, dims);

    if (action === 'remember' || action === 'memorize') {
        if (!text) return console.log('Usage: node memory.js remember <"text message"> OR node memory.js remember --file=<path>');
        await memoryService.memorize(text);
    } else if (action === 'recall') {
        if (!text) return console.log('Usage: node memory.js recall <"text message"> OR node memory.js recall --file=<path>');
        const results = await memoryService.recall(text);
        console.log(results);
    } else if (action === 'forget') {
        if (!text) return console.log('Usage: node memory.js forget <id>');
        memoryService.forget(text);
    } else if (action === 'list' || action === 'stats') {
        const results = memoryService.list();
        console.log(results);
    } else if (action === 'wash') {
        memoryService.wash();
    } else if (action === 'verify') {
        memoryService.verify();
    } else if (action === 'context') {
        const op = process.argv[3];
        if (op === 'track') {
            const mechanismArg = process.argv.find(arg => arg.startsWith('--mechanism='));
            const mechanism = mechanismArg ? mechanismArg.substring('--mechanism='.length) : 'Unknown';
            const detailsArg = process.argv.find(arg => arg.startsWith('--details='));
            const details = detailsArg ? detailsArg.substring('--details='.length) : text || '';
            memoryService.track(mechanism, details);
        } else if (op === 'inject') {
            memoryService.inject(text);
        } else {
            console.log(`❌ Unknown context operation: '${op}'.`);
        }
    } else if (!action || action === 'help') {
        console.log(`
🧠 \x1b[1mEvo-Lite Memory CLI\x1b[0m 🧠
=========================================
\x1b[36mUsage:\x1b[0m node .evo-lite/cli/memory.js <command> [arguments]

\x1b[36mCommands:\x1b[0m
  \x1b[32mremember\x1b[0m <text>     Write a new memory fragment into the database.
                      (Must be >40 chars and formatted correctly)
  \x1b[32mrecall\x1b[0m <query>      Semantic search against the memory database.
  \x1b[32mforget\x1b[0m <id>       Permanently purge specific memory by ID.
  \x1b[32mstats\x1b[0m             Display current database capacity and statistics.
  \x1b[32mexport\x1b[0m <file>     Export all memories to a JSON file (stdout).
  \x1b[32mimport\x1b[0m <file>     Import memories from a JSON file path.

  \x1b[32mcontext\x1b[0m <op>...   Modify active_context.md anchors (track, add, focus).
  \x1b[32marchive\x1b[0m <text>    Save a summary to raw_memory/ and auto-vectorize it.
  \x1b[32msync\x1b[0m              Check for unvectorized raw_memory and and incrementally vectorize them.
  \x1b[32mvectorize\x1b[0m         Rebuild vector index interactively.
  \x1b[32mverify\x1b[0m            Run initialization checks, git state scans, and
                      database connection verifications.
  \x1b[32mhelp\x1b[0m              Show this help menu.
=========================================
`);
    } else {
        console.log(`❌ Unknown action: '${action}'. Run 'node .evo-lite/cli/memory.js help' for usage.`);
    }
}

run().catch(error => {
    console.error("❌ CLI 执行出错:", error);
    process.exit(1);
});
