---
id: plan:architecture-governance-wiki-mvp
title: Architecture-Governance Wiki (4b-1) — MVP Plan
status: draft
linkedSpec: spec:architecture-governance-wiki
---

# Architecture-Governance Wiki (4b-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **AUTHORIZATION GATE:** implementation may start ONLY after this plan passes external re-review. Until then this document is read-only.

**Goal:** `mem wiki build [--open]` — 把 architecture IR + Planning IR + exploreCode 治理数据 + drift/verify 生成纯静态、离线、中文的 HTML wiki(架构图为骨、模块进展为肉)。

**Architecture:** 一个确定性投影层(`projection.js`)把治理数据折成 ModuleProjection/ProjectHealth 事实模型;渲染层只解释该模型;统一页面映射(`page-map.js`)保证 Windows 安全;`build.js` 注入时钟编排全流程并写 manifest。设计契约:`docs/superpowers/specs/2026-07-22-architecture-governance-wiki-design.md`(APPROVED)。

**Tech Stack:** Node.js CommonJS(`'use strict'`),零新依赖,模板字符串生成 HTML/SVG,Node `assert` 测试(governance.js T-wiki 块),Windows-first。

## Global Constraints

- 只改 `templates/cli/**`;经 `node ./.evo-lite/cli/sync-runtime-entry.js` 出镜像;二次 sync `copied: 0`;92+N/92+N byte-identical;绝不手改 `.evo-lite/cli/**`。
- 输出目录 `.evo-lite/generated/wiki/`(替代旧 `code-wiki/` 契约);整目录可删除重建;manifest `version: "evo-architecture-wiki@1"`。
- 确定性:`buildWiki({ projectRoot, now })` 注入时钟;相同输入快照 + 相同 headSha + 相同时钟 → 两次生成 byte-identical。
- 不伪造:`edges` 缺失/空 = 无已知依赖,不画箭头,不从目录/文件名/role 猜测;仅 schema-valid 的 `ArchitectureModuleEdge` 参与绘制;focus 只投影 `exploreCode().focus`,unresolved → "当前焦点无法可靠定位"。
- freshness 三态 `fresh|stale|unknown`;仅有 `generatedAt` 的 IR **必须 unknown**;禁止用 generatedAt/mtime/build 成功/drift 无警告推断 fresh。
- 页面路径经统一映射 `<kind>/<readable>--<hash8>.html`;大小写折叠冲突检测;hash 冲突确定性扩展全 hash,绝不覆盖。
- 源码页:path-containment(拒绝 `..`/绝对路径/符号链接越界)、全量 HTML escape、二进制不渲染、>512 KiB 出说明页、跳过文件保留条目并示原因;build 全程不访问网络。
- 中文正文;词典未覆盖术语不得裸出现在生成器自写叙事(检查范围限 §4);原始 `Rxxx` 只出现在"技术详情"区。
- 退出码:成功(含浏览器打开失败)= 0;生成失败 = 1;参数/wiki-groups.json 非法 = 2;`--open` 用 execFile 参数数组,无 `shell:true`。
- Inspector(cw-inspector/cw-closure)保持 parked;Agent 补写层不做;无 chat。
- 提交前跑 GitNexus `detect_changes` 核对改动范围(仓库 CLAUDE.md 约定)。

## Grounded Reality(2026-07-23 实测的 producer 形状 — 所有代码以此为准,不得想象字段)

```text
architecture-ir.json  top: version, generatedAt, project, provider, modules, files, warnings, edges(=[]), (无 flows 时缺省)
  modules[]: { id:"module:planning", name, description(英文), paths[], fileCount, role, confidence }   // 11 个;role 实测含 feature
  files[]:   { path, module, role, confidence }                                                        // 143 个;module 字段齐全 → 权威归属
plan-ir.json          tasks[]: { id, title, status, phase, sourcePath, linkedSpec, linkedPlan,
                                 planR008Exempt, linkedFiles[], verify, evidence, readOnly, confidence }
                      // linkedFiles 覆盖 204/205;status 实测仅 implemented|todo(未知状态按合同单列)
drift-report.json     { version, generatedAt, project, findings[], summary:{total,warnings,info,errors} }
  findings[]: { id, rule, scope, level, type, message, evidence[](路径字符串), suggestedAction }        // 无 filePath/dependsOn 字段 → 归属走 evidence[]
exploreCode('') 结果   focus:{ entityId, taskId, resolved };governance:{ specs, plans, tasks, commits, evidence, links, linkSummary }
                      // links 只有 codeReferenceId(公共结果无 codeReferences 集合)→ task→file 归属用 plan-ir tasks[].linkedFiles(同源 declares_file producer)
dashboard-data.js     buildDashboardData(projectRoot).verify = { planScan:{exists,taskCount,implemented}, architectureScan:{exists,moduleCount}, drift:{total,warnings,info,errors}, generatedDataFresh }
```

## File Structure

```text
templates/cli/wiki/page-map.js      统一页面路径映射(module/source 共用;冲突规则)
templates/cli/wiki/groups.js        wiki-groups.json 加载与校验(evo-wiki-groups@1)
templates/cli/wiki/projection.js    ModuleProjection + ProjectHealth 确定性事实模型
templates/cli/wiki/dictionary.js    中文术语词典 + 叙事模板 + 裸术语检查
templates/cli/wiki/render.js        SVG 模块地图 + index/module 页渲染(纯函数,输入→html 字符串)
templates/cli/wiki/source-pages.js  源码页生成(containment/escape/binary/512KiB)
templates/cli/wiki/build.js         buildWiki({projectRoot, now}) 编排 + manifest + git 数据采集
templates/cli/wiki/cli.js           registerWikiCommands(program):mem wiki build [--open],退出码契约
templates/cli/memory.js             +1 行 safeRegister('wiki', ...)
templates/cli/template-manifest.js  +8 个 wiki/* 条目
templates/cli/test/governance.js    T-wiki 测试块(13 项合同,随任务递增)
```

测试统一模式:每个任务把自己的 T-wiki 子块追加进 `templates/cli/test/governance.js` 的 `runChildRuntimeTests()` 内(紧跟 T-ce 块之后的位置,沿用 4a 模式:合成 IR 写入临时 workspace,不触碰真实 mirror/生成物)。运行命令一律:

```bash
node templates/cli/test.js governance
```

---

### Task 1: [W1] wiki/page-map.js — 统一页面路径映射

**Files:**
- Create: `templates/cli/wiki/page-map.js`
- Test: `templates/cli/test/governance.js`(追加 T-wiki-pagemap)

**Interfaces:**
- Produces: `createPageMap() -> { modulePage(moduleId:string):string, sourcePage(repoRelPath:string):string, modulePages():Record<string,string> }`;`readableSegment(raw)`;`normalizeRepoPath(p)`;`fullHash(raw)`。后续任务(render/build/source-pages)只经此模块生成页面链接,禁止手拼。

- [ ] **Step 1: 写失败测试**(追加到 governance.js `runChildRuntimeTests()` 内、T-ce 系列块之后)

```js
console.log('T-wiki-pagemap. Unified Windows-safe page mapping with collision rules ...');
{
    const pmPath = require.resolve(path.join(TEMPLATE_CLI_DIR, 'wiki', 'page-map'));
    delete require.cache[pmPath];
    const { createPageMap, readableSegment } = require(pmPath);

    // module:cli-entry → Windows 合法文件名(无冒号),形如 module/module-cli-entry--<hash8>.html
    const pm = createPageMap();
    const page = pm.modulePage('module:cli-entry');
    assert.match(page, /^module\/module-cli-entry--[0-9a-f]{8}\.html$/, 'module page must be Windows-safe');
    assert.ok(!page.includes(':'), 'no colon in page path');
    assert.strictEqual(pm.modulePage('module:cli-entry'), page, 'mapping must be stable per id');

    // 大小写折叠冲突:可读段相同 + 构造 hash8 相同 → 确定性扩展全 hash,不覆盖
    const clash = createPageMap();
    const a = clash.sourcePage('src/A.js');
    const b = clash.sourcePage('src/a.js'); // 可读段大小写折叠后同名,hash 不同 → 各自成页
    assert.notStrictEqual(a.toLowerCase(), b.toLowerCase(), 'case-folded names must not collide');

    // 同 id 重复申请不产生第二个页面
    assert.strictEqual(Object.keys(clash.modulePages()).length, 0, 'source assignments must not appear in modulePages');
    assert.match(readableSegment('module:planning'), /^module-planning$/);
    console.log('✅ T-wiki-pagemap passed');
}
```

- [ ] **Step 2: 跑测试确认失败**

```bash
node templates/cli/test.js governance
```
预期:`Cannot find module ... wiki/page-map`。

- [ ] **Step 3: 最小实现**

```js
'use strict';

// Unified page-path mapping for module/ and source/ pages (design §2.0).
// Windows-safe: the readable segment is whitelist-folded; uniqueness comes
// from a sha1 suffix. Collisions are detected on the CASE-FOLDED filename
// space and resolved by deterministically extending hash8 to the FULL hash —
// an existing assignment is never overwritten.

const crypto = require('node:crypto');

function normalizeRepoPath(p) {
    return String(p).replace(/\\/g, '/').replace(/^\.\//, '');
}

function readableSegment(raw) {
    const seg = String(raw).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return seg || 'x';
}

function fullHash(raw) {
    return crypto.createHash('sha1').update(String(raw), 'utf8').digest('hex');
}

function createPageMap() {
    const byKey = new Map();   // "<kind>\0<rawId>" -> page path
    const taken = new Map();   // case-folded page path -> owning key

    function assign(kind, rawId) {
        const key = `${kind} ${rawId}`;
        if (byKey.has(key)) return byKey.get(key);
        const hash = fullHash(rawId);
        let page = `${kind}/${readableSegment(rawId)}--${hash.slice(0, 8)}.html`;
        const owner = taken.get(page.toLowerCase());
        if (owner && owner !== key) {
            page = `${kind}/${readableSegment(rawId)}--${hash}.html`; // deterministic full-hash extension
            const owner2 = taken.get(page.toLowerCase());
            if (owner2 && owner2 !== key) throw new Error(`page-map: unresolvable collision for ${rawId}`);
        }
        taken.set(page.toLowerCase(), key);
        byKey.set(key, page);
        return page;
    }

    return {
        modulePage: id => assign('module', String(id)),
        sourcePage: p => assign('source', normalizeRepoPath(p)),
        modulePages: () => {
            const out = {};
            for (const [key, page] of byKey) {
                const idx = key.indexOf(' ');
                if (key.slice(0, idx) === 'module') out[key.slice(idx + 1)] = page;
            }
            return out;
        },
    };
}

module.exports = { createPageMap, readableSegment, normalizeRepoPath, fullHash };
```

