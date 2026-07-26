---
id: plan:attp-host-owned-write-roots
title: "Plan: ATTP host-owned write roots (attp-guard-allowlist)"
status: draft
---

# ATTP 宿主自有写入根 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 ATTP 的 PreToolUse 守卫在**不削弱项目外 containment** 的前提下,放行一类位于项目外、
但属于当前宿主与当前项目的受信写入根 —— 目前**只有一个**:由当前事件 `transcript_path` 派生的
该项目 Claude Code 持久记忆目录。

**Architecture:** 三层。①新增 dependency-neutral 路径原语 `takeover-physical-path.js`
(`resolvePhysicalPath(target, fsOps)` + coded error taxonomy),由 installer 与 receipt **共用**;
②`takeover-receipt.js` 新增 `deriveHostOwnedWriteRoots(hookInput)`,只消费当前事件的 `transcript_path`,
返回 `{ok, reason, roots}`,永不向守卫外抛;③`takeover-adapter.js` 的 target-path 门增加一条**并列**
允许根,并把物理归一化换成「已验证前缀 + 回拼未存在尾部」。receipt 门与健康门**不放宽**。

**Tech Stack:** Node.js (CommonJS)、Claude Code hooks(`hookSpecificOutput.permissionDecision`)、
现有 `templates/cli/test/harness.js` + `assert` 骨架、`sync-runtime` 模板镜像。

**契约文档(canonical):** `docs/superpowers/specs/2026-07-26-attp-host-owned-write-roots-design.md`
(设计冻结复审 APPROVED / FROZEN)。
**Intake spec:** `docs/specs/attp-host-owned-write-roots.md`(`adopted`)。
**运行时证据:** `docs/validation/attp-guard-allowlist-step0-transcript-path.md`(Step 0,主会话);
`docs/validation/attp-guard-allowlist-step0b-subagent-correlation.md`(Step 0b,真实 subagent,**分支 A**)。

**上游:** `spec:agent-takeover-trigger-protocol`(ATTP MVP)**保持 CLOSED,本计划不重开它**。
**下游:** 本计划收口后解除 `[attp-hive-rollout]` 的阻塞。

---

## Global Constraints

每个任务的需求都**隐含包含**本节。以下值逐字来自设计与 intake spec。

- **派生只来自当前事件的 `transcript_path`。** 不得从环境变量、settings、receipt 或任何持久化位置
  读取同名值。`transcript_path` 是宿主输入锚,不是用户配置项。
- **允许根只能是 `dirname(transcript_path)/memory`。** 不得放宽到 project-state root 整体,
  更不得是 `~/.claude/projects/**`。不实现、不依赖、不猜 `<slug>` 编码。
- **包含判定发生在 memory 目录这一层**,形式固定为:
  `target === allowedMemoryRoot || target.startsWith(allowedMemoryRoot + '/')`。
  **分隔符写字面量 `'/'`,禁止 `path.sep`** —— 本项目 `normalize()` 把 `\` 折成 `/`,
  在 Windows 上 `path.sep === '\\'`,混用会让精确路径命中而**所有子文件全部落空**。
- **禁止对 project-state slug 做裸字符串前缀匹配。** 本机 `~/.claude/projects/` 下已存在
  **两个**与母仓 slug 构成前缀关系的真实目录(一个 git worktree、一个单破折号的 `-templates`)。
- **receipt 门(a)与健康门(b)不放宽。** 例外只作用于 target-path 门(c)。
- **fail-closed 单向:只更严,不更松。** 锚点缺失/畸形/不可解析、宿主版本变化导致字段消失,
  一律**不启用例外**,绝不退回宽白名单。任何"锚点不可用时放宽"的分支都是本设计的反面。
- **`agent_id` / `agent_type` 不得进入派生逻辑。** 它们是 Step 0b 新观测到的字段,不在任何文档契约里,
  分支 A 下对结果也没有影响(见设计 §9.3)。
- **`Bash` 边界不变。** 守卫仍只守 `Edit`/`Write`;不得据此宣称守卫成为安全隔离。
- **既有 `T-takeover-*` 全套原样通过,一条不改。** 这是 §6 回拼改动 verdict-preserving 的**唯一证据**。
- **`templates/cli/` 是 canonical,`.evo-lite/cli/` 是镜像。** 收口时 `sync-runtime` 连续两次 `copied: 0`。
- **承重断言必须能杀死「该步未执行」的变异体;下游状态不足以证明消费时,加显式调用计数**
  (ATTP Gate 2 P1-1 的教训)。
- **所有序列化 envelope 的失败路径 `exit 0`。** 宿主只在 exit 0 解析 stdout JSON。

---

## 已核实的代码事实(实现须以此为准,勿再猜测)

以下均已在计划阶段读取源码核对,不是推断:

- `takeover-receipt.js:24` 持有**模块级可变** `let fsOps`,并 `require('./runtime')`(`getWorkspaceRoot`);
  导出含 `realpathStrict, pathExists, pathEntryInfo, normalize, __setFsOps, __resetFsOps`。
- `takeover-install.js` 用**函数级** `fsOps = fs` 参数(`readSettingsStrict` / `managedSettingsPath` /
  `resolveManagedSettingsPath` / `resolveManagedBackupPath` / `readBackupManifest` 等),
  且 `resolveManagedSettingsPath` **已导出**(`takeover-install.js:439`)—— 测试可直接注入伪 `fsOps`,
  无需在真实文件系统上造断链,跨平台确定。
- `takeover-install.js:170-172` 的 `normPath` 与 receipt 的 `normalize` 同形(`\`→`/`,win32 盘符大写)。
- `takeover-adapter.js:261` 相对路径按 **`projectRoot`** 解析(`path.resolve(projectRoot, target)`);
  `takeover-install.js:219` 相对路径同样按 `projectRoot` 解析。**相对性解析属于调用方,不进原语。**
- 守卫现有三条解析期 deny 文案(Task 6 之后必须逐字不变):
  - `[evo-lite] cannot stat '<probe>' (<msg>); refusing write.` —— 注意插值是 **probe**,不是 target
  - `[evo-lite] no existing ancestor for '<target>'; refusing write.` —— 插值是**原始 target 字符串**
  - `[evo-lite] cannot resolve target '<target>' (<msg>); refusing write.`
- installer 现有两条解析期错误文案:
  - `takeover: <existing> is a broken link; refusing to touch settings`
  - `takeover: no existing ancestor for <abs>`
  - (另有 `realpathOrThrow`:`takeover: cannot resolve <target> (<msg>); refusing to touch settings`)
- **`templates/cli/test/` 中目前没有任何测试断言上述 installer 文案**(已 grep 确认)。
  因此「不漂移」当前**没有回归网兜底** —— Task 2 必须先补,否则它只是一句愿望。
- 测试骨架:用例是 `runGovernanceTests()` 内的内联块,`console.log('T-…')` 开头、
  `console.log('✅ T-… passed')` 收尾,模块用 `require(path.join(TEMPLATE_CLI_DIR, '…'))`。
  symlink 用例的既有惯例是 try/catch 探测能力,失败则打印 `⏭️ … skipped` 而非硬失败。
- `template-manifest.js:18-22` 已登记 5 个 `takeover-*.js`,新模块须加入同一数组。

---

## 已裁定的行为变更(实施计划复审,设计 §6.2.1)

计划阶段核对源码时发现设计 §6.2 初稿的「两者结论一致」被证伪:对**非 ENOENT 的 lstat 错误**
(`EACCES` / `EPERM` / `EIO` …),`takeover-install.js:222-231` 会**吞掉**该错误、
当作"还没建的文件"继续向上走,而 receipt 的 `pathEntryInfo` 一律抛出。
即 installer 存在既有的 fail-open-ish 漂移。

**复审裁定:采纳更严的一侧。**

```text
installer 遇到非 ENOENT 的 lstat 错误 → 立即 fail-closed，不得继续上溯
onStatError: 'treat-as-missing'        → NOT ALLOWED（不给原语加宽松模式开关）
```

因此 Task 3 **不能**再声称「行为与文案全部不变」,正确表述是:

```text
既有【成功路径】与既有【错误路径文案】保持不变；
唯一批准的行为变化是：非 ENOENT 的 lstat 错误由"继续上溯"改为 fail-closed。
```

该变化必须有**前后两态证据**:Task 2 先 characterize 旧行为(吞掉并上溯),
Task 3 再按裁定把该条期望值翻转成 fail-closed。三条既有失败文案测试**不得**随之改动。

---

## File Structure

```text
新建
  templates/cli/takeover-physical-path.js       中性路径原语 + coded error taxonomy
                                                 只 require('path');无模块级 fs seam

修改
  templates/cli/takeover-install.js             改用原语;按 code 恢复既有文案
  templates/cli/takeover-receipt.js             改用原语;新增 deriveHostOwnedWriteRoots()
  templates/cli/takeover-adapter.js             target-path 门:回拼尾部 + 并列允许根
  templates/cli/template-manifest.js            登记新模块
  templates/cli/test/governance.js              新增 2 个套件 + 扩充 3 个既有套件
  README.md / README_EN.md                      项目外 deny 表述同步

治理产物（Task 9 才写，且必须一并提交）
  .evo-lite/active_context.md
  .evo-lite/raw_memory/ · .evo-lite/generated/

