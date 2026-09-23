'use strict';

const fs = require('fs');
const path = require('path');

// No date prefix: a date lets one topic grow several files, while a slug is
// naturally a single owner (docs/specs/3.1-minimal-cli.md §1).
function run(root, slug) {
    if (!slug || !/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) {
        console.error('用法：create-evo-lite spec <slug>');
        return 1;
    }
    const destination = path.join(root, 'docs', 'specs', `${slug}.md`);
    if (fs.existsSync(destination)) {
        console.error(`docs/specs/${slug}.md 已存在，未覆盖。`);
        return 1;
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '..', 'templates', 'spec-template.md'), destination);
    console.log(`created docs/specs/${slug}.md`);
    console.log('硬上限 120 行——超了不是告警，是这个 spec 需要拆。');
    return 0;
}

module.exports = { run };