- [ ] **Step 4: 跑测试确认通过**

```bash
node templates/cli/test.js governance
```
预期:`✅ T-wiki-pagemap passed`,套件 EXIT 0。

- [ ] **Step 5: 同步镜像 + 提交**

```bash
node ./.evo-lite/cli/sync-runtime-entry.js   # 第二次运行必须 copied: 0
git add templates/cli/wiki/page-map.js templates/cli/test/governance.js .evo-lite/cli/wiki/page-map.js .evo-lite/cli/test/governance.js
git commit -m "feat(wiki): unified Windows-safe page mapping with deterministic collision extension (4b-1 W1)"
```

---

### Task 2: [W2] wiki/groups.js — evo-wiki-groups@1 校验

**Files:**
- Create: `templates/cli/wiki/groups.js`
- Test: `templates/cli/test/governance.js`(追加 T-wiki-groups)

**Interfaces:**
- Consumes: 无(独立)。
- Produces: `loadWikiGroups(projectRoot, knownModuleIds:string[]) -> { ok:true, config:null | { laneLabels:Record<string,string>, moduleAliases:Record<string,string>, groups:[{id,name,order,moduleIds}] } } | { ok:false, errors:string[] }`。`config:null` 表示无配置文件(默认 role 泳道);`ok:false` 由 CLI 映射为 exit 2。`GROUPS_VERSION = 'evo-wiki-groups@1'`。

- [ ] **Step 1: 写失败测试**

```js
console.log('T-wiki-groups. wiki-groups.json validation: exit-2 matrix + defaults ...');
{
    const gPath = require.resolve(path.join(TEMPLATE_CLI_DIR, 'wiki', 'groups'));
    delete require.cache[gPath];
    const { loadWikiGroups } = require(gPath);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-wiki-groups-'));
    fs.mkdirSync(path.join(tmp, '.evo-lite'), { recursive: true });
    const KNOWN = ['module:a', 'module:b'];
    const write = obj => fs.writeFileSync(path.join(tmp, '.evo-lite', 'wiki-groups.json'), JSON.stringify(obj));

    try {
        // 无配置文件 → ok + null(role 默认分组可用)
        const absent = loadWikiGroups(fs.mkdtempSync(path.join(os.tmpdir(), 'evo-wiki-none-')), KNOWN);
        assert.deepStrictEqual(absent, { ok: true, config: null });

        // 合法配置 → groups 按 order 再按 id 排序
        write({ version: 'evo-wiki-groups@1', groups: [
            { id: 'group:z', name: 'Z', order: 20, moduleIds: ['module:b'] },
            { id: 'group:a', name: 'A', order: 10, moduleIds: ['module:a'] } ] });
        const okRes = loadWikiGroups(tmp, KNOWN);
        assert.strictEqual(okRes.ok, true);
        assert.deepStrictEqual(okRes.config.groups.map(g => g.id), ['group:a', 'group:z']);

        // 重复 module id → 无效
        write({ version: 'evo-wiki-groups@1', groups: [
            { id: 'group:1', name: '1', order: 1, moduleIds: ['module:a'] },
            { id: 'group:2', name: '2', order: 2, moduleIds: ['module:a'] } ] });
        assert.strictEqual(loadWikiGroups(tmp, KNOWN).ok, false, 'duplicate module id must fail');

        // 未知 module id → 无效且报告具体 id
        write({ version: 'evo-wiki-groups@1', groups: [ { id: 'group:1', name: '1', order: 1, moduleIds: ['module:ghost'] } ] });
        const unk = loadWikiGroups(tmp, KNOWN);
        assert.strictEqual(unk.ok, false);
        assert.ok(unk.errors.some(e => e.includes('module:ghost')), 'error must name the unknown id');

        // 未知 version → 无效;类型错误 → 无效
        write({ version: 'evo-wiki-groups@2', groups: [] });
        assert.strictEqual(loadWikiGroups(tmp, KNOWN).ok, false, 'unknown version must fail');
        write({ version: 'evo-wiki-groups@1', groups: [{ id: 'group:1', name: '1', order: 'ten', moduleIds: [] }] });
        assert.strictEqual(loadWikiGroups(tmp, KNOWN).ok, false, 'type error must fail');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    console.log('✅ T-wiki-groups passed');
}
```

- [ ] **Step 2: 跑测试确认失败**(`Cannot find module ... wiki/groups`)

- [ ] **Step 3: 最小实现**

```js
'use strict';

// wiki-groups.json (evo-wiki-groups@1) — display-only grouping (design §2.2).
// Validation failure returns { ok:false, errors } which the CLI maps to exit 2.
// Aliases and lane labels affect DISPLAY only; module identity never changes.

const fs = require('node:fs');
const path = require('node:path');

const GROUPS_VERSION = 'evo-wiki-groups@1';

function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function loadWikiGroups(projectRoot, knownModuleIds) {
    const file = path.join(projectRoot, '.evo-lite', 'wiki-groups.json');
    if (!fs.existsSync(file)) return { ok: true, config: null };

    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { return { ok: false, errors: [`wiki-groups.json is not valid JSON: ${e.message}`] }; }

    const errors = [];
    if (!isPlainObject(raw)) return { ok: false, errors: ['wiki-groups.json must be an object'] };
    if (raw.version !== GROUPS_VERSION) errors.push(`unknown version: ${raw.version} (expected ${GROUPS_VERSION})`);
    const laneLabels = raw.laneLabels === undefined ? {} : raw.laneLabels;
    const moduleAliases = raw.moduleAliases === undefined ? {} : raw.moduleAliases;
    if (!isPlainObject(laneLabels)) errors.push('laneLabels must be an object');
    if (!isPlainObject(moduleAliases)) errors.push('moduleAliases must be an object');
    const groups = raw.groups === undefined ? [] : raw.groups;
    if (!Array.isArray(groups)) errors.push('groups must be an array');

    const known = new Set(knownModuleIds || []);
    const seen = new Map();
    if (Array.isArray(groups)) {
        for (const g of groups) {
            if (!isPlainObject(g) || typeof g.id !== 'string' || typeof g.name !== 'string'
                || typeof g.order !== 'number' || !Array.isArray(g.moduleIds)
                || g.moduleIds.some(id => typeof id !== 'string')) {
                errors.push(`group entry malformed: ${JSON.stringify(g).slice(0, 80)}`);
                continue;
            }
            for (const id of g.moduleIds) {
                if (!known.has(id)) errors.push(`unknown module id in ${g.id}: ${id}`);
                if (seen.has(id) && seen.get(id) !== g.id) errors.push(`duplicate module id across groups: ${id}`);
                seen.set(id, g.id);
            }
        }
    }
    if (isPlainObject(moduleAliases)) {
        for (const id of Object.keys(moduleAliases)) {
            if (!known.has(id)) errors.push(`moduleAliases references unknown module id: ${id}`);
        }
    }

    if (errors.length) return { ok: false, errors };
    const sorted = [...groups].sort((a, b) => (a.order - b.order) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { ok: true, config: { laneLabels, moduleAliases, groups: sorted } };
}

module.exports = { loadWikiGroups, GROUPS_VERSION };
```

- [ ] **Step 4: 跑测试确认通过**(`✅ T-wiki-groups passed`,EXIT 0)

- [ ] **Step 5: 同步镜像 + 提交**

```bash
node ./.evo-lite/cli/sync-runtime-entry.js
git add templates/cli/wiki/groups.js templates/cli/test/governance.js .evo-lite/cli/wiki/groups.js .evo-lite/cli/test/governance.js
git commit -m "feat(wiki): evo-wiki-groups@1 display-grouping validation with exit-2 matrix (4b-1 W2)"
```

---

### Task 3: [W3] wiki/projection.js — 确定性事实模型

**Files:**
- Create: `templates/cli/wiki/projection.js`
- Test: `templates/cli/test/governance.js`(追加 T-wiki-projection)

**Interfaces:**
- Consumes: 无代码依赖;输入形状见 Grounded Reality。
- Produces:
  ```
  buildProjection({ architectureIR, planIR, exploreResult, driftReport, verifySummary, recentCommits })
    -> { modules: ModuleProjection[], project: ProjectHealth,
         totals: { taskDone, taskOpen, taskUnknown }, warnings: string[] }
  ModuleProjection = { moduleId, name, description, role, confidence, files[],
                       tasks:[{id,title,status,completion,shared}],
                       taskCounts:{done,open,unknown,shared},
                       progressState:'unplanned'|'in-progress'|'done',
                       healthState:'normal'|'attention'|'risk', healthReasons:string[],
                       focus:boolean, recentCommits:[{sha,subject,files[]}] }
  ProjectHealth = { driftErrors, driftWarnings, unattributedFindings:[{id,rule,level}],
                    verify, inputFreshness:{architecture:{state,reason},planning:{state,reason}},
                    focusResolved:boolean }
  taskCompletion(status) -> 'done'|'open'|'unknown'
  ```
  `recentCommits` 入参形状 `[{sha, subject, files:string[]}]`(由 W7 build.js 从 `git log` 采集,窗口 10 个 commit)。

- [ ] **Step 1: 写失败测试**

