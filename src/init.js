'use strict';

const fs = require('fs');
const path = require('path');

// init creates files that do not exist. It never modifies one that does,
// never touches .gitignore, and offers no --force: overwriting a user's
// canonical source is irreversible (docs/specs/3.1-minimal-cli.md Non-goals).
const SEEDS = [
    ['PROJECT.md', 'PROJECT.md'],
    ['devlog.md', path.join('docs', 'devlog.md')],
    ['spec-template.md', path.join('docs', 'specs', 'TEMPLATE.md')],
    ['AGENTS.md', 'AGENTS.md'],
    ['CLAUDE.md', 'CLAUDE.md'],
];

const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');

function run(root) {
    const results = [];
    for (const [seed, target] of SEEDS) {
        const destination = path.join(root, target);
        // Printed as a relative POSIX-ish path so the report reads the same
        // on every platform.
        const shown = target.split(path.sep).join('/');
        if (fs.existsSync(destination)) {
            results.push({ status: 'skipped', shown });
            continue;
        }
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(TEMPLATE_DIR, seed), destination);
        results.push({ status: 'created', shown });
    }

    for (const result of results) {
        console.log(`${result.status.padEnd(8)}${result.shown}`);
    }

    const skipped = results.filter(r => r.status === 'skipped').length;
    if (skipped) {
        // Silence here would let someone believe a partial install is whole.
        console.log(`\n${skipped} 个文件已存在，保持原样未改动。`);
    }
    console.log('\n提示：docs/project.html 是 render 的产物，建议加入 .gitignore。');
    console.log('（init 不会替你修改 .gitignore，也不会修改任何已存在的文件。）');
    return 0;
}

module.exports = { run, SEEDS };