镜像（由 sync-runtime 生成，不手改）
  .evo-lite/cli/*
```

职责边界:**相对路径解析、containment 比较、deny 文案**全部留在调用方;
原语只负责「把一个绝对路径变成物理验证过的绝对路径」这一件事。

---

### Task 1: 中性路径原语 `takeover-physical-path.js`

**Files:**
- Create: `templates/cli/takeover-physical-path.js`
- Test: `templates/cli/test/governance.js`(新增套件 `T-takeover-physical-path`)

**Interfaces:**
- Consumes: 无(只 `require('path')`)
- Produces:
  - `resolvePhysicalPath(target: string, fsOps: {lstatSync, realpathSync}): string`
  - `PATH_CODES: { NOT_ABSOLUTE, NO_EXISTING_ANCESTOR, BROKEN_LINK, REALPATH_FAILED, STAT_FAILED }`
  - 抛出的 Error 携带四个字段,其中 `target` 与 `probe` 是**两个不同的诊断事实**:

```text
code    五个 PATH_CODES 之一
target  调用方请求解析的完整绝对路径（恒定，上溯不改变它）
probe   物理证明失败的那一级祖先（随上溯变化）
cause   底层 fs Error（NOT_ABSOLUTE / NO_EXISTING_ANCESTOR 时不设）
```

  唯一例外:`NOT_ABSOLUTE` 尚无可 resolve 的绝对目标,`target` 保留原始字符串。
  把 `target` 写成 `probe` 会在上溯过 ≥1 级之后**丢掉原始请求路径** —— 而那正是
  调用方拼装用户可见文案时唯一能用的信息。

- [x] **Step 1: 写失败测试**

在 `templates/cli/test/governance.js` 的 `T-takeover-fault-suite` 之后插入:

```javascript
        console.log('T-takeover-physical-path. neutral primitive: tail re-append + coded errors + no module-level seam ...');
        {
            const pp = require(path.join(TEMPLATE_CLI_DIR, 'takeover-physical-path.js'));
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-pp-'));
            const realRoot = fs.realpathSync(root);

            // 1. 已存在的路径:等价于 realpath
            assert.strictEqual(pp.resolvePhysicalPath(root, fs), realRoot, 'existing path resolves to its realpath');

            // 2. 【本议题的核心】未存在的多级尾部必须【回拼】,而不是退回祖先。
            //    不回拼的实现会返回 realRoot —— 那正是每个新项目首次记忆写入被误拒的原因。
            const missing = path.join(root, 'memory', 'deep', 'new.md');
            assert.strictEqual(pp.resolvePhysicalPath(missing, fs), path.join(realRoot, 'memory', 'deep', 'new.md'),
                'missing tail must be re-appended to the verified prefix, not collapsed to the ancestor');

            // 3. 相对路径不属于原语职责:必须显式拒绝,不得静默按 cwd 解析
            assert.throws(() => pp.resolvePhysicalPath('rel/x.md', fs),
                (e) => e.code === pp.PATH_CODES.NOT_ABSOLUTE, 'relative input must be rejected, never resolved against cwd');

            // 4. lstat 抛非 ENOENT(权限等)→ STAT_FAILED,绝不当成"不存在"而向上走
            const statErr = Object.assign(new Error('denied'), { code: 'EACCES' });
            assert.throws(() => pp.resolvePhysicalPath(path.join(root, 'x.md'), {
                lstatSync: () => { throw statErr; },
                realpathSync: () => { throw new Error('unreachable'); },
            }), (e) => e.code === pp.PATH_CODES.STAT_FAILED && e.cause === statErr,
                'non-ENOENT stat failure must surface as STAT_FAILED with its cause');

            // 4b.【承重】target 与 probe 是两个不同事实，必须在【上溯过 ≥1 级之后】才区分得开。
            //     上面所有用例都在第一次 probe 就失败（target === probe），把 target 误写成 probe
            //     一条也杀不掉。这里构造两级：最深一级 ENOENT 使其上溯，父级 EACCES 使其失败。
            {
                const requested = path.join(root, 'missing', 'deep', 'file.md');
                const deepDir = path.join(root, 'missing', 'deep');
                const eacces = Object.assign(new Error('denied'), { code: 'EACCES' });
                assert.throws(() => pp.resolvePhysicalPath(requested, {
                    lstatSync: (p) => {
                        if (p === requested) throw Object.assign(new Error('nope'), { code: 'ENOENT' });
                        if (p === deepDir) throw eacces;
                        throw new Error(`unexpected probe ${p}`);
                    },
                    realpathSync: () => { throw new Error('unreachable'); },
                }), (e) => {
                    assert.strictEqual(e.code, pp.PATH_CODES.STAT_FAILED);
                    assert.strictEqual(e.target, requested, 'target must stay the originally requested path');
                    assert.strictEqual(e.probe, deepDir, 'probe must be the ancestor that actually failed');
                    assert.strictEqual(e.cause, eacces, 'cause must be the underlying fs error');
                    return true;
                }, 'target and probe must remain distinguishable after the walk has moved up');
            }

            // 5. 断链 symlink 必须与一般 realpath 失败【可区分】—— installer 对前者有专门文案。
            //    用注入 fsOps 构造:lstat 成功且 isSymbolicLink,realpath 抛。跨平台确定,不需要 symlink 权限。
            const linkErr = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
            const brokenOps = {
                lstatSync: () => ({ isSymbolicLink: () => true }),
                realpathSync: () => { throw linkErr; },
            };
            assert.throws(() => pp.resolvePhysicalPath(path.join(root, 'link'), brokenOps),
                (e) => e.code === pp.PATH_CODES.BROKEN_LINK && e.probe === path.join(root, 'link'),
                'dangling link must be BROKEN_LINK and carry the offending probe');

            // 6. 非链接的 realpath 失败 → REALPATH_FAILED（与 5 走的是同一分支的两侧，必须分得开）
            assert.throws(() => pp.resolvePhysicalPath(path.join(root, 'plain'), {
                lstatSync: () => ({ isSymbolicLink: () => false }),
                realpathSync: () => { throw linkErr; },
            }), (e) => e.code === pp.PATH_CODES.REALPATH_FAILED, 'non-link realpath failure must be REALPATH_FAILED');

            // 6b. symlink 的 realpath 失败【不都是断链】：EACCES/EPERM/ELOOP/EIO 都可能。
            //     全部归为 BROKEN_LINK 会让 installer 对一个仅仅权限不足的链接输出误导性文案。
            for (const code of ['EACCES', 'EPERM', 'ELOOP']) {
                assert.throws(() => pp.resolvePhysicalPath(path.join(root, 'lnk'), {
                    lstatSync: () => ({ isSymbolicLink: () => true }),
                    realpathSync: () => { throw Object.assign(new Error(code), { code }); },
                }), (e) => e.code === pp.PATH_CODES.REALPATH_FAILED,
                    `a symlink failing realpath with ${code} is not a broken link`);
            }
            assert.throws(() => pp.resolvePhysicalPath(path.join(root, 'lnk'), {
                lstatSync: () => ({ isSymbolicLink: () => true }),
                realpathSync: () => { throw Object.assign(new Error('ENOTDIR'), { code: 'ENOTDIR' }); },
            }), (e) => e.code === pp.PATH_CODES.BROKEN_LINK, 'ENOTDIR on a symlink is still a broken link');

            // 7. 一路 ENOENT 到根 → NO_EXISTING_ANCESTOR
            assert.throws(() => pp.resolvePhysicalPath(path.join(root, 'a', 'b'), {
                lstatSync: () => { throw Object.assign(new Error('nope'), { code: 'ENOENT' }); },
                realpathSync: () => { throw new Error('unreachable'); },
            }), (e) => e.code === pp.PATH_CODES.NO_EXISTING_ANCESTOR, 'exhausting the walk must be NO_EXISTING_ANCESTOR');

            // 7b.【承重】程序缺陷必须在原语层就【原样冒泡】，不得被包装成 coded path error。
            //     否则它会一路降级成 deriveHostOwnedWriteRoots 的 {ok:false}，缺陷被静默吞掉。
            //     lstat 与 realpath 两侧都要有，缺一侧就漏一条通路。
            const defect = new TypeError('genuine defect: x is not a function');
            assert.throws(() => pp.resolvePhysicalPath(path.join(root, 'd1'), {
                lstatSync: () => { throw defect; },
                realpathSync: () => { throw new Error('unreachable'); },
            }), (e) => e === defect, 'a code-less lstat error is a programming defect and must bubble unwrapped');
            assert.throws(() => pp.resolvePhysicalPath(path.join(root, 'd2'), {
                lstatSync: () => ({ isSymbolicLink: () => false }),
                realpathSync: () => { throw defect; },
            }), (e) => e === defect, 'a code-less realpath error must bubble unwrapped too');

            // 8. 承重:模块必须是 dependency-neutral，且不得持有模块级可变 fs seam。
            //    这两条是 §6.1 的全部意义 —— 没有它们，"共用原语"会把 installer 绑进 receipt 的全局 seam。
            const src = fs.readFileSync(path.join(TEMPLATE_CLI_DIR, 'takeover-physical-path.js'), 'utf8');
            const requires = [...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
            assert.deepStrictEqual(requires, ['path'], `primitive must require only 'path'; got ${JSON.stringify(requires)}`);
            assert.ok(!/__setFsOps|let\s+fsOps|var\s+fsOps/.test(src), 'primitive must not hold a module-level mutable fs seam');
            assert.ok(!/require\(['"]fs['"]\)/.test(src), 'primitive must not require fs — fsOps is always caller-supplied');

            fs.rmSync(root, { recursive: true, force: true });
        }
        console.log('✅ T-takeover-physical-path passed');
```

- [x] **Step 2: 跑测试确认失败**

Run: `node templates/cli/test.js governance`
Expected: FAIL,`Cannot find module '…/takeover-physical-path.js'`

- [x] **Step 3: 写最小实现**

Create `templates/cli/takeover-physical-path.js`:

```javascript
'use strict';
// 中性路径原语。刻意【不】依赖 runtime / receipt / installer / memory service，也【不】持有任何
// 模块级可变 fs seam —— fsOps 每次由调用方显式传入。这样 installer（函数级 fsOps 参数）与
// receipt（模块级 seam）能共用同一实现，而不会把 installer 绑进一个它无权控制的全局 seam。
const path = require('path');

const PATH_CODES = {
    NOT_ABSOLUTE: 'ATTP_NOT_ABSOLUTE',
    NO_EXISTING_ANCESTOR: 'ATTP_NO_EXISTING_ANCESTOR',
    BROKEN_LINK: 'ATTP_BROKEN_LINK',
    REALPATH_FAILED: 'ATTP_REALPATH_FAILED',
    STAT_FAILED: 'ATTP_STAT_FAILED',
};

// 调用方要靠 code 恢复各自既有的错误文案，靠 target/probe 填插值，靠 cause 保留底层原因。
function pathError(code, message, fields) {
    const e = new Error(message);
    e.code = code;
    e.target = fields.target;
    e.probe = fields.probe;
    if (fields.cause) e.cause = fields.cause;
    return e;
}

// 返回【已物理验证的前缀 + 回拼的未存在尾部】的绝对路径。
//
// 两个承重点：
// (1) 用 lstat 而非 exists 找最近存在条目。断链 symlink 的 exists 为 false，若把它当成
//     "还没建的文件"跳过去，调用方就会拿祖先做 containment 判定并放行，而真正的写会沿链接
//     落到别处（R7 复审 P0-1 在守卫侧修的就是这个）。
// (2) 必须【回拼】未存在的尾部。只比较祖先对项目包含判定无害（祖先仍在项目内），但对
//     "允许根"判定是致命的：写 <root>/memory/new.md 而 memory/ 尚不存在时，祖先退到 <root>，
//     不在 <root>/memory 之下 —— 每个新项目的第一次记忆写入都会被拒。
function resolvePhysicalPath(target, fsOps) {
    const abs = String(target);
    if (!path.isAbsolute(abs)) {
        // 相对性解析属于调用方（守卫按 projectRoot 解析，installer 也按 projectRoot 解析）。
        // 在这里静默按 cwd 解析会造成一个只在某些工作目录下才复现的错判。
        // NOT_ABSOLUTE 是唯一的例外：此时还没有可 resolve 的绝对目标，target 保留原始字符串。
        throw pathError(PATH_CODES.NOT_ABSOLUTE, `path must be absolute: ${abs}`, { target: abs, probe: abs });
    }
    // requested 与 probe 承载两个【不同】的诊断事实，任何一处把 target 写成 probe 都会
    // 在上溯过 ≥1 级之后丢掉调用方原本请求的路径：
    //   target = 调用方请求解析的完整路径（恒定）
    //   probe  = 物理证明失败的那一级祖先（随上溯变化）
    const requested = path.resolve(abs);
    let probe = requested;
    const tail = [];
    for (;;) {
        let st;
        try {
            st = fsOps.lstatSync(probe);
        } catch (e) {
            // 只有【真实 fs 错误】才包装成 coded path error。没有字符串 code 的异常是程序缺陷
            // （典型是 TypeError），必须原样冒泡 —— 一旦被包装，下游会把它当成正常的路径不可用
            // 而降级成 {ok:false}，缺陷就被静默吞掉了。
            if (!e || typeof e.code !== 'string') throw e;
            if (e.code !== 'ENOENT') {
                // 权限等异常不得当成"不存在" —— 那会让调用方退到一个它本无权判定的祖先。
                // 已裁定：installer 也统一到这一侧（设计 §6.2.1），不提供 treat-as-missing 模式。
                throw pathError(PATH_CODES.STAT_FAILED, `cannot stat ${probe} (${e.message})`,
                    { target: requested, probe, cause: e });
            }
            const parent = path.dirname(probe);
            if (parent === probe) {
                throw pathError(PATH_CODES.NO_EXISTING_ANCESTOR, `no existing ancestor for ${requested}`,
                    { target: requested, probe });
            }
            tail.unshift(path.basename(probe));
            probe = parent;
            continue;
        }
        let physical;
        try {
            physical = fsOps.realpathSync(probe);
        } catch (e) {
            if (!e || typeof e.code !== 'string') throw e;   // 同上：程序缺陷原样冒泡
            // 断链与一般解析失败必须分得开：installer 对断链有专门文案，守卫对两者用同一条。
            // 但 symlink 的 realpath 失败【不都是断链】—— EACCES/EPERM/ELOOP/EIO 只是解析不了，
            // 全归为 BROKEN_LINK 会让 installer 对一个权限不足的链接输出误导性文案。
            const dangling = st && st.isSymbolicLink() && (e.code === 'ENOENT' || e.code === 'ENOTDIR');
            throw pathError(dangling ? PATH_CODES.BROKEN_LINK : PATH_CODES.REALPATH_FAILED,
                `cannot resolve ${probe} (${e.message})`, { target: requested, probe, cause: e });
        }
        return tail.length ? path.join(physical, ...tail) : physical;
    }
}

module.exports = { resolvePhysicalPath, PATH_CODES };
```

- [x] **Step 4: 跑测试确认通过**

Run: `node templates/cli/test.js governance`
Expected: `✅ T-takeover-physical-path passed`,全套 EXIT 0

- [x] **Step 5: 变异体验证(承重,逐条独立归因)**

对生产模块逐条施加下列变异,确认**各自**被杀,然后**复原**:

| 变异 | 必须被杀于 |
|---|---|
| `return tail.length ? path.join(physical, ...tail) : physical` → `return physical` | 用例 2 |
| `if (e.code !== 'ENOENT')` → 删除该分支(全部当作不存在) | 用例 4 |
| `dangling ? BROKEN_LINK : REALPATH_FAILED` → 恒为 `REALPATH_FAILED` | 用例 5 |
| `dangling` 去掉 `e.code === 'ENOENT' \|\| e.code === 'ENOTDIR'` 收窄条件 | 用例 6b 的三条 |
| 删除 `NOT_ABSOLUTE` 前置检查 | 用例 3 |
| 删除 lstat 侧的 `typeof e.code !== 'string'` 冒泡 | 用例 7b 第一条 |
| 删除 realpath 侧的 `typeof e.code !== 'string'` 冒泡 | 用例 7b 第二条 |
| 任一 `pathError` 的 `target: requested` → `target: probe` | 用例 4b(其余用例 `target === probe`,杀不掉) |

- [x] **Step 6: 登记到 manifest**

在 `templates/cli/template-manifest.js` 的 takeover 模块数组中,`'takeover-payload.js'` 之前插入一行:

```javascript
            'takeover-physical-path.js',
```

- [x] **Step 7: 提交**

```bash
git add templates/cli/takeover-physical-path.js templates/cli/template-manifest.js templates/cli/test/governance.js
git commit -m "feat(takeover): add dependency-neutral resolvePhysicalPath primitive with coded errors"
```

---

### Task 2: 先锁住 installer 现有错误文案(characterization,零生产改动)

先补网再重构。**本任务不改任何生产代码** —— 断言必须对**当前**实现即刻通过;
若有一条不通过,说明我对现状的理解是错的,停下来报告,不要改生产代码去迎合断言。

**Files:**
- Test: `templates/cli/test/governance.js`(扩充既有 `T-takeover-installer`)

**Interfaces:**
- Consumes: `takeover-install.js` 的 `resolveManagedSettingsPath(projectRoot, settingsPath, fsOps)`(已导出)
- Produces: 三条文案的回归网,供 Task 3 证明不漂移

- [ ] **Step 1: 写 characterization 测试**

在 `T-takeover-installer` 块内、`console.log('✅ T-takeover-installer passed')` 之前追加:

```javascript
            // ── 错误文案 characterization（Task 2）──
            // 这三条文案是 installer 的对外契约，但在此之前【没有任何测试断言过】。
            // Task 3 要把解析逻辑换成中性原语，没有这张网，"文案不漂移"只是一句愿望。
            // 用注入 fsOps 构造，不依赖 symlink 权限，跨平台确定。
            {
                const inst = require(path.join(TEMPLATE_CLI_DIR, 'takeover-install.js'));
                const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-inst-msg-'));
                const realRoot = fs.realpathSync(projectRoot);
                const settings = path.join(realRoot, '.claude', 'settings.json');
                const enoent = () => Object.assign(new Error('no entry'), { code: 'ENOENT' });
                // 逐字比较，不用宽正则：宽正则会让"错误映射到了别的分支"照样绿。
                const exactly = (text) => (e) => { assert.strictEqual(e.message, text); return true; };

                // (1) 断链 symlink：lstat 成功且是链接 → 专属文案
                assert.throws(() => inst.resolveManagedSettingsPath(projectRoot, settings, {
                    existsSync: () => false,
                    lstatSync: () => ({ isSymbolicLink: () => true }),
                    // 两个都要认：macOS 上 mkdtemp 给 /var/…，realpath 给 /private/var/…
                    realpathSync: (p) => { if (p === projectRoot || p === realRoot) return realRoot; throw enoent(); },
                }), exactly(`takeover: ${settings} is a broken link; refusing to touch settings`),
                    'broken-link message is part of the installer contract');

                // (2) 一路 ENOENT 走到文件系统根 → 专属文案。
                //     existsSync 必须【恒 false】：若写成 (p) => p === projectRoot，循环会在
                //     projectRoot 处 break 并成功回拼，根本进不了 no-existing-ancestor 分支。
                assert.throws(() => inst.resolveManagedSettingsPath(projectRoot, settings, {
                    existsSync: () => false,
                    lstatSync: () => { throw enoent(); },
                    // 两个都要认：macOS 上 mkdtemp 给 /var/…，realpath 给 /private/var/…
                    realpathSync: (p) => { if (p === projectRoot || p === realRoot) return realRoot; throw enoent(); },
                }), exactly(`takeover: no existing ancestor for ${settings}`),
                    'no-existing-ancestor message is part of the installer contract');

                // (3) 【Task 3 要替换的那个分支】：projectRoot 解析成功、settings 是普通条目、
                //     但它自身 realpath 失败。若写成"projectRoot 自己 realpath 失败"，覆盖的是函数
                //     开头的 realpathOrThrow(projectRoot)，而不是最近存在祖先的解析 —— Task 3 即使
                //     把 REALPATH_FAILED 映射错，那种写法仍会绿。
                assert.throws(() => inst.resolveManagedSettingsPath(projectRoot, settings, {
                    existsSync: () => true,
                    lstatSync: () => ({ isSymbolicLink: () => false }),
                    realpathSync: (p) => {
                        if (p === projectRoot || p === realRoot) return realRoot;
                        throw Object.assign(new Error('boom'), { code: 'EACCES' });
                    },
                }), exactly(`takeover: cannot resolve ${settings} (boom); refusing to touch settings`),
                    'ancestor-realpath-failure message is part of the installer contract');

                // (4) 【legacy characterization —— 记录的是【当前】行为，不是目标行为】
                //     非 ENOENT 的 lstat 错误目前被【吞掉】，循环继续上溯，最终成功返回受管路径。
                //     设计 §6.2.1 已裁定这是 fail-open-ish 漂移，Task 3 会把本条期望值翻转。
                //     先把旧行为钉在这里，才谈得上"前后两态证据"。
                {
                    const claudeDir = path.join(realRoot, '.claude');
                    const unexpected = () => Object.assign(new Error('unexpected probe'), { code: 'ENOENT' });
                    let statCalls = 0;
                    // 只让 settings 这一级"看起来不存在"且 lstat 抛 EACCES；它的父目录正常存在。
                    // 于是循环把这一级当成"还没建的文件"跳过，从父目录成功回拼 —— 这就是漂移本身。
                    const got = inst.resolveManagedSettingsPath(projectRoot, settings, {
                        existsSync: (p) => p !== settings,
                        lstatSync: (p) => {
                            if (p !== settings) throw unexpected();
                            statCalls += 1;
                            throw Object.assign(new Error('denied'), { code: 'EACCES' });
                        },
                        realpathSync: (p) => {
                            if (p === projectRoot) return realRoot;
                            if (p === claudeDir) return claudeDir;
                            throw unexpected();
                        },
                    });
                    assert.strictEqual(statCalls, 1, 'the EACCES branch must actually have been exercised');
                    assert.strictEqual(got, settings,
                        'LEGACY: a non-ENOENT lstat error is currently swallowed and the walk continues (see §6.2.1)');
                }

                fs.rmSync(projectRoot, { recursive: true, force: true });
            }
```

- [ ] **Step 2: 跑测试确认【立即通过】**

Run: `node templates/cli/test.js governance`
Expected: `✅ T-takeover-installer passed`。

**这一步不期望红灯。** 若任何一条失败,说明《已核实的代码事实》中关于 installer 文案的记录有误
—— **停止,报告实际文案,不要修改生产代码**。

- [ ] **Step 3: 反向验证这张网真的收得住**

临时把 `takeover-install.js:227` 的 broken-link 文案改一个字(如 `broken` → `bad`),
确认用例 (1) 变红;然后**复原**。对 (2) 同样做一次。
没有这一步,characterization 测试可能只是恰好命中了别的错误路径。

- [ ] **Step 4: 提交**

```bash
git add templates/cli/test/governance.js
git commit -m "test(takeover): characterize installer path-resolution error messages before refactor"
```

---

### Task 3: installer 改用中性原语

**前置:文首《计划阶段发现》必须已有复审裁定。** 未裁定不得开始本任务。

**Files:**
- Modify: `templates/cli/takeover-install.js:217-240`
- Test: `templates/cli/test/governance.js`(Task 2 的网 + 既有 `T-takeover-installer`)

**Interfaces:**
- Consumes: Task 1 的 `resolvePhysicalPath` / `PATH_CODES`
- Produces: `resolveManagedSettingsPath`,其中
  - 既有**成功路径**与既有**错误路径文案**不变(Task 2 的三条逐字断言为准);
  - **唯一批准的行为变化**:非 ENOENT 的 lstat 错误由「继续上溯」收紧为 fail-closed(设计 §6.2.1),
    新增文案 `takeover: cannot stat <probe> (<cause>); refusing to touch settings`。

- [ ] **Step 1: 引入原语**

在 `takeover-install.js` 顶部 require 区加入:

```javascript
const { resolvePhysicalPath, PATH_CODES } = require('./takeover-physical-path');
```

- [ ] **Step 2: 替换祖先上溯循环,按 code 恢复既有文案**

把 `resolveManagedSettingsPath` 中从 `let existing = abs;` 到
`const target = normPath(physical);` 之间的循环替换为:

```javascript
    let physical;
    try {
        physical = resolvePhysicalPath(abs, fsOps);
    } catch (e) {
        // 文案是 installer 的对外契约（Task 2 已锁）。原语只给 code，文案在这里恢复。
        if (e && e.code === PATH_CODES.BROKEN_LINK) {
            throw new Error(`takeover: ${e.probe} is a broken link; refusing to touch settings`);
        }
        if (e && e.code === PATH_CODES.NO_EXISTING_ANCESTOR) {
            throw new Error(`takeover: no existing ancestor for ${abs}`);
        }
        if (e && e.code === PATH_CODES.REALPATH_FAILED) {
            throw new Error(`takeover: cannot resolve ${e.probe} (${e.cause.message}); refusing to touch settings`);
        }
        // 已批准的行为收紧（§6.2.1）：非 ENOENT 的 lstat 错误不再被吞掉。
        // 文案用 "cannot stat" 而非 "cannot resolve" —— 二者是不同的失败事实，
        // 混成一条会让运维看不出到底是"读不到条目"还是"解析不出物理路径"。
        if (e && e.code === PATH_CODES.STAT_FAILED) {
            throw new Error(`takeover: cannot stat ${e.probe} (${e.cause.message}); refusing to touch settings`);
        }
        throw e;
    }
    const target = normPath(physical);
```

- [ ] **Step 3: 翻转 legacy characterization(唯一批准的行为变化)**

Task 2 case (4) 记录的是**旧**行为。按设计 §6.2.1 的裁定,把它改成新契约 ——
**只改这一条**,同一 fsOps 构造原样保留:

```javascript
                {
                    const claudeDir = path.join(realRoot, '.claude');
                    const unexpected = () => Object.assign(new Error('unexpected probe'), { code: 'ENOENT' });
                    let statCalls = 0;
                    // §6.2.1 批准的收紧：非 ENOENT 的 lstat 错误不再被当成"不存在"继续上溯。
                    // "不存在"与"无法证明存在状态"是两个不同事实；后者已经失去构造物理路径证明的能力。
                    assert.throws(() => inst.resolveManagedSettingsPath(projectRoot, settings, {
                        existsSync: (p) => p !== settings,
                        lstatSync: (p) => {
                            if (p !== settings) throw unexpected();
                            statCalls += 1;
                            throw Object.assign(new Error('denied'), { code: 'EACCES' });
                        },
                        realpathSync: (p) => {
                            if (p === projectRoot) return realRoot;
                            if (p === claudeDir) return claudeDir;
                            throw unexpected();
                        },
                    }), exactly(`takeover: cannot stat ${settings} (denied); refusing to touch settings`),
                        'a non-ENOENT lstat error must now fail closed (§6.2.1), not be swallowed');
                    assert.strictEqual(statCalls, 1, 'and the EACCES branch must still be the one exercised');
                }
```

- [ ] **Step 4: 跑测试 —— 三条既有文案断言与 `T-takeover-installer` 全套必须原样通过**

Run: `node templates/cli/test.js governance`
Expected: `✅ T-takeover-installer passed`。

**Task 2 的 (1)(2)(3) 三条逐字文案断言不得有任何改动。** 若它们中的任何一条需要修改才能通过,
说明映射写错了 —— 停止并报告,不要改断言去迎合实现。允许改变期望值的**只有** case (4) 这一条。

- [ ] **Step 5: 承重 —— 确认 installer 与 receipt 的依赖方向没有反向**

在 `T-takeover-installer` 末尾追加:

```javascript
            // §6.1 承重：installer 不得 import receipt。receipt 持有模块级可变 fs seam 与 runtime 依赖，
            // 把 installer 绑进去会制造反向耦合，并让 installer 继承一个它无权控制的全局 seam。
            {
                const src = fs.readFileSync(path.join(TEMPLATE_CLI_DIR, 'takeover-install.js'), 'utf8');
                assert.ok(!/require\(['"]\.\/takeover-receipt['"]\)/.test(src),
                    'takeover-install.js must not require takeover-receipt.js (reverse coupling)');
                assert.ok(/require\(['"]\.\/takeover-physical-path['"]\)/.test(src),
                    'takeover-install.js must consume the shared neutral primitive');
            }
```

- [ ] **Step 6: 提交**

```bash
git add templates/cli/takeover-install.js templates/cli/test/governance.js
git commit -m "refactor(takeover): route installer path resolution through the shared primitive

Includes the one approved behaviour change (design 6.2.1): a non-ENOENT lstat
error now fails closed instead of being swallowed and walked past."
```

---

### Task 4: 守卫改用原语 —— 回拼未存在尾部(verdict-preserving)

本任务**只做归一化改造,不引入任何允许根**。把它与 Task 6 分开,是为了让
「既有裁决不变」和「新增例外」各自独立可否决。

**Files:**
- Modify: `templates/cli/takeover-adapter.js:261-291`
- Test: `templates/cli/test/governance.js`(既有 `T-takeover-target-path` / `T-takeover-guard` /
  `T-takeover-session-scope` **不得修改**,新增一条断言)

**Interfaces:**
- Consumes: `resolvePhysicalPath` / `PATH_CODES`(经 receipt re-export,见 Step 1)
- Produces: 守卫解析出的 `resolved` 为「已验证前缀 + 回拼尾部」

- [ ] **Step 1: 由 receipt re-export,守卫不直接依赖原语文件**

守卫的 fs 注入点始终是 receipt 的 `__setFsOps`(故障注入据此覆盖)。原语无自有 seam,
必须由 receipt 用自己的 `fsOps` 调用,否则注入会失效。

在 `takeover-receipt.js` 顶部加:

```javascript
const { resolvePhysicalPath: resolvePhysicalPathRaw, PATH_CODES } = require('./takeover-physical-path');
```

在导出前加一个绑定当前 seam 的薄封装:

```javascript
// 绑定本模块的 fs seam：原语自身无 seam（刻意），守卫的故障注入必须仍然生效。
function resolvePhysical(target) { return resolvePhysicalPathRaw(target, fsOps); }
```

并把 `resolvePhysical, PATH_CODES` 加入 `module.exports`。

- [ ] **Step 2: 写失败测试(首次创建路径)**

在 `T-takeover-target-path` 块内、该块收尾之前追加:

```javascript
            // Task 4 承重：目标的【未存在尾部】必须回拼，而不是塌回最近存在祖先。
            // 现状实现拿祖先与 projectRoot 比较；对项目内判定这没问题（祖先仍在项目内），
            // 所以只测 allow 是测不出来的 —— 必须直接观察解析结果。
            {
                const rcp = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
                const deep = path.join(root, 'no-such-dir', 'deeper', 'new.js');
                assert.strictEqual(rcp.normalize(rcp.resolvePhysical(deep)),
                    rcp.normalize(path.join(rcp.canonicalProjectRoot(root), 'no-such-dir', 'deeper', 'new.js')),
                    'guard-side resolution must re-append the missing tail, not collapse to the nearest ancestor');
                assert.strictEqual(await dec({ file_path: deep }), 'allow', 'deep not-yet-created in-project path still allows');
            }
```

- [ ] **Step 3: 跑测试确认失败**

Run: `node templates/cli/test.js governance`
Expected: FAIL,`rcp.resolvePhysical is not a function`(Step 1 未做时)或回拼断言不等

- [ ] **Step 4: 替换守卫的解析段**

把 `takeover-adapter.js` 中从 `let probe = abs;` 到
`catch (e) { return ptu('deny', \`[evo-lite] cannot resolve target ...\`); }` 整段
(即现 264-277 行)替换为:

```javascript
    // 解析交给共用原语（takeover-physical-path.js）。lstat 语义与断链处理不变；
    // 唯一变化是把"最近存在祖先"换成"已验证前缀 + 回拼的未存在尾部"。
    // 对项目包含判定这是 verdict-preserving：尾部是相对片段，不改变所属根。
    let probe;
    try {
        probe = rc.resolvePhysical(abs);
    } catch (e) {
        if (e && e.code === rc.PATH_CODES.STAT_FAILED) {
            return ptu('deny', `[evo-lite] cannot stat '${e.probe}' (${e.cause && e.cause.message}); refusing write.`);
        }
        if (e && e.code === rc.PATH_CODES.NO_EXISTING_ANCESTOR) {
            return ptu('deny', `[evo-lite] no existing ancestor for '${target}'; refusing write.`);
        }
        return ptu('deny', `[evo-lite] cannot resolve target '${target}' (${(e && e.cause && e.cause.message) || (e && e.message)}); refusing write.`);
    }
```

`const cp = rc.normalize(probe), cr = rc.normalize(projectRoot);` 及其后的比较**保持不变**。

- [ ] **Step 5: 跑全套 —— 既有三套件必须原样通过**

Run: `node templates/cli/test.js governance`
Expected: `✅ T-takeover-target-path passed` / `✅ T-takeover-guard passed` /
`✅ T-takeover-session-scope passed` / `✅ T-takeover-fault-suite passed`,全部 EXIT 0,
且这三个套件的源码**一个字符都没有为了让它们通过而改动**(Step 2 新增的断言除外)。

这就是设计 §6 所说的「verdict-preserving 的唯一证据」。若任何一条需要修改才能通过,
说明回拼不是 verdict-preserving —— **停止并报告**,不要修改既有断言。

- [ ] **Step 6: 提交**

```bash
git add templates/cli/takeover-receipt.js templates/cli/takeover-adapter.js templates/cli/test/governance.js
git commit -m "refactor(takeover): guard resolves via shared primitive, re-appending the missing tail"
```

---

### Task 5: `deriveHostOwnedWriteRoots(hookInput)`

**Files:**
- Modify: `templates/cli/takeover-receipt.js`
- Test: `templates/cli/test/governance.js`(新增套件 `T-takeover-host-owned-roots`)

**Interfaces:**
- Consumes: `resolvePhysical`(Task 4)、模块级 `fsOps` seam
- Produces: `deriveHostOwnedWriteRoots(hookInput): { ok: boolean, reason: string|null, roots: string[] }`
  —— 永不返回 `null`,永不抛出预期内的路径错误;`ok:false` 时 `roots` 恒为 `[]`

**异常边界(设计冻结复审 P2-2,不得偏离):**

```text
resolvePhysicalPath()        对路径 / lstat / realpath 问题抛 coded error
deriveHostOwnedWriteRoots()  捕获【预期的 coded path errors】→ {ok:false, reason, roots:[]}
                             输入验证失败同样返回 ok:false
                             仅真正的程序缺陷 / 意外异常允许冒泡
守卫最外层 catch             仍保证 deny
```

即:锚点不可用是**正常的业务结果**,不得变成整个 guard 的"内部故障";
而真正的编程错误必须继续冒泡,以免掩盖缺陷。

- [ ] **Step 1: 写失败测试**

新增套件,置于 `T-takeover-physical-path` 之后:

```javascript
        console.log('T-takeover-host-owned-roots. event-derived memory root; fail-closed on every malformed anchor ...');
        {
            const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
            const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-state-'));
            const realState = fs.realpathSync(stateRoot);
            const transcript = path.join(stateRoot, 'sess-abc.jsonl');
            fs.writeFileSync(transcript, '', 'utf8');

            // 1. 正常：唯一 root = dirname(transcript_path)/memory，且【不要求 memory/ 已存在】
            const okRes = rc.deriveHostOwnedWriteRoots({ transcript_path: transcript });
            assert.strictEqual(okRes.ok, true, 'well-formed transcript_path enables the exception');
            assert.deepStrictEqual(okRes.roots, [rc.normalize(realState) + '/memory'],
                'exactly one root, at the memory level, derived from the current event');
            assert.strictEqual(fs.existsSync(path.join(stateRoot, 'memory')), false,
                'and it must not require memory/ to exist — that is the new-project first-write case');

            // 2. fail-closed 输入矩阵：每一条都必须 ok:false 且 roots 为空
            const bad = [
                ['null input', null],
                ['non-object', 'nope'],
                ['missing field', {}],
                ['non-string', { transcript_path: 42 }],
                ['empty string', { transcript_path: '' }],
                ['relative path', { transcript_path: 'rel/sess.jsonl' }],
                ['dirname degenerates to itself', { transcript_path: path.parse(realState).root }],
                ['nonexistent state root', { transcript_path: path.join(stateRoot, 'gone', 'sess.jsonl') }],
            ];
            for (const [label, input] of bad) {
                const r = rc.deriveHostOwnedWriteRoots(input);
                assert.strictEqual(r.ok, false, `${label} must not enable the exception`);
                assert.deepStrictEqual(r.roots, [], `${label} must yield no roots`);
                assert.ok(typeof r.reason === 'string' && r.reason.length > 0, `${label} must carry a diagnosable reason`);
            }

            // 3. 承重：派生【只】看 transcript_path。喂入 env/settings/receipt 风格的同名旁路值不得生效。
            const prevEnv = process.env.CLAUDE_TRANSCRIPT_PATH;
            process.env.CLAUDE_TRANSCRIPT_PATH = transcript;
            try {
                const r = rc.deriveHostOwnedWriteRoots({ cwd: stateRoot, session_id: 'abc' });
                assert.strictEqual(r.ok, false, 'an env-var fallback must NOT exist; only the current event may anchor');
            } finally {
                if (prevEnv === undefined) delete process.env.CLAUDE_TRANSCRIPT_PATH;
                else process.env.CLAUDE_TRANSCRIPT_PATH = prevEnv;
            }

            // 4. 承重：agent_id / agent_type 不得进入派生逻辑（Step 0b 分支 A；它们是未文档化字段）。
            const withAgent = rc.deriveHostOwnedWriteRoots({ transcript_path: transcript, agent_id: 'x', agent_type: 'general-purpose' });
            assert.deepStrictEqual(withAgent.roots, okRes.roots, 'agent_id/agent_type must not change the derived root');
            const rcSrc = fs.readFileSync(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'), 'utf8');
            assert.ok(!/agent_id|agent_type/.test(rcSrc), 'receipt must not reference agent_id/agent_type at all');

            // 5. 预期内的路径错误必须【转成 ok:false】而不是抛出；真正的缺陷仍须冒泡。
            rc.__setFsOps({ lstatSync: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } });
            try {
                const r = rc.deriveHostOwnedWriteRoots({ transcript_path: transcript });
                assert.strictEqual(r.ok, false, 'a coded path error must degrade to ok:false, not throw into the guard');
                assert.ok(/EACCES|stat/i.test(r.reason), `reason must stay diagnosable; got ${r.reason}`);
            } finally { rc.__resetFsOps(); }

            rc.__setFsOps({ lstatSync: () => { throw new TypeError('genuine defect: x is not a function'); } });
            try {
                assert.throws(() => rc.deriveHostOwnedWriteRoots({ transcript_path: transcript }), /genuine defect/,
                    'a real programming defect must still bubble — swallowing it would hide the bug');
            } finally { rc.__resetFsOps(); }

            // 5b.【承重】上面那条在【前置 pathEntryInfo】就抛了，根本没走到 resolvePhysical 的 catch。
            //     要证明 derive 不会把原语冒泡上来的缺陷【再吞一次】，必须让 lstat 成功、realpath 抛。
            //     Task 1 用例 7b 只直接调原语，观察不到 derive 的行为，杀不掉这条。
            {
                const defect = new TypeError('realpath programming defect');
                rc.__setFsOps({
                    lstatSync: () => ({ isSymbolicLink: () => false }),
                    realpathSync: () => { throw defect; },
                });
                try {
                    assert.throws(() => rc.deriveHostOwnedWriteRoots({ transcript_path: transcript }),
                        (e) => e === defect,
                        'a programmatic realpath defect must pass through derive unchanged, not degrade to {ok:false}');
                } finally { rc.__resetFsOps(); }
            }

            fs.rmSync(stateRoot, { recursive: true, force: true });
        }
        console.log('✅ T-takeover-host-owned-roots passed');
```

> 用例 5 第二段的 `TypeError` 由 `pathEntryInfo` 直接抛出(它只把 `ENOENT` 转成
> `exists:false`,其余原样抛),再经 derive 的 `typeof e.code !== 'string'` 判别冒泡。
> 而经由 `resolvePhysical` 的那条通路,程序缺陷在**原语内部**就已原样抛出(设计 §6.4,
> Task 1 用例 7b),所以 derive 侧不需要再做第二次判别 —— 边界只放一处,不重复。

- [ ] **Step 2: 跑测试确认失败**

Run: `node templates/cli/test.js governance`
Expected: FAIL,`rc.deriveHostOwnedWriteRoots is not a function`

- [ ] **Step 3: 写实现**

在 `takeover-receipt.js` 中 `resolvePhysical` 之后加入:

```javascript
// ── 宿主自有写入根 ──
// 位于项目【外】、但属于当前宿主 + 当前项目的受信写入根。目前只有一个：该项目的持久记忆目录。
//
// transcript_path 是【宿主输入锚】，不是用户配置项：只能来自当前事件，不得从环境变量、settings、
// receipt 或任何持久化位置读取同名值 —— 否则这条窄例外就退化成一个可配置的项目外写入通道。
//
// 契约：永不返回 null；预期内的锚点不可用一律 {ok:false, roots:[]}，绝不抛进守卫。
// 降级方向只有一个：更严，不更松。任何"锚点不可用时放宽"的分支都是本设计的反面。
const HOST_PATH_CODES = new Set(Object.values(PATH_CODES));

function deriveHostOwnedWriteRoots(hookInput) {
    const fail = (reason) => ({ ok: false, reason, roots: [] });
    if (!hookInput || typeof hookInput !== 'object') return fail('hook input is not an object');
    if (!Object.prototype.hasOwnProperty.call(hookInput, 'transcript_path')) return fail('transcript_path absent');
    const tp = hookInput.transcript_path;
    if (typeof tp !== 'string' || tp.length === 0) return fail('transcript_path is not a non-empty string');
    if (!path.isAbsolute(tp)) return fail('transcript_path is not absolute');
    const stateRoot = path.dirname(tp);
    if (stateRoot === tp) return fail('transcript_path degenerates to a filesystem root');

    // project-state root 本身【必须已存在】。resolvePhysical 会容忍未存在的尾部（那是为
    // memory/ 首次创建准备的），若直接把它用在 stateRoot 上，一个指向不存在目录的
    // transcript_path 会被"回拼"成一个看似合法的 root —— 例外就会挂到一个凭空的路径上。
    let info;
    try {
        info = pathEntryInfo(stateRoot);
    } catch (e) {
        if (!e || typeof e.code !== 'string') throw e;   // 真正的程序缺陷仍须冒泡
        return fail(`cannot stat host project state root (${e.code})`);
    }
    if (!info.exists) return fail('host project state root does not exist');

    let physical;
    try {
        physical = resolvePhysical(stateRoot);
    } catch (e) {
        // 预期内的路径错误 → 不启用例外。程序缺陷不会走到这里 —— 原语已在自身层面把
        // 无 code 的异常原样抛出（设计 §6.4），所以这里只需认已知的 PATH_CODES。
        if (!e || !HOST_PATH_CODES.has(e.code)) throw e;
        return fail(`cannot resolve host project state root (${(e.cause && e.cause.code) || e.code})`);
    }
    // 允许根只能是 memory 这一层。project-state root 是派生的中间量，永不直接参与包含判定 ——
    // 本机 ~/.claude/projects/ 下已存在两个与母仓 slug 构成前缀关系的真实目录。
    return { ok: true, reason: null, roots: [normalize(physical) + '/memory'] };
}
```

并把 `deriveHostOwnedWriteRoots` 加入 `module.exports`。

- [ ] **Step 4: 跑测试确认通过**

Run: `node templates/cli/test.js governance`
Expected: `✅ T-takeover-host-owned-roots passed`

- [ ] **Step 5: 变异体验证**

| 变异 | 必须被杀于 |
|---|---|
| `roots: [normalize(physical) + '/memory']` → `[normalize(physical)]` | 用例 1 |
| 删除 `path.isAbsolute(tp)` 检查 | 用例 2「relative path」 |
| 删除 `if (!info.exists) return fail(...)` | 用例 2「nonexistent state root」 |
| `if (!e \|\| typeof e.code !== 'string') throw e;`(`pathEntryInfo` 侧)→ 恒不抛 | 用例 5 第二段 |
| `if (!e \|\| !HOST_PATH_CODES.has(e.code)) throw e;` → 恒不抛 | **用例 5b**(Task 1 用例 7b 只直接调原语,观察不到 derive,杀不掉) |
| `resolvePhysical(stateRoot)` → `resolvePhysical(path.join(stateRoot,'memory'))` | 用例 1 |

- [ ] **Step 6: 提交**

```bash
git add templates/cli/takeover-receipt.js templates/cli/test/governance.js
git commit -m "feat(takeover): derive the host-owned memory write root from the current event"
```

---

### Task 6: 守卫并列允许根 + 完整回归矩阵

**Files:**
- Modify: `templates/cli/takeover-adapter.js`(target-path 门的比较段)
- Test: `templates/cli/test/governance.js`(新增套件 `T-takeover-memory-root`)

**Interfaces:**
- Consumes: `rc.deriveHostOwnedWriteRoots`(Task 5)、Task 4 的 `probe`
- Produces: 最终的三门守卫行为

- [ ] **Step 1: 写失败测试(设计 §8 回归矩阵逐条)**

```javascript
        console.log('T-takeover-memory-root. narrow out-of-project exception: memory only, prefix-safe, fail-closed ...');
        {
            const ad = require(path.join(TEMPLATE_CLI_DIR, 'takeover-adapter.js'));
            const rc = require(path.join(TEMPLATE_CLI_DIR, 'takeover-receipt.js'));
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-tk-mem-'));
            const ac = path.join(root, '.evo-lite'); fs.mkdirSync(ac, { recursive: true });
            fs.writeFileSync(path.join(ac, 'active_context.md'), '<!-- BEGIN_FOCUS -->\nF\n<!-- END_FOCUS -->\n', 'utf8');
            const canon = rc.canonicalProjectRoot(root), sid = 'mem';
            rc.publishReceipt(root, { schemaVersion: 1, host: 'claude-code', sessionId: sid, projectRoot: canon,
                state: 'committed', focusHash: rc.readFocusAnchor(root).hash, sourceEvent: 'x' });

            // 宿主 project-state 目录：母仓 A 与一个【前缀关系】的兄弟 B。
            // B 不是构造出来的边角：本机 ~/.claude/projects/ 下已真实存在两个这样的目录。
            const projects = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-projects-'));
            const stateA = path.join(projects, 'D--Proj-alpha');
            const stateB = path.join(projects, 'D--Proj-alpha-templates');   // 单破折号，真实案例
            fs.mkdirSync(path.join(stateA, 'memory'), { recursive: true });
            fs.mkdirSync(path.join(stateB, 'memory'), { recursive: true });
            const transcriptA = path.join(stateA, 'sess-a.jsonl'); fs.writeFileSync(transcriptA, '', 'utf8');

            const dec = async (file_path, extra = {}) => (await ad.handleHookInput({
                hook_event_name: 'PreToolUse', session_id: sid, tool_name: 'Write',
                transcript_path: transcriptA, tool_input: { file_path }, ...extra,
            }, { projectRoot: root })).json.hookSpecificOutput.permissionDecision;

            // ── 允许 ──
            assert.strictEqual(await dec(path.join(root, 'in-project.js')), 'allow', 'in-project code file');
            assert.strictEqual(await dec(path.join(stateA, 'memory', 'MEMORY.md')), 'allow', 'the event-derived memory root');
            assert.strictEqual(await dec(path.join(stateA, 'memory', 'topic.md')), 'allow', 'new file, memory/ already exists');

            // 首次写入：memory/ 尚不存在。朴素实现会 deny —— 这正是每个新项目的 rollout 场景。
            const stateC = path.join(projects, 'D--Proj-gamma'); fs.mkdirSync(stateC, { recursive: true });
            const transcriptC = path.join(stateC, 'sess-c.jsonl'); fs.writeFileSync(transcriptC, '', 'utf8');
            assert.strictEqual(await dec(path.join(stateC, 'memory', 'first.md'), { transcript_path: transcriptC }),
                'allow', 'first-ever memory write must allow even though memory/ does not exist yet');

            // ── 拒绝 ──
            assert.strictEqual(await dec(path.join(projects, 'plain.txt')), 'deny', 'ordinary out-of-project file');
            assert.strictEqual(await dec(path.join(stateC, 'memory', 'x.md')), 'deny',
                "an unrelated project's memory (no prefix relation at all)");
            assert.strictEqual(await dec(path.join(stateB, 'memory', 'x.md')), 'deny',
                "another project's memory whose slug is a string prefix-extension of ours");
            assert.strictEqual(await dec(path.join(stateA, 'sess-a.jsonl')), 'deny',
                'non-memory path under our own state root (the transcript itself)');
            assert.strictEqual(await dec(path.join(stateA, 'memoryX', 'x.md')), 'deny',
                "'memoryX' must not match 'memory' — the separator has to participate");
            assert.strictEqual(await dec(path.join(stateA, 'memory', '..', 'escape.md')), 'deny', 'memory/../escape');

            // 锚点缺失 / 畸形 → 不启用例外（fail-closed 单向）
            assert.strictEqual(await dec(path.join(stateA, 'memory', 'x.md'), { transcript_path: undefined }),
                'deny', 'absent transcript_path must not enable the exception');
            assert.strictEqual(await dec(path.join(stateA, 'memory', 'x.md'), { transcript_path: 42 }),
                'deny', 'non-string transcript_path must not enable the exception');
            assert.strictEqual(await dec(path.join(stateA, 'memory', 'x.md'), { transcript_path: 'rel/s.jsonl' }),
                'deny', 'relative transcript_path must not enable the exception');

            // receipt 门与健康门【不放宽】：未接管的会话同样写不了记忆。
            const dec2 = async (file_path) => (await ad.handleHookInput({
                hook_event_name: 'PreToolUse', session_id: 'no-receipt', tool_name: 'Write',
                transcript_path: transcriptA, tool_input: { file_path },
            }, { projectRoot: root })).json.hookSpecificOutput;
            const noReceipt = await dec2(path.join(stateA, 'memory', 'x.md'));
            assert.strictEqual(noReceipt.permissionDecision, 'deny', 'no receipt → memory write still denied');
            assert.ok(/takeover required/.test(noReceipt.permissionDecisionReason),
                'and it must deny via the receipt gate, not via the target-path gate');

            // ── 承重：owned.ok 真的被消费，且派生函数真的被调用 ──
            // 上面那些畸形 transcript_path 用例【杀不掉】删除 owned.ok 的变异体：失败契约返回
            // roots: []，而 [].some(...) 本来就是 false，deny 照样成立。必须注入一个
            // 【ok:false 但 roots 非空】的返回值，才能把这两件事分开证明。
            {
                const injectedRoot = rc.normalize(fs.realpathSync(stateA)) + '/memory';
                const original = rc.deriveHostOwnedWriteRoots;
                let calls = 0;
                rc.deriveHostOwnedWriteRoots = () => {
                    calls += 1;
                    return { ok: false, reason: 'forced-failure', roots: [injectedRoot] };
                };
                try {
                    assert.strictEqual(await dec(path.join(stateA, 'memory', 'x.md')), 'deny',
                        'ok:false must veto the exception even when roots is non-empty');
                    assert.strictEqual(calls, 1, 'the derivation must actually be consumed, exactly once per decision');
                } finally {
                    rc.deriveHostOwnedWriteRoots = original;
                }
                // 复原后同一目标必须重新放行 —— 证明上面的 deny 出自注入，而不是别的门。
                assert.strictEqual(await dec(path.join(stateA, 'memory', 'x.md')), 'allow',
                    'and it must allow again once the injection is removed');
            }

            // memory 内的 symlink 指向项目外 —— 能力探测，不可用则跳过（既有惯例）
            {
                const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-outside-'));
                const link = path.join(stateA, 'memory', 'escape-link');
                let linked = true;
                try { fs.symlinkSync(outside, link, 'dir'); } catch (e) {
                    linked = false;
                    console.log(`   ⏭️ symlink assertion skipped (${e.code || e.message})`);
                }
                if (linked) {
                    assert.strictEqual(await dec(path.join(link, 'x.md')), 'deny',
                        'a symlink inside memory/ pointing outside must still deny');
                }
                fs.rmSync(outside, { recursive: true, force: true });
            }

            // Windows 小写盘符不得扩大权限（两侧同源于 realpathSync.native，天然同大小写）
            if (process.platform === 'win32' && /^[a-zA-Z]:/.test(stateA)) {
                const lower = stateA[0].toLowerCase() + stateA.slice(1);
                assert.strictEqual(await dec(path.join(lower, 'memory', 'x.md')), 'allow',
                    'lowercase drive letter on our own memory root must not be denied');
                assert.strictEqual(await dec(path.join(stateB[0].toLowerCase() + stateB.slice(1), 'memory', 'x.md')),
                    'deny', 'and lowercase must not widen the exception to a prefix-colliding project');
            }

            // Unicode case-fold：JS 的 toLowerCase 把 KELVIN SIGN(U+212A)折成 ASCII 'k'，
            // 比 NTFS 自己的大小写表激进得多。ATTP 已经为这一条付过一次代价（Task 7 一审 I1：
            // 折叠比较让一次写真的落到了项目外）。这里断言的是【不折叠】：两个 slug 在磁盘上
            // 是两个真实目录时，它们的 memory 必须互相 deny。
            {
                const kAscii = path.join(projects, 'D--Proj-Kappa');
                const kKelvin = path.join(projects, 'D--Proj-Kappa');   // U+212A KELVIN SIGN，写成转义以免复制时丢失
                let distinct = true;
                try {
                    fs.mkdirSync(path.join(kAscii, 'memory'), { recursive: true });
                    fs.mkdirSync(path.join(kKelvin, 'memory'), { recursive: true });
                    // 卷若把二者视为同一目录，realpath 会收敛到同一个物理路径 → 这条构造不成立
                    distinct = fs.realpathSync(kAscii) !== fs.realpathSync(kKelvin);
                } catch (e) {
                    distinct = false;
                    console.log(`   ⏭️ Unicode case-fold assertion skipped (${e.code || e.message})`);
                }
                if (distinct) {
                    const tK = path.join(kAscii, 'sess-k.jsonl'); fs.writeFileSync(tK, '', 'utf8');
                    assert.strictEqual(await dec(path.join(kAscii, 'memory', 'x.md'), { transcript_path: tK }),
                        'allow', 'the ASCII-K project may write its own memory');
                    assert.strictEqual(await dec(path.join(kKelvin, 'memory', 'x.md'), { transcript_path: tK }),
                        'deny', 'a U+212A variant is a DIFFERENT directory — folding it in would be a real escape');
                } else {
                    console.log('   ⏭️ Unicode case-fold assertion skipped (volume treats U+212A as ASCII K)');
                }
            }

            fs.rmSync(projects, { recursive: true, force: true });
            fs.rmSync(root, { recursive: true, force: true });
        }
        console.log('✅ T-takeover-memory-root passed');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node templates/cli/test.js governance`
Expected: FAIL,`the event-derived memory root` 断言得到 `deny`

- [ ] **Step 3: 写实现 —— 并列允许根**

把 `takeover-adapter.js` 的最终比较段替换为:

```javascript
    const cp = rc.normalize(probe), cr = rc.normalize(projectRoot);
    if (cp === cr || cp.startsWith(cr + '/')) return ptu('allow');
    // 项目【外】的唯一窄例外：由当前事件的 transcript_path 派生的、本项目的宿主记忆目录。
    // 判定在 memory 这一层做；分隔符必须是字面量 '/'（normalize 已把 '\' 折成 '/'，
    // 用 path.sep 会让 Windows 下所有子文件落空）。锚点不可用时不启用例外，绝不放宽。
    const owned = rc.deriveHostOwnedWriteRoots(input);
    if (owned.ok && owned.roots.some(r => cp === r || cp.startsWith(r + '/'))) return ptu('allow');
    return ptu('deny', `[evo-lite] target '${target}' resolves outside project '${projectRoot}'.`);
```

- [ ] **Step 4: 跑全套**

Run: `node templates/cli/test.js all`
Expected: EXIT 0,含 `✅ T-takeover-memory-root passed`,且**既有 ATTP 套件一条未改**

- [ ] **Step 5: 变异体验证**

| 变异 | 必须被杀于 |
|---|---|
| `cp.startsWith(r + '/')` → `cp.startsWith(r)` | `memoryX` 与前缀兄弟 `stateB` 两条 |
| `owned.ok &&` → 删除(不检查 ok) | **注入 seam 用例**(三条畸形锚点断言杀不掉它 —— 失败契约的 `roots` 本就是 `[]`) |
| 删除整句 `const owned = …; if (…) return ptu('allow');` | 注入 seam 的 `calls === 1`,以及全部 allow 用例 |
| 把例外提到 receipt 门之前 | `no receipt → deny` 的 `takeover required` 文案断言 |
| `r + '/'` → `r + path.sep` | Windows 上所有 memory 子文件断言(POSIX 上不变,须在 win32 复核) |

- [ ] **Step 6: 提交**

```bash
git add templates/cli/takeover-adapter.js templates/cli/test/governance.js
git commit -m "feat(takeover): allow the event-derived host memory root as a narrow out-of-project exception"
```

---

### Task 7: 文档同步与运行时镜像

**Files:**
- Modify: `README.md`、`README_EN.md`
- Modify(生成): `.evo-lite/cli/*`(经 `sync-runtime`,**不手改**)

- [ ] **Step 1: 改 README 的守卫边界表述**

两份 README 的 "Agent Takeover / 确定性接管" 一节中,把「项目外 `Edit`/`Write` 会被 deny」
改成(中文版):

```text
项目外的 `Edit`/`Write` 默认 deny;唯一的窄例外,是由当前 PreToolUse 事件的
`transcript_path` 派生出的、本项目的 Claude Code 记忆目录。该例外只在接管健康时生效,
锚点缺失或畸形时不启用。
```

英文版对应:

```text
Out-of-project `Edit`/`Write` is denied by default. The single narrow exception is this
project's Claude Code memory directory, derived from the current PreToolUse event's
`transcript_path`. The exception applies only while takeover is healthy, and is not
enabled when the anchor is absent or malformed.
```

**两条既有声明必须保留**:`Bash` 可绕过;守卫是治理保证,**不是**隔离边界。

> 注意:README 使用**全角标点**(`;`、`,`)。编辑前先读取确切字节,否则 Edit 匹配会失败。

- [ ] **Step 2: 同步运行时镜像**

```bash
node .evo-lite/cli/memory.js sync-runtime
node .evo-lite/cli/memory.js sync-runtime
```

Expected: 第二次 `copied: 0`

- [ ] **Step 3: 在镜像上跑一次全套**

```bash
node templates/cli/test.js all
node --check .evo-lite/cli/takeover-physical-path.js
```

Expected: EXIT 0;新模块确实出现在镜像中

- [ ] **Step 4: 提交**

```bash
git add README.md README_EN.md .evo-lite/cli/
git commit -m "docs(takeover): document the narrow host-memory write exception; sync runtime mirror"
```

---

### Task 8: 双会话真实记忆终局验收(**只产出证据,不做治理闭环**)

自动化回归证明不了「宿主的持久记忆功能真的恢复了」—— 它只能证明文件系统上出现了一个文件。
本任务是设计 §8.1 冻结的终局门。

**执行者不得同时是实现者与最终验收者。** 本任务在写完证据、跑完收口门后**停止**,
等待独立复审;`spec → done`、`plan → done`、`mem archive`、backlog 关闭、
`[attp-hive-rollout]` 解阻,一律留到复审 ACCEPTED 之后**另行授权**(见 Task 9)。

**Files:**
- Create: `docs/validation/attp-guard-allowlist-acceptance.md`
- **不改** `docs/specs/*` 的 status,**不改** backlog,**不跑** `mem archive`

- [ ] **Step 1: 准备 disposable project-state**

```text
- 在唯一命名的临时路径下建立一个 disposable 的本地项目副本 / worktree
  （这是【母仓实现验收】，不是 child-repo rollout —— 不得借机在子仓安装 ATTP）
- 从其【根】启动，使其对应的宿主 project-state 的 memory/ 初始【不存在】
- 记录三项：项目根、派生出的 state root、memory/ 不存在的证据
```

- [ ] **Step 2: Session A**

```text
1. 从 canonical project root 启动（root-launch-only，不得从子目录）
2. 完成正常 takeover（三事件在位、receipt committed）
3. 用【真实 Edit / Write 工具】写入 —— 不得用 Bash
4. 创建 memory/MEMORY.md 或 memory/<topic>.md
5. 写入一个唯一 marker
6. 记录守卫返回 allow（而不是"守卫没被触发"）
7. 确认文件确实落在【派生出的】memory root 上，而非别处
```

- [ ] **Step 3: Session B**

```text
1. 结束 Session A 后重新启动一个【全新】会话
2. 从同一 canonical project root 启动
3. 证明该唯一 marker 被宿主【正常的跨会话记忆机制】消费
4. 不得靠直接给绝对路径、或用 Bash 读文件来冒充成功
5. 【承重】Session B 在返回 marker 之前，不得对 memory 目录发生任何
   Read / Glob / Grep / Bash —— 一旦发生，证明的就是"我能读到那个文件"，
   而不是"宿主把它当作记忆喂了进来"。工具调用记录须一并留证。
```

- [ ] **Step 4: 补一次 `memory/` 已存在的普通路径写入**

覆盖不经过首次创建分支的常规路径。

- [ ] **Step 5: 写验收记录**

`docs/validation/attp-guard-allowlist-acceptance.md` 须逐条记录三件事的证据:

```text
(1) 首次目录创建不再被误拒
(2) 写入确实是【守卫放行】的结果，而不是守卫压根没参与
(3) 宿主持久记忆功能真正恢复，而不是磁盘上多了一个孤立文件
```

并记录**未观察到**的项(与阶段二验收记录同一体例),不得把自动化覆盖冒充实景证据。

- [ ] **Step 6: 收口门**

```bash
node --check templates/cli/takeover-physical-path.js
node .evo-lite/cli/memory.js sync-runtime      # 连续两次 copied: 0
node templates/cli/test.js all                 # EXIT 0
node .evo-lite/cli/memory.js takeover status   # 三事件在位
node .evo-lite/cli/memory.js verify
```

- [ ] **Step 7: 精确清理测试宿主状态**

```text
- 删除临时项目目录（完整精确路径）
- 删除它对应的宿主 project-state 目录（完整精确路径）
- 【禁止通配符】—— slug 由完整路径派生，D--…-evo-lite* 这类模式会命中 worktree 与
  单破折号兄弟目录（本机已有两个真实实例，见设计 §5）
- 删除前逐条确认：目标不是母仓 project-state root
- 删除后逐条确认：母仓 project-state 与母仓 memory 仍然存在、文件数不变
- 不创建可复用的清理脚本
```

- [ ] **Step 8: 提交证据并停止**

```bash
git add docs/validation/attp-guard-allowlist-acceptance.md
git commit -m "docs(validation): two-session acceptance for the host-owned memory write root"
```

**停在这里,等待独立复审。** 不改 spec status、不改 plan status、不跑 `mem archive`、
不动 backlog、不解阻 `[attp-hive-rollout]`。

---

### Task 9: 治理闭环(**复审 ACCEPTED 后另行授权,不得随 Task 8 一并执行**)

**Files:**
- Modify: `docs/specs/attp-host-owned-write-roots.md`(`status: done`)、本计划(`status: done` + 勾选)
- Modify(治理产物): `.evo-lite/active_context.md`、`.evo-lite/raw_memory/`、`.evo-lite/generated/`

- [ ] **Step 1: 归档任务证据**

`mem archive` 记录各任务证据。evidence 必须带**完整** task id
`task:attp-host-owned-write-roots-tN` —— 裸 `tN` 会**静默**失败(R008 会因此清不掉)。

- [ ] **Step 2: 状态收口**

spec `status: done`;plan `status: done` 并勾选全部步骤;确认 R006 / R008 / R011 归零。

- [ ] **Step 3: 关闭 backlog 并解阻**

关闭 `[attp-guard-allowlist]`,移除 `[attp-hive-rollout]` 的阻塞标记。
**子仓分发本身仍不在授权范围内,须单独授权。**

- [ ] **Step 4: 提交(范围必须含治理产物)**

```bash
git add docs/ .evo-lite/active_context.md .evo-lite/raw_memory/ .evo-lite/generated/
git commit -m "chore(governance): close attp-host-owned-write-roots; unblock attp-hive-rollout"
```

`git add docs/` **不够** —— `mem archive` 与 backlog 关闭写的是 `.evo-lite/` 下的
运行时状态与档案,只提交 `docs/` 会让盘上状态与仓库记录脱节。

---

## 停止点(两处,均为硬停)

```text
① 本计划完成后 → 停在计划复审，不得直接开始编码
② Task 8 完成后 → 停在验收复审，Task 9 需另行授权
```

②是承重的:执行者不得同时是实现者与最终验收者。Task 8 只产出证据,
`spec → done` / `plan → done` / `mem archive` / backlog 关闭 / `[attp-hive-rollout]` 解阻
全部在 Task 9,须复审 ACCEPTED 后另行授权。

## 尚未授权

```text
Task 1 implementation               NOT YET AUTHORIZED
Task 2 tests                        NOT YET AUTHORIZED
Task 3 installer refactor           NOT AUTHORIZED
Production implementation / tests   NOT AUTHORIZED
Task 9 governance closure           NOT AUTHORIZED
Child-repo distribution             NOT AUTHORIZED
Hive nurture                        BLOCKED / NOT AUTHORIZED
ATTP MVP                            REMAINS CLOSED（本计划不重开）
```