```js
console.log('T-wiki-projection. Deterministic ModuleProjection + ProjectHealth semantics ...');
{
    const prPath = require.resolve(path.join(TEMPLATE_CLI_DIR, 'wiki', 'projection'));
    delete require.cache[prPath];
    const { buildProjection, taskCompletion } = require(prPath);

    const architectureIR = {
        modules: [
            { id: 'module:a', name: 'A', description: 'mod a', paths: ['src/a/'], fileCount: 2, role: 'service', confidence: 1 },
            { id: 'module:b', name: 'B', description: 'mod b', paths: ['src/b/'], fileCount: 1, role: 'feature', confidence: 1 },
            { id: 'module:empty', name: 'Empty', description: '', paths: ['src/e/'], fileCount: 1, role: 'mystery-role', confidence: 1 },
        ],
        files: [
            { path: 'src/a/one.js', module: 'module:a', role: 'service', confidence: 1 },
            { path: 'src/a/two.js', module: 'module:a', role: 'service', confidence: 1 },
            { path: 'src/b/one.js', module: 'module:b', role: 'feature', confidence: 1 },
            { path: 'src/e/one.js', module: 'module:empty', role: 'mystery-role', confidence: 1 },
        ],
        edges: [],
    };
    const planIR = { tasks: [
        { id: 'task:t1', title: 'T1', status: 'implemented', linkedFiles: ['src/a/one.js'] },
        { id: 'task:t2', title: 'T2', status: 'todo', linkedFiles: ['src/a/two.js', 'src/b/one.js'] },  // 跨模块共享
        { id: 'task:t3', title: 'T3', status: 'someday-maybe', linkedFiles: ['src/a/one.js'] },          // 未知状态
    ] };
    const driftReport = { findings: [
        { id: 'R008:task:t2', rule: 'R008', level: 'warning', evidence: ['src/a/two.js'] },
        { id: 'GLOBAL:verify', rule: 'V001', level: 'error', evidence: ['no/such/file.js'] },            // 不可归属 error
        { id: 'INFO:x', rule: 'R009', level: 'info', evidence: ['src/b/one.js'] },                        // info 不参与健康
    ], summary: { total: 3, warnings: 1, info: 1, errors: 1 } };

    const res = buildProjection({
        architectureIR, planIR, driftReport,
        exploreResult: { focus: { entityId: 'plan:x', taskId: 'task:t2', resolved: true } },
        verifySummary: { drift: { errors: 1 } }, recentCommits: [],
    });
    const byId = new Map(res.modules.map(m => [m.moduleId, m]));

    // 归属:files[].module 权威;t2 共享于 a、b 两模块并标 shared
    assert.deepStrictEqual(byId.get('module:a').taskCounts, { done: 1, open: 1, unknown: 1, shared: 1 });
    assert.deepStrictEqual(byId.get('module:b').taskCounts, { done: 0, open: 1, unknown: 0, shared: 1 });
    // 未知状态:不计完成,单列 unknown,并产生 warning
    assert.strictEqual(taskCompletion('someday-maybe'), 'unknown');
    assert.ok(res.warnings.some(w => w.includes('task:t3')), 'unknown status must be warned');
    // 无 task 模块 → unplanned(尚未纳入规划)
    assert.strictEqual(byId.get('module:empty').progressState, 'unplanned');
    // 首页总进度按 task id 去重:3 个 task,done=1 open=1 unknown=1(t2 不重复计)
    assert.deepStrictEqual(res.totals, { taskDone: 1, taskOpen: 1, taskUnknown: 1 });
    // 健康隔离:不可归属 error 只进 ProjectHealth,不把任何模块标 risk
    assert.ok(res.project.unattributedFindings.some(f => f.id === 'GLOBAL:verify'));
    assert.ok(res.modules.every(m => m.healthState !== 'risk'), 'unattributable error must not spread to modules');
    // module:a 有 1 条可归属 warning → attention;info 不影响 module:b
    assert.strictEqual(byId.get('module:a').healthState, 'attention');
    assert.strictEqual(byId.get('module:b').healthState, 'normal');
    // focus:canonical taskId 命中的模块标记 focus
    assert.strictEqual(byId.get('module:a').focus, true);
    assert.strictEqual(byId.get('module:b').focus, true);
    // freshness:仅 generatedAt 的 IR → unknown
    assert.strictEqual(res.project.inputFreshness.architecture.state, 'unknown');
    assert.strictEqual(res.project.inputFreshness.planning.state, 'unknown');

    // focus unresolved → 不标记任何模块
    const res2 = buildProjection({ architectureIR, planIR, driftReport,
        exploreResult: { focus: { entityId: null, taskId: null, resolved: false } },
        verifySummary: null, recentCommits: [] });
    assert.ok(res2.modules.every(m => m.focus === false), 'unresolved focus must mark nothing');
    assert.strictEqual(res2.project.focusResolved, false);
    console.log('✅ T-wiki-projection passed');
}
```

- [ ] **Step 2: 跑测试确认失败**(`Cannot find module ... wiki/projection`)

- [ ] **Step 3: 最小实现**

```js
'use strict';

// Deterministic fact model (design §3). The narrative/render layer may ONLY
// explain what this module computed — it never computes facts of its own.
// Attribution authority: architectureIR.files[].module; module.paths is a
// fallback for IR files lacking a module field (confidence downgraded).
// Task->module attribution source: planIR.tasks[].linkedFiles (the same
// declares_file producer the 4a linker consumes).

const DONE_STATUSES = new Set(['implemented', 'verified', 'done']);
const OPEN_STATUSES = new Set(['todo', 'active']);

function normalizePath(p) { return String(p).replace(/\\/g, '/').replace(/^\.\//, ''); }

function taskCompletion(status) {
    if (DONE_STATUSES.has(status)) return 'done';
    if (OPEN_STATUSES.has(status)) return 'open';
    return 'unknown';
}

function buildFileIndex(architectureIR, warnings) {
    const index = new Map();
    const files = (architectureIR && architectureIR.files) || [];
    for (const f of files) {
        if (f && f.path && f.module) index.set(normalizePath(f.path), { module: f.module, confidence: f.confidence ?? 1 });
    }
    for (const f of files) {
        if (!f || !f.path || f.module) continue;
        const p = normalizePath(f.path);
        const m = ((architectureIR && architectureIR.modules) || [])
            .find(mod => (mod.paths || []).some(x => p === normalizePath(x) || p.startsWith(normalizePath(x))));
        if (m) {
            index.set(p, { module: m.id, confidence: 0.5 });
            warnings.push(`file ${p} attributed via paths fallback (confidence downgraded)`);
        }
    }
    return index;
}

function buildProjection({ architectureIR, planIR, exploreResult, driftReport, verifySummary, recentCommits }) {
    const warnings = [];
    const fileIndex = buildFileIndex(architectureIR || {}, warnings);

    const modules = new Map();
    for (const m of ((architectureIR && architectureIR.modules) || [])) {
        modules.set(m.id, {
            moduleId: m.id, name: m.name || m.id, description: m.description || '',
            role: m.role || 'unknown', confidence: m.confidence ?? 1,
            files: [], tasks: [], taskCounts: { done: 0, open: 0, unknown: 0, shared: 0 },
            progressState: 'unplanned', healthState: 'normal', healthReasons: [],
            focus: false, recentCommits: [],
        });
    }
    for (const [p, att] of fileIndex) { const m = modules.get(att.module); if (m) m.files.push(p); }
    for (const m of modules.values()) m.files.sort();

    // ---- task attribution (declares_file source: tasks[].linkedFiles) ----
    const taskModuleHits = new Map();
    for (const t of ((planIR && planIR.tasks) || [])) {
        const hit = new Set();
        for (const f of (t.linkedFiles || [])) {
            const att = fileIndex.get(normalizePath(f));
            if (att) hit.add(att.module);
        }
        if (hit.size) taskModuleHits.set(t.id, hit);
    }
    for (const t of ((planIR && planIR.tasks) || [])) {
        const hit = taskModuleHits.get(t.id);
        if (!hit) continue;
        const completion = taskCompletion(t.status);
        if (completion === 'unknown') warnings.push(`task ${t.id} has unrecognized status "${t.status}" — counted as 状态未知`);
        const shared = hit.size > 1;
        for (const moduleId of hit) {
            const m = modules.get(moduleId);
            if (!m) continue;
            m.tasks.push({ id: t.id, title: t.title || t.id, status: t.status, completion, shared });
            m.taskCounts[completion] += 1;
            if (shared) m.taskCounts.shared += 1;
        }
    }
    for (const m of modules.values()) {
        const total = m.taskCounts.done + m.taskCounts.open + m.taskCounts.unknown;
        m.progressState = total === 0 ? 'unplanned'
            : (m.taskCounts.open + m.taskCounts.unknown) === 0 ? 'done' : 'in-progress';
        m.tasks.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }

    // ---- health: attributable findings only; dedup by finding id; info excluded ----
    const unattributed = [];
    const findingsByModule = new Map();
    for (const f of (((driftReport || {}).findings) || [])) {
        if (!f || f.level === 'info') continue;
        const hits = new Set();
        for (const ev of (f.evidence || [])) {
            const att = fileIndex.get(normalizePath(ev));
            if (att) hits.add(att.module);
        }
        if (!hits.size) { unattributed.push(f); continue; }
        for (const moduleId of hits) {
            if (!findingsByModule.has(moduleId)) findingsByModule.set(moduleId, new Map());
            findingsByModule.get(moduleId).set(f.id, f);
        }
    }
    for (const m of modules.values()) {
        const list = findingsByModule.has(m.moduleId) ? [...findingsByModule.get(m.moduleId).values()] : [];
        const errors = list.filter(f => f.level === 'error');
        const warns = list.filter(f => f.level === 'warning');
        if (errors.length) { m.healthState = 'risk'; m.healthReasons = errors.map(f => f.rule); }
        else if (warns.length >= 3) { m.healthState = 'risk'; m.healthReasons = warns.map(f => f.rule); }
        else if (warns.length >= 1) { m.healthState = 'attention'; m.healthReasons = warns.map(f => f.rule); }
    }

    // ---- focus: 4a canonical only ----
    const focus = (exploreResult && exploreResult.focus) || { resolved: false };
    if (focus.resolved && focus.taskId && taskModuleHits.has(focus.taskId)) {
        for (const id of taskModuleHits.get(focus.taskId)) {
            const m = modules.get(id);
            if (m) m.focus = true;
        }
    }

    // ---- recent commits per module ----
    for (const c of (recentCommits || [])) {
        const touched = new Set();
        for (const f of (c.files || [])) {
            const att = fileIndex.get(normalizePath(f));
            if (att) touched.add(att.module);
        }
        for (const id of touched) {
            const m = modules.get(id);
            if (m && m.recentCommits.length < 10) m.recentCommits.push({ sha: c.sha, subject: c.subject, files: c.files });
        }
    }

    // ---- homepage totals: dedup by task id ----
    let taskDone = 0, taskOpen = 0, taskUnknown = 0;
    for (const t of ((planIR && planIR.tasks) || [])) {
        const c = taskCompletion(t.status);
        if (c === 'done') taskDone += 1; else if (c === 'open') taskOpen += 1; else taskUnknown += 1;
    }

    const summary = ((driftReport || {}).summary) || {};
    const project = {
        driftErrors: summary.errors ?? 0,
        driftWarnings: summary.warnings ?? 0,
        unattributedFindings: unattributed.map(f => ({ id: f.id, rule: f.rule, level: f.level })),
        verify: verifySummary || null,
        inputFreshness: {
            architecture: { state: 'unknown', reason: 'IR has no comparable source snapshot' },
            planning: { state: 'unknown', reason: 'IR has no comparable source snapshot' },
        },
        focusResolved: !!focus.resolved,
    };

    return {
        modules: [...modules.values()].sort((a, b) => (a.moduleId < b.moduleId ? -1 : 1)),
        project,
        totals: { taskDone, taskOpen, taskUnknown },
        warnings,
    };
}

module.exports = { buildProjection, taskCompletion, DONE_STATUSES, OPEN_STATUSES };
```

