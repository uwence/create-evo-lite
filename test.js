'use strict';

// Behaviour tests for docs/specs/3.1-minimal-cli.md. Each block names the
// criterion it supplies evidence for. Design budget: 200 lines. If it needs
// more, re-examine the scope rather than compressing the code.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, 'bin', 'cli.js');
let passed = 0;
const failures = [];

function test(name, body) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo3-'));
    try { body(dir); console.log(`ok   ${name}`); passed += 1; }
    catch (error) { console.log(`FAIL ${name}\n     ${error.message}`); failures.push(name); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function run(dir, ...args) {
    const result = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' });
    return { code: result.status, out: result.stdout, err: result.stderr };
}

const hashTree = dir => fs.readdirSync(dir, { recursive: true })
    .filter(f => fs.statSync(path.join(dir, f)).isFile()).sort()
    .map(f => f + ':' + crypto.createHash('sha256')
        .update(fs.readFileSync(path.join(dir, f))).digest('hex')).join('\n');

const write = (dir, rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
};

// --- init 在空目录生成五个文件 -------------------------------------------
test('init creates exactly the five seeded files', dir => {
    assert.strictEqual(run(dir, 'init').code, 0);
    for (const f of ['PROJECT.md', 'docs/devlog.md', 'docs/specs/TEMPLATE.md',
        'AGENTS.md', 'CLAUDE.md']) {
        assert.ok(fs.existsSync(path.join(dir, f)), `missing ${f}`);
    }
});

// --- init 对已存在文件 byte-for-byte 不变，并打印 created / skipped -------
test('init never modifies an existing file and reports each one', dir => {
    write(dir, 'PROJECT.md', 'mine\n');
    write(dir, 'AGENTS.md', 'also mine\n');
    const before = hashTree(dir);
    const { code, out } = run(dir, 'init');
    assert.strictEqual(code, 0);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'PROJECT.md'), 'utf8'), 'mine\n');
    assert.strictEqual(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), 'also mine\n');
    assert.ok(before.split('\n').every(line => hashTree(dir).includes(line)), 'existing bytes changed');
    assert.match(out, /skipped\s+PROJECT\.md/);
    assert.match(out, /created\s+docs\/devlog\.md/);
});

// --- init 不创建也不修改 .gitignore ---------------------------------------
test('init neither creates nor modifies .gitignore', dir => {
    run(dir, 'init');
    assert.ok(!fs.existsSync(path.join(dir, '.gitignore')), '.gitignore was created');

    const second = fs.mkdtempSync(path.join(os.tmpdir(), 'evo3-'));
    try {
        write(second, '.gitignore', 'node_modules/\n');
        run(second, 'init');
        assert.strictEqual(fs.readFileSync(path.join(second, '.gitignore'), 'utf8'), 'node_modules/\n');
    } finally { fs.rmSync(second, { recursive: true, force: true }); }
});

// --- spec <slug> 在目标已存在时拒绝并退出非零 -----------------------------
test('spec refuses to overwrite and exits non-zero', dir => {
    run(dir, 'init');
    assert.strictEqual(run(dir, 'spec', 'alpha').code, 0);
    const kept = fs.readFileSync(path.join(dir, 'docs/specs/alpha.md'), 'utf8');
    const again = run(dir, 'spec', 'alpha');
    assert.notStrictEqual(again.code, 0, 'a second spec call should fail');
    assert.strictEqual(fs.readFileSync(path.join(dir, 'docs/specs/alpha.md'), 'utf8'), kept);
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test('alpha.md'), 'no date prefix');
});

// --- status 的字段与 §2 钉死的数据源一一对应，不多不少 ---------------------
test('status prints exactly the pinned fields', dir => {
    run(dir, 'init');
    const keys = run(dir, 'status').out.trim().split('\n').map(l => l.split(/\s{2,}/)[0]);
    assert.deepStrictEqual(keys,
        ['Initialized', 'Project', 'Branch', 'Dirty', 'Specs', 'Last log', 'Caps']);
});

