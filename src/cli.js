'use strict';

const VERSION = require('../package.json').version;

const USAGE = `create-evo-lite ${VERSION} — AI Project Continuity Toolkit

  init            在当前目录创建五个文件；已存在的一律不改
  status          只报机械事实，不解读正文
  spec <slug>     从模板新建 docs/specs/<slug>.md
  render          生成 docs/project.html（单向，不回写源文件）

三个真相源：PROJECT.md（我在哪）、docs/specs/（要做什么）、docs/devlog.md（做过什么、为什么）。
纯 Markdown，零依赖。检索用 rg 就够了。`;

function main(argv, root = process.cwd()) {
    const [command, ...rest] = argv;

    if (!command || command === 'help' || command === '--help' || command === '-h') {
        console.log(USAGE);
        return finish(0);
    }
    if (command === '--version' || command === '-v') {
        console.log(VERSION);
        return finish(0);
    }

    const commands = {
        init: () => require('./init').run(root),
        status: () => require('./status').run(root),
        spec: () => require('./spec').run(root, rest[0]),
        render: () => require('./render').run(root),
    };

    const handler = commands[command];
    if (!handler) {
        console.error(`未知命令：${command}\n`);
        console.error(USAGE);
        return finish(1);
    }
    return finish(handler());
}

// Exit codes are set here rather than thrown from the commands, so that a
// command can report a problem (caps over budget, for instance) without that
// report becoming a gate.
function finish(code) {
    process.exitCode = code;
    return code;
}

module.exports = { main, USAGE, VERSION };