- [ ] **Step 4: 跑测试确认通过**(`✅ T-wiki-projection passed`,EXIT 0)

- [ ] **Step 5: 同步镜像 + 提交**

```bash
node ./.evo-lite/cli/sync-runtime-entry.js
git add templates/cli/wiki/projection.js templates/cli/test/governance.js .evo-lite/cli/wiki/projection.js .evo-lite/cli/test/governance.js
git commit -m "feat(wiki): deterministic ModuleProjection + ProjectHealth fact model (4b-1 W3)"
```

---

### Task 4: [W4] wiki/dictionary.js — 中文词典与叙事模板

**Files:**
- Create: `templates/cli/wiki/dictionary.js`
- Test: `templates/cli/test/governance.js`(追加 T-wiki-dictionary)

**Interfaces:**
- Consumes: W3 的 `ModuleProjection` 形状(只读字段,不重算)。
- Produces:
  ```
  translateRule(rule:string) -> string            // 已知规则 → 中文;未知 → '发现一项尚未分类的治理检查'
  RULE_LABELS: Record<string,string>
  healthLabel(state) -> '正常'|'需要注意'|'存在风险'
  progressLabel(mp) -> string                     // 如 '3 项任务,2 项已完成' / '尚未纳入规划'
  moduleNarrative(mp) -> string                   // 模块页主叙事段(纯中文,不含裸 Rxxx)
  listBareTerms(text) -> string[]                 // 返回叙事中裸出现的 Rxxx(供测试断言为空)
  ```

- [ ] **Step 1: 写失败测试**

```js
console.log('T-wiki-dictionary. Chinese dictionary coverage: no bare Rxxx in generated narrative ...');
{
    const dPath = require.resolve(path.join(TEMPLATE_CLI_DIR, 'wiki', 'dictionary'));
    delete require.cache[dPath];
    const { translateRule, healthLabel, progressLabel, moduleNarrative, listBareTerms } = require(dPath);

    assert.strictEqual(translateRule('R008'), '任务缺少完成证据');
    assert.strictEqual(translateRule('R999'), '发现一项尚未分类的治理检查');
    assert.strictEqual(healthLabel('risk'), '存在风险');

    const mp = { moduleId: 'module:a', name: 'A', description: 'service layer', role: 'service',
        files: ['src/a/one.js'], tasks: [], taskCounts: { done: 2, open: 1, unknown: 0, shared: 0 },
        progressState: 'in-progress', healthState: 'attention', healthReasons: ['R008', 'R999'],
        focus: true, recentCommits: [] };
    const text = moduleNarrative(mp);
    assert.ok(text.includes('当前焦点'), 'focus module narrative must mention 当前焦点');
    assert.deepStrictEqual(listBareTerms(text), [], 'no bare Rxxx in generated narrative');
    assert.ok(progressLabel(mp).includes('2'), 'progress label carries done count');
    assert.strictEqual(progressLabel({ ...mp, taskCounts: { done: 0, open: 0, unknown: 0, shared: 0 }, progressState: 'unplanned' }), '尚未纳入规划');
    console.log('✅ T-wiki-dictionary passed');
}
```

- [ ] **Step 2: 跑测试确认失败**(`Cannot find module ... wiki/dictionary`)

- [ ] **Step 3: 最小实现**

```js
'use strict';

// Chinese terminology dictionary + deterministic narrative templates
// (design §4). The narrative ONLY verbalizes ModuleProjection fields.
// Raw rule ids (Rxxx) may appear only in the collapsible tech-details area,
// never in the main narrative — listBareTerms() is the test hook for that.

const RULE_LABELS = {
    R003: '计划文档结构不完整',
    R006: '有代码变更未关联到任何任务',
    R008: '任务缺少完成证据',
    R009: '架构记录落后于代码',
    R011: '规格状态落后于计划完成度',
    R012: '当前焦点指向未真正开始的计划',
    R013: '验证契约存在缺口',
};

const HEALTH_LABELS = { normal: '正常', attention: '需要注意', risk: '存在风险' };
const ROLE_LABELS = {
    entry: '入口', service: '核心服务', feature: '功能', ui: '界面', runtime: '运行时',
    scanner: '扫描与分析', governance: '治理', docs: '文档', test: '测试', unknown: '其他',
};

function translateRule(rule) {
    return RULE_LABELS[rule] || '发现一项尚未分类的治理检查';
}

function healthLabel(state) { return HEALTH_LABELS[state] || HEALTH_LABELS.normal; }

function roleLabel(role) { return ROLE_LABELS[role] || `其他(${role})`; }

function progressLabel(mp) {
    if (mp.progressState === 'unplanned') return '尚未纳入规划';
    const total = mp.taskCounts.done + mp.taskCounts.open + mp.taskCounts.unknown;
    let text = `${total} 项任务,${mp.taskCounts.done} 项已完成`;
    if (mp.taskCounts.unknown) text += `,${mp.taskCounts.unknown} 项状态未知`;
    if (mp.taskCounts.shared) text += `(含 ${mp.taskCounts.shared} 项与其他模块共享)`;
    return text;
}

function moduleNarrative(mp) {
    const parts = [];
    parts.push(`「${mp.name}」属于${roleLabel(mp.role)}分区,包含 ${mp.files.length} 个文件。`);
    parts.push(`进度:${progressLabel(mp)}。`);
    if (mp.healthState === 'normal') parts.push('治理健康:正常。');
    else {
        const reasons = [...new Set(mp.healthReasons.map(translateRule))].join('、');
        parts.push(`治理健康:${healthLabel(mp.healthState)} —— ${reasons}。`);
    }
    if (mp.focus) parts.push('这里是当前焦点所在的模块。');
    return parts.join(' ');
}

function listBareTerms(text) {
    return (String(text).match(/R\d{3}/g) || []);
}

module.exports = { RULE_LABELS, translateRule, healthLabel, roleLabel, progressLabel, moduleNarrative, listBareTerms };
```

- [ ] **Step 4: 跑测试确认通过**(`✅ T-wiki-dictionary passed`,EXIT 0)

- [ ] **Step 5: 同步镜像 + 提交**

```bash
node ./.evo-lite/cli/sync-runtime-entry.js
git add templates/cli/wiki/dictionary.js templates/cli/test/governance.js .evo-lite/cli/wiki/dictionary.js .evo-lite/cli/test/governance.js
git commit -m "feat(wiki): Chinese dictionary + deterministic narrative templates (4b-1 W4)"
```

---

### Task 5: [W5] wiki/render.js — SVG 模块地图 + index/module 页

**Files:**
- Create: `templates/cli/wiki/render.js`
- Test: `templates/cli/test/governance.js`(追加 T-wiki-render)

**Interfaces:**
- Consumes: W1 `createPageMap()` 实例;W3 `ModuleProjection`/`ProjectHealth`;W4 `dictionary` 全部导出;W2 `config`(可为 null)。
- Produces:
  ```
  escapeHtml(s) -> string
  validateEdges(edges, knownModuleIds) -> { valid:[{sourceModuleId,targetModuleId,kind}], warnings:string[] }
  renderSvgMap({ modules, groupsConfig, pageMap, validEdges }) -> string      // <svg>…</svg>
  renderIndex({ projection, groupsConfig, pageMap, meta }) -> string          // 完整 html
  renderModulePage({ mp, pageMap, meta, sourcePageFor }) -> string            // 完整 html
  pageChrome({ title, body, meta }) -> string                                 // 共享骨架 + 溯源脚注
  ```
  `meta = { generatedAt, headSha }`。依赖边元素类名固定 `class="dependency-edge"`、箭头引用固定 `marker-end="url(#dep-arrow)"` —— 测试以这两个记号断言。