// --- prose 负控：结构与行数相同、正文全异 -> 输出逐字节相同 ----------------
test('prose negative control: status ignores what the prose says', dir => {
    const shell = body => `# Demo\n\n## Identity (<= 10)\n\n${body[0]}\n\n`
        + `## Now (<= 5)\n\n${body[1]}\n\n## Milestones (<= 20)\n\n`
        + `| # | 里程碑 | 状态 |\n|---|---|---|\n| 1 | ${body[2]} | ${body[3]} |\n`;
    write(dir, 'PROJECT.md', shell(['正在开发 foo', '下一步是 bar', '里程碑一', '进行中']));
    const first = run(dir, 'status').out;
    write(dir, 'PROJECT.md', shell(['宇宙飞船今天吃香蕉', '橘子在星期四睡着了', '月亮修好了', '很蓝']));
    const second = run(dir, 'status').out;
    assert.strictEqual(first, second, 'prose leaked into status output');
    assert.match(first, /Caps\s+OK/);
});

// --- status 在无 PROJECT.md / 无 git 的目录中成功并 exit 0 -----------------
test('status succeeds with no PROJECT.md and no git', dir => {
    const { code, out } = run(dir, 'status');
    assert.strictEqual(code, 0);
    assert.match(out, /Initialized\s+no/);
    assert.match(out, /Caps\s+N\/A/);
    assert.match(out, /Branch\s+—/);
});

// --- caps 行数维度与人工核算一致 ------------------------------------------
test('caps counts lines by the single rule', dir => {
    // 6 prose lines + a 3-row table (header and separator not counted) + a
    // fenced block whose fence lines are not counted: 6 + 1 + 2 = 9.
    write(dir, 'PROJECT.md', '# D\n\n## Identity (<= 4)\n\n'
        + 'a\n\nb\n\nc\n\nd\n\ne\n\nf\n\n'
        + '| h | i |\n|---|---|\n| 1 | 2 |\n\n'
        + '```text\nx\ny\n```\n');
    assert.match(run(dir, 'status').out, /Caps\s+OVER — Identity 9\/4/);
});

// --- caps 长行维度能报出 1835 字符的单行段落 ------------------------------
test('caps catches the 1835-character paragraph a line count misses', dir => {
    const monster = '焦'.repeat(1835);
    write(dir, 'PROJECT.md', `# D\n\n## Now (<= 5)\n\n${monster}\n`);
    const { code, out } = run(dir, 'status');
    assert.strictEqual(code, 0);
    assert.ok(!/Now 1\/5/.test(out), 'a line count alone would call this OK');
    assert.match(out, /Caps\s+OVER — Now 第 \d+ 行 1835 chars/);
});

// --- caps 超限时仍以 exit code 0 退出（展示，不阻断） ----------------------
test('caps over budget still exits 0', dir => {
    write(dir, 'PROJECT.md', '# D\n\n## Now (<= 1)\n\na\n\nb\n\nc\n');
    const { code, out } = run(dir, 'status');
    assert.strictEqual(code, 0, 'caps must display, never gate');
    assert.match(out, /OVER/);
});

// --- render 内置于 CLI；用户项目中不出现 renderer 脚本 --------------------
test('render ships no script into the project', dir => {
    run(dir, 'init');
    assert.strictEqual(run(dir, 'render').code, 0);
    const files = fs.readdirSync(dir, { recursive: true }).map(String);
    assert.ok(!files.some(f => /project-render|renderer/i.test(f)), files.join(' '));
    assert.ok(!fs.existsSync(path.join(dir, 'scripts')), 'scripts/ was created');
});

// --- render 生成 project.html，且源文件前后哈希一致 ------------------------
test('render writes one artifact and no canonical source', dir => {
    run(dir, 'init');
    run(dir, 'render');
    const before = hashTree(dir);
    assert.strictEqual(run(dir, 'render').code, 0, 'a second render must succeed too');
    assert.strictEqual(hashTree(dir), before, 'render wrote back to a source');
    assert.ok(fs.readFileSync(path.join(dir, 'docs/project.html'), 'utf8').includes('<!doctype html>'));
});

// --- 零原生依赖：production 代码只 require Node 内建模块 ------------------
test('production code requires nothing but Node builtins', () => {
    const builtins = new Set(require('module').builtinModules);
    for (const file of [...fs.readdirSync(path.join(__dirname, 'src'))
        .map(f => path.join('src', f)), path.join('bin', 'cli.js')]) {
        for (const [, id] of fs.readFileSync(path.join(__dirname, file), 'utf8')
            .matchAll(/require\('([^']+)'\)/g)) {
            assert.ok(id.startsWith('.') || builtins.has(id), `${file} requires ${id}`);
        }
    }
    assert.ok(!require('./package.json').dependencies, 'package.json declares dependencies');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