**布局规则(确定性,无布局引擎):** 泳道 = role(或 groups 配置);泳道按设计 §2.1 固定顺序 `entry, service, feature, ui, runtime, scanner, governance, docs, test, unknown, <其他按字典序>`;泳道内模块按 moduleId 字典序;卡片坐标 = 纯函数(泳道索引 × 列宽, 卡片索引 × 行高)。有合法边时在卡片中心间画折线。

- [ ] **Step 1: 写失败测试**

```js
console.log('T-wiki-render. SVG map: lanes, no-edge honesty, edge contract, unknown role ...');
{
    const rPath = require.resolve(path.join(TEMPLATE_CLI_DIR, 'wiki', 'render'));
    delete require.cache[rPath];
    const pmPath = require.resolve(path.join(TEMPLATE_CLI_DIR, 'wiki', 'page-map'));
    delete require.cache[pmPath];
    const { validateEdges, renderSvgMap, renderIndex, escapeHtml } = require(rPath);
    const { createPageMap } = require(pmPath);

    const mkMp = (id, role) => ({ moduleId: id, name: id, description: '', role,
        files: [], tasks: [], taskCounts: { done: 0, open: 0, unknown: 0, shared: 0 },
        progressState: 'unplanned', healthState: 'normal', healthReasons: [], focus: false, recentCommits: [] });
    const modules = [mkMp('module:a', 'service'), mkMp('module:b', 'feature'), mkMp('module:x', 'mystery-role')];
    const known = modules.map(m => m.moduleId);

    // edges 为空 → 无 dependency-edge、无 marker-end、无 synthetic edge
    const svg0 = renderSvgMap({ modules, groupsConfig: null, pageMap: createPageMap(), validEdges: [] });
    assert.ok(!svg0.includes('dependency-edge'), 'no dependency-edge element when edges empty');
    assert.ok(!svg0.includes('marker-end'), 'no marker-end when edges empty');
    // 未知 role 不丢模块:进"其他"泳道
    assert.ok(svg0.includes('module:x') || svg0.includes('module-x'), 'unknown-role module must render');

    // 合法边 → dependency-edge 出现;无效端点 → 拒绝 + warning
    const { valid, warnings } = validateEdges([
        { sourceModuleId: 'module:a', targetModuleId: 'module:b', kind: 'depends' },
        { sourceModuleId: 'module:a', targetModuleId: 'module:ghost' },
        { sourceModuleId: 'module:a', targetModuleId: 'module:b', kind: 'depends' },   // 重复 → 去重
        { bogus: true },
    ], known);
    assert.strictEqual(valid.length, 1, 'dedup by source+target+kind; invalid rejected');
    assert.ok(warnings.length >= 2, 'invalid edges must produce warnings');
    const svg1 = renderSvgMap({ modules, groupsConfig: null, pageMap: createPageMap(), validEdges: valid });
    assert.ok(svg1.includes('dependency-edge') && svg1.includes('marker-end'), 'valid edge renders arrow');

    // escapeHtml:script/&/引号
    assert.strictEqual(escapeHtml('<script>&"\''), '&lt;script&gt;&amp;&quot;&#39;');

    // index:focus unresolved 呈现固定文案
    const html = renderIndex({ projection: { modules, project: { driftErrors: 0, driftWarnings: 0,
        unattributedFindings: [], verify: null, focusResolved: false,
        inputFreshness: { architecture: { state: 'unknown', reason: '' }, planning: { state: 'unknown', reason: '' } } },
        totals: { taskDone: 0, taskOpen: 0, taskUnknown: 0 }, warnings: [] },
        groupsConfig: null, pageMap: createPageMap(), meta: { generatedAt: '2026-01-01T00:00:00.000Z', headSha: 'abc1234' } });
    assert.ok(html.includes('当前焦点无法可靠定位'), 'unresolved focus fixed copy');
    assert.ok(html.includes('数据新鲜度无法确认'), 'unknown freshness must not render as normal');
    assert.ok(html.includes('abc1234'), 'provenance footer carries headSha');
    console.log('✅ T-wiki-render passed');
}
```

- [ ] **Step 2: 跑测试确认失败**(`Cannot find module ... wiki/render`)

- [ ] **Step 3: 最小实现**

```js
'use strict';

// Pure render layer (design §2). Input: projection facts + page map + optional
// groups config. Output: html/svg strings. NO fact computation here — only
// verbalization (via dictionary) and geometry (deterministic lane layout).

const { healthLabel, roleLabel, progressLabel, moduleNarrative, translateRule } = require('./dictionary');

const LANE_ORDER = ['entry', 'service', 'feature', 'ui', 'runtime', 'scanner', 'governance', 'docs', 'test', 'unknown'];
const CARD_W = 190, CARD_H = 64, LANE_GAP = 24, CARD_GAP = 14, LANE_HEADER = 40, PAD = 20;

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function validateEdges(edges, knownModuleIds) {
    const known = new Set(knownModuleIds);
    const valid = []; const warnings = []; const seen = new Set();
    for (const e of (Array.isArray(edges) ? edges : [])) {
        if (!e || typeof e.sourceModuleId !== 'string' || typeof e.targetModuleId !== 'string') {
            warnings.push(`malformed edge ignored: ${JSON.stringify(e).slice(0, 60)}`); continue;
        }
        if (!known.has(e.sourceModuleId) || !known.has(e.targetModuleId)) {
            warnings.push(`edge endpoint not a known module: ${e.sourceModuleId} -> ${e.targetModuleId}`); continue;
        }
        const key = `${e.sourceModuleId}->${e.targetModuleId}#${e.kind || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        valid.push({ sourceModuleId: e.sourceModuleId, targetModuleId: e.targetModuleId, kind: e.kind || '' });
    }
    return { valid, warnings };
}

// Deterministic lanes: groups config first (its order), remaining modules by
// role in LANE_ORDER, unrecognized roles appended alphabetically into 其他.
function computeLanes(modules, groupsConfig) {
    const lanes = []; const placed = new Set();
    if (groupsConfig && groupsConfig.groups.length) {
        for (const g of groupsConfig.groups) {
            const ms = g.moduleIds.map(id => modules.find(m => m.moduleId === id)).filter(Boolean);
            ms.forEach(m => placed.add(m.moduleId));
            lanes.push({ key: g.id, label: g.name, modules: ms });
        }
    }
    const rest = modules.filter(m => !placed.has(m.moduleId));
    const byRole = new Map();
    for (const m of rest) {
        const role = LANE_ORDER.includes(m.role) ? m.role : 'unknown';
        if (!byRole.has(role)) byRole.set(role, []);
        byRole.get(role).push(m);
    }
    const laneLabels = (groupsConfig && groupsConfig.laneLabels) || {};
    for (const role of LANE_ORDER) {
        const ms = (byRole.get(role) || []).sort((a, b) => (a.moduleId < b.moduleId ? -1 : 1));
        if (ms.length) lanes.push({ key: role, label: laneLabels[role] || roleLabel(role), modules: ms });
    }
    return lanes;
}

const HEALTH_FILL = { normal: '#e7f4e8', attention: '#fdf3d7', risk: '#fbe3e3' };

function renderSvgMap({ modules, groupsConfig, pageMap, validEdges }) {
    const lanes = computeLanes(modules, groupsConfig);
    const pos = new Map();
    let x = PAD;
    let maxRows = 1;
    for (const lane of lanes) { maxRows = Math.max(maxRows, lane.modules.length); }
    const height = LANE_HEADER + maxRows * (CARD_H + CARD_GAP) + PAD * 2;
    const parts = [];
    for (const lane of lanes) {
        parts.push(`<text x="${x}" y="${PAD + 14}" class="lane-label">${escapeHtml(lane.label)}</text>`);
        let y = PAD + LANE_HEADER;
        for (const m of lane.modules) {
            pos.set(m.moduleId, { cx: x + CARD_W / 2, cy: y + CARD_H / 2 });
            const alias = (groupsConfig && groupsConfig.moduleAliases && groupsConfig.moduleAliases[m.moduleId]) || m.name;
            const total = m.taskCounts.done + m.taskCounts.open + m.taskCounts.unknown;
            const ratio = total ? m.taskCounts.done / total : 0;
            parts.push(`<a href="${escapeHtml(pageMap.modulePage(m.moduleId))}">`
                + `<rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="8" fill="${HEALTH_FILL[m.healthState]}" stroke="#8a8a8a"/>`
                + `<text x="${x + 10}" y="${y + 22}" class="card-title">${escapeHtml(alias)}${m.focus ? ' ◎' : ''}</text>`
                + `<text x="${x + 10}" y="${y + 40}" class="card-sub">${escapeHtml(total ? `${m.taskCounts.done}/${total}` : '尚未纳入规划')}</text>`
                + `<rect x="${x + 10}" y="${y + 48}" width="${CARD_W - 20}" height="6" fill="#ddd"/>`
                + `<rect x="${x + 10}" y="${y + 48}" width="${Math.round((CARD_W - 20) * ratio)}" height="6" fill="#5a9"/>`
                + `</a>`);
            y += CARD_H + CARD_GAP;
        }
        x += CARD_W + LANE_GAP;
    }
    const edgeParts = [];
    if (validEdges && validEdges.length) {
        edgeParts.push('<defs><marker id="dep-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#666"/></marker></defs>');
        for (const e of validEdges) {
            const s = pos.get(e.sourceModuleId), t = pos.get(e.targetModuleId);
            if (!s || !t) continue;
            edgeParts.push(`<line class="dependency-edge" x1="${s.cx}" y1="${s.cy}" x2="${t.cx}" y2="${t.cy}" stroke="#666" marker-end="url(#dep-arrow)"/>`);
        }
    }
    const width = x + PAD;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
        + edgeParts.join('') + parts.join('') + '</svg>';
}

const CSS = `body{font-family:system-ui,'Microsoft YaHei',sans-serif;margin:24px;max-width:1100px}
.lane-label{font-weight:600;font-size:14px}.card-title{font-size:13px;font-weight:600}.card-sub{font-size:11px;fill:#555}
footer{margin-top:32px;color:#888;font-size:12px;border-top:1px solid #ddd;padding-top:8px}
table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px;font-size:13px}
.health-risk{color:#b00}.health-attention{color:#a60}.health-normal{color:#282}
details{margin-top:12px}summary{cursor:pointer;color:#666}`;

function pageChrome({ title, body, meta }) {
    return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>`
        + `<style>${CSS}</style></head><body>${body}`
        + `<footer>生成于 ${escapeHtml(meta.generatedAt)} @ ${escapeHtml(meta.headSha)}</footer></body></html>`;
}

function renderIndex({ projection, groupsConfig, pageMap, meta }) {
    const p = projection.project;
    const focusLine = p.focusResolved ? '' : '<p>当前焦点无法可靠定位。</p>';
    const fresh = `<p>数据新鲜度:${p.inputFreshness.architecture.state === 'fresh' ? '已确认' : '数据新鲜度无法确认'}。</p>`;
    const totals = projection.totals;
    const totalAll = totals.taskDone + totals.taskOpen + totals.taskUnknown;
    const unattributed = p.unattributedFindings.length
        ? `<p>另有 ${p.unattributedFindings.length} 项无法定位到具体模块的治理提醒(详见技术详情)。</p>` : '';
    const body = `<h1>项目全貌</h1>`
        + `<p>共 ${projection.modules.length} 个模块;任务 ${totalAll} 项,已完成 ${totals.taskDone} 项${totals.taskUnknown ? `,${totals.taskUnknown} 项状态未知` : ''}。</p>`
        + focusLine + fresh + unattributed
        + renderSvgMap({ modules: projection.modules, groupsConfig, pageMap, validEdges: projection.validEdges || [] })
        + `<details><summary>技术详情</summary><pre>${escapeHtml(JSON.stringify(p, null, 2))}</pre></details>`;
    return pageChrome({ title: '项目全貌 — Evo-Lite Wiki', body, meta });
}

function renderModulePage({ mp, pageMap, meta, sourcePageFor }) {
    const rows = mp.files.map(f => {
        const target = sourcePageFor(f);
        const cell = target.page ? `<a href="../${escapeHtml(target.page)}">${escapeHtml(f)}</a>`
            : `${escapeHtml(f)} <em>(源码页未生成:${escapeHtml(target.reason)})</em>`;
        return `<tr><td>${cell}</td></tr>`;
    }).join('');
    const taskRows = mp.tasks.map(t =>
        `<tr><td>${escapeHtml(t.title)}</td><td>${t.completion === 'done' ? '已完成' : t.completion === 'open' ? '进行中' : '状态未知'}${t.shared ? '(共享任务)' : ''}</td></tr>`).join('');
    const commits = mp.recentCommits.map(c => `<li><code>${escapeHtml(c.sha.slice(0, 7))}</code> ${escapeHtml(c.subject)}</li>`).join('');
    const body = `<h1>${escapeHtml(mp.name)}</h1>`
        + `<p>${escapeHtml(moduleNarrative(mp))}</p>`
        + (mp.description ? `<p><em>${escapeHtml(mp.description)}</em></p>` : '')
        + `<h2>任务(${progressLabel(mp)})</h2><table>${taskRows || '<tr><td>尚未纳入规划</td></tr>'}</table>`
        + `<h2>文件</h2><table>${rows}</table>`
        + (commits ? `<h2>最近变更</h2><ul>${commits}</ul>` : '')
        + `<details><summary>技术详情</summary><pre>${escapeHtml(JSON.stringify({ moduleId: mp.moduleId, role: mp.role, healthReasons: mp.healthReasons }, null, 2))}</pre></details>`
        + `<p><a href="../index.html">← 返回项目全貌</a></p>`;
    return pageChrome({ title: `${mp.name} — Evo-Lite Wiki`, body, meta });
}

module.exports = { escapeHtml, validateEdges, computeLanes, renderSvgMap, renderIndex, renderModulePage, pageChrome };
```

- [ ] **Step 4: 跑测试确认通过**(`✅ T-wiki-render passed`,EXIT 0)

- [ ] **Step 5: 同步镜像 + 提交**

```bash
node ./.evo-lite/cli/sync-runtime-entry.js
git add templates/cli/wiki/render.js templates/cli/test/governance.js .evo-lite/cli/wiki/render.js .evo-lite/cli/test/governance.js
git commit -m "feat(wiki): SVG module map + index/module pages, edge contract enforced (4b-1 W5)"
```

---

### Task 6: [W6] wiki/source-pages.js — 源码页(安全 + 规模契约)

**Files:**
- Create: `templates/cli/wiki/source-pages.js`
- Test: `templates/cli/test/governance.js`(追加 T-wiki-source)

**Interfaces:**
- Consumes: W1 `pageMap.sourcePage(path)`;W5 `escapeHtml`、`pageChrome`。
- Produces:
  ```
  generateSourcePages({ projectRoot, files:string[], pageMap, meta, limitBytes=524288 })
    -> { pages: [{ page:string, html:string }], skipped: [{ path, reason }], warnings: string[] }
  resolveContained(projectRoot, repoRelPath) -> string|null   // 越界/非法返回 null
  ```
  W7 build 用返回的 `pages` 落盘;module 页经 `sourcePageFor(f)` 查询(命中 pages → {page},命中 skipped → {reason})。

- [ ] **Step 1: 写失败测试**

```js
console.log('T-wiki-source. Source pages: containment, escaping, line anchors, binary/size caps ...');
{
    const sPath = require.resolve(path.join(TEMPLATE_CLI_DIR, 'wiki', 'source-pages'));
    delete require.cache[sPath];
    const pmPath2 = require.resolve(path.join(TEMPLATE_CLI_DIR, 'wiki', 'page-map'));
    delete require.cache[pmPath2];
    const { generateSourcePages, resolveContained } = require(sPath);
    const { createPageMap } = require(pmPath2);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-wiki-src-'));

    try {
        fs.writeFileSync(path.join(tmp, 'ok.js'), 'const a = 1;\nconst b = "<script>&\'";\n');
        fs.writeFileSync(path.join(tmp, 'bin.dat'), Buffer.from([0, 1, 2, 0, 3]));
        fs.writeFileSync(path.join(tmp, 'big.js'), 'x'.repeat(600 * 1024));

        // containment:.. / 绝对路径 → null
        assert.strictEqual(resolveContained(tmp, '../outside.txt'), null);
        assert.strictEqual(resolveContained(tmp, 'C:/Windows/system32/x'), null);
        assert.ok(resolveContained(tmp, 'ok.js'), 'legal relative path resolves');

        const meta = { generatedAt: '2026-01-01T00:00:00.000Z', headSha: 'abc1234' };
        const res = generateSourcePages({ projectRoot: tmp, files: ['ok.js', 'bin.dat', 'big.js', '../outside.txt'],
            pageMap: createPageMap(), meta });

        const okPage = res.pages.find(p => p.page.includes('ok.js') || p.page.includes('ok-js'));
        assert.ok(okPage, 'ok.js renders a page');
        assert.ok(okPage.html.includes('id="L2"'), 'stable line anchors');
        assert.ok(okPage.html.includes('&lt;script&gt;'), 'content is escaped');
        assert.ok(!okPage.html.includes('<script>&'), 'raw content must not leak');

        const reasons = Object.fromEntries(res.skipped.map(s => [s.path, s.reason]));
        assert.ok(reasons['bin.dat'], 'binary skipped with reason');
        assert.ok(reasons['big.js'], 'oversized skipped with reason');
        assert.ok(reasons['../outside.txt'], 'escaping path skipped with reason');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    console.log('✅ T-wiki-source passed');
}
```

- [ ] **Step 2: 跑测试确认失败**(`Cannot find module ... wiki/source-pages`)

- [ ] **Step 3: 最小实现**

```js
'use strict';

// Read-only source pages (design §2.3). Containment before read (same
// path-containment semantics as the 4a provider layer): repo-relative only,
// no '..', no absolute paths, realpath must stay inside projectRoot. All
// content is HTML-escaped; binary and oversized files get a stub reason and
// the module page keeps their entry.

const fs = require('node:fs');
const path = require('node:path');
const { escapeHtml, pageChrome } = require('./render');

const DEFAULT_LIMIT = 512 * 1024;

function resolveContained(projectRoot, repoRelPath) {
    const raw = String(repoRelPath).replace(/\\/g, '/');
    if (!raw || raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || raw.split('/').includes('..')) return null;
    const abs = path.resolve(projectRoot, raw);
    const rootReal = fs.realpathSync(projectRoot);
    let real;
    try { real = fs.realpathSync(abs); } catch { return null; }
    const rel = path.relative(rootReal, real);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return real;
}

function looksBinary(buf) {
    const n = Math.min(buf.length, 8000);
    for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
    return false;
}

function generateSourcePages({ projectRoot, files, pageMap, meta, limitBytes = DEFAULT_LIMIT }) {
    const pages = []; const skipped = []; const warnings = [];
    const sorted = [...new Set(files)].sort();
    for (const f of sorted) {
        const real = resolveContained(projectRoot, f);
        if (!real) { skipped.push({ path: f, reason: '路径不在项目内' }); continue; }
        let stat;
        try { stat = fs.statSync(real); } catch { skipped.push({ path: f, reason: '文件不可读' }); continue; }
        if (!stat.isFile()) { skipped.push({ path: f, reason: '不是普通文件' }); continue; }
        if (stat.size > limitBytes) { skipped.push({ path: f, reason: `超过 ${Math.round(limitBytes / 1024)} KiB 上限` }); continue; }
        const buf = fs.readFileSync(real);
        if (looksBinary(buf)) { skipped.push({ path: f, reason: '二进制文件不渲染' }); continue; }
        const lines = buf.toString('utf8').split(/\r?\n/);
        const bodyLines = lines.map((line, i) =>
            `<tr id="L${i + 1}"><td class="ln">${i + 1}</td><td><pre>${escapeHtml(line) || ' '}</pre></td></tr>`).join('');
        const body = `<h1><code>${escapeHtml(f)}</code></h1>`
            + `<table class="src">${bodyLines}</table>`
            + `<p><a href="../index.html">← 返回项目全貌</a></p>`;
        pages.push({ page: pageMap.sourcePage(f), html: pageChrome({ title: `${f} — 源码`, body, meta }) });
    }
    return { pages, skipped, warnings };
}

module.exports = { generateSourcePages, resolveContained, DEFAULT_LIMIT };
```

- [ ] **Step 4: 跑测试确认通过**(`✅ T-wiki-source passed`,EXIT 0)

- [ ] **Step 5: 同步镜像 + 提交**

```bash
node ./.evo-lite/cli/sync-runtime-entry.js
git add templates/cli/wiki/source-pages.js templates/cli/test/governance.js .evo-lite/cli/wiki/source-pages.js .evo-lite/cli/test/governance.js
git commit -m "feat(wiki): read-only source pages with containment, escaping and size caps (4b-1 W6)"
```

---

### Task 7: [W7] build.js + cli.js + 注册 + manifest + 镜像闭环

**Files:**
- Create: `templates/cli/wiki/build.js`, `templates/cli/wiki/cli.js`
- Modify: `templates/cli/memory.js`(`safeRegister('code', ...)` 行之后 +1 行)、`templates/cli/template-manifest.js`(core-cli files 数组 `'code-perception/cli.js'` 之后 +8 条)
- Test: `templates/cli/test/governance.js`(追加 T-wiki-build)

**Interfaces:**
- Consumes: W1-W6 全部导出(签名见各任务 Produces)。
- Produces:
  ```
  buildWiki({ projectRoot, now, deps }) -> { ok:true, outDir, manifest, warnings } | { ok:false, error }
  // deps(可注入,测试用):{ explore(projectRoot), verifySummary(projectRoot), gitLog(projectRoot) }
  registerWikiCommands(program)   // mem wiki build [--open];退出码 0/1/2 契约
  ```

**build 流程(确定性顺序):** 读 architecture-ir.json + plan-ir.json(任一缺失 → `{ok:false, error:'run: mem architecture scan / mem plan scan'}`)→ 读 drift-report.json(缺失=零 findings)→ `deps.explore` 取 focus(异常 → `{resolved:false}` + warning)→ `deps.verifySummary`(异常 → null + warning)→ `deps.gitLog` 取最近 10 commit(非 git 环境 → `[]` + warning)→ `validateEdges` → `buildProjection` → `loadWikiGroups`(`ok:false` → 原样返回给 CLI 映射 exit 2)→ 按 moduleId 排序申请 module 页、按路径排序申请 source 页 → 渲染全部页面 → 写盘(先清空 outDir)→ 写 manifest(pages 排序)。

- [ ] **Step 1: 写失败测试**

```js
console.log('T-wiki-build. Determinism (injected clock), manifest contract, rebuild identity ...');
{
    const bPath = require.resolve(path.join(TEMPLATE_CLI_DIR, 'wiki', 'build'));
    delete require.cache[bPath];
    const { buildWiki } = require(bPath);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-wiki-build-'));

    try {
        const gen = path.join(tmp, '.evo-lite', 'generated');
        fs.mkdirSync(path.join(gen, 'architecture'), { recursive: true });
        fs.mkdirSync(path.join(gen, 'planning'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'src.js'), 'hello();\n');
        fs.writeFileSync(path.join(gen, 'architecture', 'architecture-ir.json'), JSON.stringify({
            version: 'x', generatedAt: 't0',
            modules: [{ id: 'module:core', name: 'Core', description: 'd', paths: ['src.js'], fileCount: 1, role: 'service', confidence: 1 }],
            files: [{ path: 'src.js', module: 'module:core', role: 'service', confidence: 1 }],
            edges: [],
        }));
        fs.writeFileSync(path.join(gen, 'planning', 'plan-ir.json'), JSON.stringify({
            version: 'x', generatedAt: 't0',
            tasks: [{ id: 'task:t1', title: 'T1', status: 'implemented', linkedFiles: ['src.js'] }],
        }));

        const deps = {
            explore: async () => ({ focus: { entityId: null, taskId: null, resolved: false } }),
            verifySummary: () => null,
            gitLog: () => [],
        };
        const NOW = () => '2026-01-01T00:00:00.000Z';
        const hashDir = dir => {
            const acc = [];
            const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
                const p = path.join(d, e.name);
                if (e.isDirectory()) walk(p);
                else acc.push(e.name + ':' + require('node:crypto').createHash('sha1').update(fs.readFileSync(p)).digest('hex'));
            } };
            walk(dir); return acc.join('|');
        };

        const r1 = await buildWiki({ projectRoot: tmp, now: NOW, deps });
        assert.strictEqual(r1.ok, true, 'build must succeed');
        const outDir = r1.outDir;
        assert.ok(outDir.endsWith(path.join('.evo-lite', 'generated', 'wiki')), 'output dir contract');
        const h1 = hashDir(outDir);

        const r2 = await buildWiki({ projectRoot: tmp, now: NOW, deps });
        assert.strictEqual(hashDir(outDir), h1, 'same input + same clock => byte-identical');

        fs.rmSync(outDir, { recursive: true, force: true });
        await buildWiki({ projectRoot: tmp, now: NOW, deps });
        assert.strictEqual(hashDir(outDir), h1, 'delete + rebuild => identical (pure derivation)');

        const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
        assert.strictEqual(manifest.version, 'evo-architecture-wiki@1');
        assert.strictEqual(manifest.knownEdgeCount, 0);
        assert.strictEqual(manifest.inputFreshness.architecture.state, 'unknown', 'generatedAt-only IR must be unknown');
        assert.ok(manifest.modulePages['module:core'], 'modulePages maps original id');
        assert.ok(manifest.pages.includes('index.html'));
        void r2;
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    console.log('✅ T-wiki-build passed');
}

console.log('T-wiki-cli. mem wiki build exit codes: invalid groups => 2 ...');
{
    // 沿用 T-ce-cli 的 NODE_PATH + 临时 workspace spawn 模式(harness.js:18)
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-wiki-cli-'));
    try {
        const gen = path.join(tmp, '.evo-lite', 'generated');
        fs.mkdirSync(path.join(gen, 'architecture'), { recursive: true });
        fs.mkdirSync(path.join(gen, 'planning'), { recursive: true });
        fs.writeFileSync(path.join(gen, 'architecture', 'architecture-ir.json'), JSON.stringify({ modules: [], files: [], edges: [] }));
        fs.writeFileSync(path.join(gen, 'planning', 'plan-ir.json'), JSON.stringify({ tasks: [] }));
        fs.writeFileSync(path.join(tmp, '.evo-lite', 'wiki-groups.json'), JSON.stringify({ version: 'bogus@9', groups: [] }));
        const r = childProcess.spawnSync(process.execPath, [path.join(TEMPLATE_CLI_DIR, 'memory.js'), 'wiki', 'build'], {
            cwd: tmp, encoding: 'utf8',
            env: { ...process.env, EVO_LITE_WORKSPACE_ROOT: tmp, NODE_PATH: path.join(WORKSPACE_ROOT, '.evo-lite', 'node_modules') },
        });
        assert.strictEqual(r.status, 2, `invalid wiki-groups.json must exit 2, got ${r.status}: ${r.stderr}`);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    console.log('✅ T-wiki-cli passed');
}
```

注:governance.js 的该测试块所在函数若非 async,把 `await buildWiki(...)` 改为 `buildWiki(...).then(...)` 链式,或将块包入 `(async () => { ... })()` 并在既有 async 测试模式处等待——**沿用 T-ce 系列已有的 async 处理方式,保持一致**。

- [ ] **Step 2: 跑测试确认失败**(`Cannot find module ... wiki/build`)

- [ ] **Step 3: 实现 build.js**

```js
'use strict';

// Orchestrator (design §1/§6). Deterministic given (inputs snapshot, headSha,
// injected clock). No network access. Output dir is wiped and rebuilt.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createPageMap } = require('./page-map');
const { loadWikiGroups } = require('./groups');
const { buildProjection } = require('./projection');
const { validateEdges, renderIndex, renderModulePage } = require('./render');
const { generateSourcePages } = require('./source-pages');

function readJson(file) {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function defaultGitLog(projectRoot) {
    try {
        const out = execFileSync('git', ['log', '-10', '--pretty=format:%H%x00%s', '--name-only'],
            { cwd: projectRoot, encoding: 'utf8' });
        const commits = [];
        let current = null;
        for (const line of out.split('\n')) {
            if (line.includes(' ')) {
                const [sha, subject] = line.split(' ');
                current = { sha, subject, files: [] };
                commits.push(current);
            } else if (line.trim() && current) current.files.push(line.trim());
        }
        return commits;
    } catch { return null; }  // 非 git 环境 → null(上层记 warning,用 [])
}

function defaultDeps() {
    return {
        explore: async projectRoot => {
            const svc = require('../code-perception');
            void projectRoot;
            return svc.exploreCode('', { includeSource: false, includeImpact: false });
        },
        verifySummary: projectRoot => {
            const d = require('../dashboard-data');
            return d.buildDashboardData(projectRoot).verify;
        },
        gitLog: defaultGitLog,
    };
}

async function buildWiki({ projectRoot, now, deps }) {
    const clock = now || (() => new Date().toISOString());
    const d = { ...defaultDeps(), ...(deps || {}) };
    const warnings = [];
    const gen = path.join(projectRoot, '.evo-lite', 'generated');

    const architectureIR = readJson(path.join(gen, 'architecture', 'architecture-ir.json'));
    if (!architectureIR) return { ok: false, error: 'architecture IR missing — run: mem architecture scan' };
    const planIR = readJson(path.join(gen, 'planning', 'plan-ir.json'));
    if (!planIR) return { ok: false, error: 'planning IR missing — run: mem plan scan' };
    const driftReport = readJson(path.join(gen, 'architecture', 'drift-report.json')) || { findings: [], summary: {} };

    let exploreResult;
    try { exploreResult = await d.explore(projectRoot); }
    catch (e) { exploreResult = { focus: { entityId: null, taskId: null, resolved: false } }; warnings.push(`explore unavailable: ${e.message}`); }
    let verifySummary = null;
    try { verifySummary = d.verifySummary(projectRoot); }
    catch (e) { warnings.push(`verify summary unavailable: ${e.message}`); }
    let recentCommits = d.gitLog(projectRoot);
    if (!recentCommits) { recentCommits = []; warnings.push('git log unavailable — recent changes omitted'); }

    const knownIds = (architectureIR.modules || []).map(m => m.id);
    const groupsRes = loadWikiGroups(projectRoot, knownIds);
    if (!groupsRes.ok) return { ok: false, invalidConfig: true, error: `wiki-groups.json invalid:\n  ${groupsRes.errors.join('\n  ')}` };

    const edgeRes = validateEdges(architectureIR.edges, knownIds);
    warnings.push(...edgeRes.warnings);

    const projection = buildProjection({ architectureIR, planIR, exploreResult, driftReport, verifySummary, recentCommits });
    warnings.push(...projection.warnings);
    projection.validEdges = edgeRes.valid;

    let headSha = 'unknown';
    try { headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim(); }
    catch { warnings.push('git HEAD unavailable'); }
    const meta = { generatedAt: clock(), headSha };

    // deterministic page assignment order: modules by id, then source files sorted
    const pageMap = createPageMap();
    for (const m of projection.modules) pageMap.modulePage(m.moduleId);
    const allFiles = [...new Set(projection.modules.flatMap(m => m.files))].sort();
    const src = generateSourcePages({ projectRoot, files: allFiles, pageMap, meta });
    warnings.push(...src.warnings);
    const skippedByPath = new Map(src.skipped.map(s => [s.path, s.reason]));
    const pageByPath = new Map(src.pages.map(p => [allFiles.find(f => pageMap.sourcePage(f) === p.page), p.page]));
    const sourcePageFor = f => pageByPath.has(f) ? { page: pageByPath.get(f) }
        : { reason: skippedByPath.get(f) || '未生成' };

    const outDir = path.join(gen, 'wiki');
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    const written = [];
    const writePage = (rel, html) => {
        const abs = path.join(outDir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, html);
        written.push(rel.replace(/\\/g, '/'));
    };

    writePage('index.html', renderIndex({ projection, groupsConfig: groupsRes.config, pageMap, meta }));
    for (const mp of projection.modules) {
        writePage(pageMap.modulePage(mp.moduleId), renderModulePage({ mp, pageMap, meta, sourcePageFor }));
    }
    for (const p of src.pages) writePage(p.page, p.html);

    const manifest = {
        version: 'evo-architecture-wiki@1',
        generatedAt: meta.generatedAt,
        headSha,
        architectureIrGeneratedAt: architectureIR.generatedAt || null,
        planningIrGeneratedAt: planIR.generatedAt || null,
        inputFreshness: projection.project.inputFreshness,
        knownEdgeCount: edgeRes.valid.length,
        pages: [...written].sort(),
        modulePages: pageMap.modulePages(),
        warnings: [...warnings].sort(),
    };
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    return { ok: true, outDir, manifest, warnings };
}

module.exports = { buildWiki };
```

- [ ] **Step 4: 实现 cli.js + memory.js 注册 + manifest 登记**

`templates/cli/wiki/cli.js`:

```js
'use strict';

// mem wiki command group. Exit contract (design §5): success (even if the
// browser fails to open) = 0; build failure = 1; invalid args / invalid
// wiki-groups.json = 2. Browser launch uses execFile arg arrays — no shell.

const path = require('node:path');
const { execFile } = require('node:child_process');

function invalidArgsExit(err) {
    const code = err && err.code ? err.code : '';
    if (code === 'commander.help' || code === 'commander.helpDisplayed'
        || code === 'commander.version' || code === 'commander.helpDisplayedAfterError') {
        process.exit(0);
    }
    if (err && err.message) process.stderr.write(err.message + '\n');
    process.exit(2);
}

function openInBrowser(indexPath, onDone) {
    const p = process.platform;
    const [cmd, args] = p === 'win32' ? ['cmd', ['/c', 'start', '', indexPath]]
        : p === 'darwin' ? ['open', [indexPath]] : ['xdg-open', [indexPath]];
    execFile(cmd, args, err => onDone(err || null));
}

function registerWikiCommands(program) {
    const wiki = program.command('wiki').description('Architecture-governance wiki: static, offline, Chinese-language project map.');

    wiki.command('build')
        .description('Generate .evo-lite/generated/wiki/ from architecture + planning + governance data.')
        .option('--open', 'Open index.html in the default browser after a successful build')
        .action(async options => {
            const { buildWiki } = require('./build');
            const projectRoot = process.env.EVO_LITE_WORKSPACE_ROOT || process.cwd();
            const result = await buildWiki({ projectRoot });
            if (!result.ok) {
                process.stderr.write(result.error + '\n');
                process.exit(result.invalidConfig ? 2 : 1);
            }
            const indexPath = path.join(result.outDir, 'index.html');
            console.log(`wiki: ${result.manifest.pages.length} page(s) generated`);
            console.log(`  ${indexPath}`);
            if (result.warnings.length) console.log(`  warnings: ${result.warnings.length} (see manifest.json)`);
            if (options.open) {
                openInBrowser(indexPath, err => {
                    if (err) console.log(`  warning: could not open browser (${err.message}) — open the path above manually`);
                    process.exit(0);
                });
            } else process.exit(0);
        });

    wiki.action(() => wiki.outputHelp());
    for (const c of [wiki, ...wiki.commands]) c.exitOverride(invalidArgsExit);
}

module.exports = { registerWikiCommands };
```

`templates/cli/memory.js` — 在 `safeRegister('code', ...)` 行(≈L732)之后追加:

```js
    safeRegister('wiki', () => require('./wiki/cli').registerWikiCommands(program));
```

`templates/cli/template-manifest.js` — core-cli `files` 数组 `'code-perception/cli.js',` 之后追加:

```js
            'wiki/page-map.js',
            'wiki/groups.js',
            'wiki/projection.js',
            'wiki/dictionary.js',
            'wiki/render.js',
            'wiki/source-pages.js',
            'wiki/build.js',
            'wiki/cli.js',
```

- [ ] **Step 5: 跑测试确认通过**

```bash
node templates/cli/test.js governance
```
预期:T-wiki-build、T-wiki-cli 通过,全部既有测试不回归,EXIT 0。

- [ ] **Step 6: 母仓实景冒烟(不入库,产物是 git-ignored 生成物)**

```bash
node ./.evo-lite/cli/sync-runtime-entry.js       # 先同步,使镜像含 wiki/*
./.evo-lite/mem wiki build
```
预期:exit 0;输出 `.evo-lite/generated/wiki/index.html` 绝对路径;11 个模块页 + 源码页;manifest `knownEdgeCount: 0`。人工打开 index.html 检查中文叙事与点击链路。

- [ ] **Step 7: 全量闭环 + 提交**

```bash
node ./.evo-lite/cli/sync-runtime-entry.js       # 第二次必须 copied: 0
node templates/cli/test.js all                    # EXIT 0
node ./.evo-lite/cli/test.js all                  # EXIT 0
# GitNexus detect_changes 核对改动符号仅为本任务范围
git add templates/cli/wiki/build.js templates/cli/wiki/cli.js templates/cli/memory.js templates/cli/template-manifest.js templates/cli/test/governance.js .evo-lite/cli/wiki/ .evo-lite/cli/memory.js .evo-lite/cli/template-manifest.js .evo-lite/cli/test/governance.js
git commit -m "feat(wiki): mem wiki build orchestrator + CLI + manifest registration (4b-1 W7)"
```

---

## 整计划终局门(全任务完成后)

1. `node templates/cli/test.js all` EXIT 0;`node ./.evo-lite/cli/test.js all` EXIT 0
2. 镜像 byte-identical(100/100,新增 8 文件后的总数)且二次 sync `copied: 0`
3. 母仓 `mem wiki build` exit 0;`mem wiki build --open` 打开失败场景仍 exit 0
4. 坏 `wiki-groups.json` → exit 2;删除 architecture-ir.json → exit 1(恢复后复原)
5. `mem plan scan` 识别本 plan(7 任务);`mem verify` last_run=healthy
6. 主用户验收:打开 index.html,确认 §设计 的 Q5 诉求(架构图入口、模块进展、点击链路、中文人话)被满足 —— 这是 4b-1 的最终验收人

## Self-Review 记录(writing-plans 自查)

- **Spec 覆盖:**设计 §1(形态/manifest)→W7;§2.0(映射)→W1;§2.1(SVG/边契约)→W5;§2.2(分组)→W2;§2.3(源码页)→W6;§3(投影语义)→W3;§4(词典)→W4;§5(退出码)→W7;§6(时钟)→W7 测试;§7 十三项测试 → T-wiki-pagemap(11)/groups(10)/projection(7,8,12)/dictionary(9)/render(3,6,13 + 转义 4 部分)/source(4,5)/build+cli(1,2 + 退出码);§8 红线进 Global Constraints。GitHub permalink(§2.3 可选项)MVP 显式**不实现**(保守策略允许;本地源码页已是主落点)——留待真实需求。
- **占位符扫描:**无 TBD/TODO;所有代码步骤含完整代码。
- **类型一致性:**`createPageMap()/modulePage/sourcePage/modulePages`、`loadWikiGroups -> {ok,config|errors}`、`buildProjection` 返回形状、`validateEdges -> {valid,warnings}`、`generateSourcePages -> {pages,skipped,warnings}`、`buildWiki -> {ok,outDir,manifest,warnings}` 在 W1-W7 的 Consumes/Produces 与代码中逐一核对一致;`invalidConfig: true` 仅由 groups 失败路径产生并映射 exit 2。



