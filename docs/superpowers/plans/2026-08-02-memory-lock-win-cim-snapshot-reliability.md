---
id: plan:memory-lock-win-cim-snapshot-reliability
title: "Plan: Windows CIM snapshot reliability — Phase 3A"
format: superpowers
status: draft
---

# Windows CIM Snapshot Reliability — Phase 3A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ⛔ **本计划未获实施授权。** 执行任何 Task 之前必须获得单独的实施授权。

设计冻结:`docs/superpowers/specs/2026-08-02-memory-lock-win-cim-snapshot-reliability-design.md`(ACCEPTED)
证据:`docs/validation/memory-lock-win-cim-snapshot-reliability.md`
Backlog:`[0020] [memory-lock-win-cim-snapshot-reliability]`

## Goal

把**确定性的进程身份合同**与**不确定的 Windows 外部查询可用性**分离,使一次
runner 长尾事件不再表现为确定性代码失败。

Phase 3A **不消除**外部长尾 —— 本仓无法消除它。3A 只让它被正确分类、正确
上报,并停止阻断 release gate 的确定性语义。

## Architecture

```text
                       ┌─ snapshotFn (整体接管，既有 seam)
getProcessSnapshotResult ─┼─ pidAliveFn  → dead
                       └─ runSnapshotCommand(execFileSyncFn) → 归一结果 → 九步分类
                                                                     ↓
                                          { state, snapshot } | { state:'unavailable', reason, detail }
                                                                     ↓
getProcessSnapshot (兼容 wrapper)  alive/dead → 旧 snapshot；unavailable → null
                                                                     ↓
                          diagnoseLockConflict / attemptSelfHeal  → unknown / report-only
```

分类是**纯函数**:所有九种结果都能经 seam 确定性制造,不依赖真实 PowerShell。

## Tech Stack

```text
Node.js CommonJS，无新依赖
child_process.execFileSync（既有）
node:assert + 仓内 governance 测试框架（既有）
sync-runtime 镜像（templates/cli → .evo-lite/cli）
```

## Global Constraints

```text
A1 only              retry count = 0；单次预算 10 000 ms 不变；不改任何超时数值
安全语义不变          unavailable → unknown / report-only → 绝不终止进程
owner 语义不变        sidecar / CAS / 四道闸 / backoff 阶梯逐字不动
isExpectedMcpProcess  判定条件不放宽
非 win32              行为不变
导出面                getProcessSnapshot 保持可用且行为不变
```

**禁止出现**:

```text
生产 retry          timeout 数值变更      pwsh 切换
Windows skip        删除 null/alive 断言   把所有 unavailable 降级为通过
自动 diagnostic workflow                  verify unavailable counter
```

## 冻结的实施文件图

允许修改:

```text
.evo-lite/cli/memory-index-lock.js        + templates/cli/memory-index-lock.js
.evo-lite/cli/test/governance.js          + templates/cli/test/governance.js
scripts/diagnostics/memory-lock-cim-snapshot.js
docs/validation/memory-lock-win-cim-snapshot-reliability.md
```

禁止带入(出现任一立即硬停):

```text
.github/workflows/memory-lock-cim-diagnostic.yml   ← D5：永不进 main
.github/workflows/release-gate.yml
package.json
.evo-lite/active_context.md
.evo-lite/raw_memory/**
docs/specs/zvec-win-unicode-containment.md
docs/plans/zvec-win-unicode-containment.md
docs/superpowers/plans/2026-07-31-zvec-win-unicode-containment.md
任何其他生产 CLI 文件
```

### PR #11 资产的提取方式(路径级,禁止整提交 cherry-pick)

PR #11 的提交里含**不允许进 main 的 workflow**,因此:

```bash
git checkout f640755 -- scripts/diagnostics/memory-lock-cim-snapshot.js
```

`governance.js` 的失败现场 instrumentation **只移植对应 hunk**,不整文件覆盖。
提取后立即确认:

```bash
git status --short | grep -c "\.github/" 
# 必须为 0
```

PR #11 在提取完成前保持 Draft、冻结、不合并、不关闭。

---

## E1 — `detail` 接口与数据保护

固定键集,非自由对象:

```text
platform  elapsedMs  timeoutMs  status  signal
errorCode  errorMessage  stdoutBytes  stderrBytes  partialStdout
```

`alive` / `dead` **不携带** `detail`。

### partialStdout:先清洗、后截断

顺序不可颠倒 —— 先截断再清洗会把一个秘密切成两半,让两侧都逃过匹配。

```text
1  sanitize(raw)      确定性清洗
2  truncate(cleaned)  首尾各 ≤400 bytes，中间省略
3  sanitize 抛错      → 不保留原文，输出 `<redacted:N bytes>`（N = 原始字节数）
```

sanitizer 必须清洗至少:

```text
KEY=value / TOKEN=value / SECRET=value / PASSWORD=value（大小写不敏感）
--token <v> / --key <v> / --password <v> / --secret <v>
Authorization: <v>
形如 ghp_ / gho_ / sk- 开头的连续非空白串
```

清洗结果统一替换为 `<redacted>`。

**禁止**:完整环境变量转储、未截断流、堆栈(`errorMessage` 只取 `message`)。

同一 sanitizer 必须同时作用于 `detail.partialStdout` 与
`CIM_SNAPSHOT_DIAG` 的 `stdoutSample` / `stderrSample`。

## E2 — seam 形态(已按真实 execFileSync 合同修正)

**实测确认的原生合同**:

```text
成功         → 返回 stdout 字符串
失败/超时/非零 → throw，错误对象带 status / signal / stdout / stderr
              code 仅在 ENOENT、ETIMEDOUT 等情形存在；非零退出时 code 为 undefined
```

因此 seam **与原生合同一致**,归一化由独立函数完成:

```js
// seam：与原生 execFileSync 合同完全一致（成功返回 stdout，失败抛错）
seams.execFileSyncFn ?? require('child_process').execFileSync

// 归一化器：唯一的 try/catch 所在，输出统一形状
function runSnapshotCommand(exe, args, options, execFn) {
    const t0 = process.hrtime.bigint();
    try {
        const stdout = execFn(exe, args, options);
        return { status: 0, signal: null, stdout: String(stdout ?? ''), stderr: '', error: null,
                 elapsedMs: ms(t0) };
    } catch (err) {
        return {
            status: err.status ?? null,
            signal: err.signal ?? null,
            stdout: String(err.stdout ?? ''),
            stderr: String(err.stderr ?? ''),
            error: err,
            elapsedMs: ms(t0),
        };
    }
}
```

分类器**只消费** `runSnapshotCommand()` 的统一结果,绝不直接调用 execFn。

### `timeout` 的唯一判据(冻结)

```text
err.code === 'ETIMEDOUT'                → timeout
signal === 'SIGTERM' 但没有 ETIMEDOUT    → nonzero-exit
```

**`SIGTERM` 单独不能证明 timeout。** 外部终止、以及子进程自身因信号退出,
同样表现为 `SIGTERM`。而 D4 里 `timeout` 是**唯一**能不打红 gate 的 reason ——
把 `SIGTERM` 并进去等于悄悄扩大那条豁免,让"有人杀了这个进程"和"查询超时"
共享同一张免死金牌。

`signal`、`elapsedMs` 与部分输出仍照常记入 `detail`,但**不得据此推断
timeout**。若将来发现某个受支持 Node 版本的真实 timeout 不提供 `ETIMEDOUT`,
那需要**新证据 + 单独的设计修订**;Phase 3A 不做启发式推断。

### seam 优先级(冻结)

```text
snapshotFn      整体接管（既有语义，最高优先级）
pidAliveFn      进程存活判定
execFileSyncFn  外部命令执行
真实实现        三者皆无时
```

### 九种结果的确定性制造

```text
dead          pidAliveFn → false
timeout       execFileSyncFn throw，err.code === 'ETIMEDOUT'  ← 唯一判据
spawn-error   execFileSyncFn throw，err.code = 'ENOENT'
nonzero-exit  execFileSyncFn throw，err.status = 1，无 code
              也包括 signal === 'SIGTERM' 但无 ETIMEDOUT 的情形
empty-output  execFileSyncFn 返回 ''
parse-error   execFileSyncFn 返回 '<not json>'
no-row        execFileSyncFn 返回 'null' 或 '[]'
invalid-row   execFileSyncFn 返回合法 JSON 但身份字段非法
alive         execFileSyncFn 返回合法完整行
```

### 旧 `snapshotFn` 到新结果的适配(冻结)

现有 seam 可返回旧 snapshot、`null` 或抛错,必须有确定映射:

```text
返回 { state, ... }                → 直接消费该结构化结果
返回 legacy snapshot，alive === true  → { state:'alive', snapshot }
返回 legacy snapshot，alive === false → { state:'dead',  snapshot }
返回 null 或抛错                    → { state:'unavailable', reason:'invalid-row',
                                       detail:{ ...E1 的十个键，一个不多 } }
```

**不得增加 `source` 字段。** E1 把 `detail` 冻结为固定键集,这条适配规则的早期
写法自己破坏了它 —— 一个"只多一个键"的例外会立刻让固定键集变成建议。来源
信息写进已有的 `errorMessage`:

```text
snapshotFn 返回 null   → detail.errorMessage = 'legacy snapshotFn returned null'
snapshotFn 抛错        → detail.errorMessage = 'legacy snapshotFn threw: <sanitized message>'
```

**`timeout` 等真实分类必须经低层 executor seam 产生**,不得由 `snapshotFn`
猜测 —— 旧 seam 没有携带任何区分这些情形的信息,猜测就是编造。

## E3 — 真实 Windows probe 的两块拆分

同一测试内两个独立断言块,互不代偿:

```text
availability block
  alive                  → 验证真实字段形状（isNode / commandLine 非空 /
                           startedAt 可解析 / ppid 整数）
  unavailable / timeout  → 输出 CIM_SNAPSHOT_DIAG；【不】使该块失败
  其他任何 reason         → 失败（含 invalid-row）

deterministic safety block   —— 恒执行，seam 注入，不依赖真实 runner
  对每一种 unavailable reason：
    diagnoseLockConflict → unknown / report-only
    attemptSelfHeal（传入已构造的 orphaned-own-mcp diag）
      → healed === false
      → killFn 调用次数 = 0
      → owner 文件仍存在
```

**为什么 `attemptSelfHeal` 必须单独测**:只测 `diagnoseLockConflict` 只能证明
**正常协调流**不会进入自愈,不能证明这个**已导出**的函数被直接调用时仍
fail-closed。它是 `module.exports` 的一部分。

**一处会让该断言变空的陷阱**:`attemptSelfHeal` 第一句就是
`if (process.platform !== 'win32') return { healed:false, ... }`。在 Linux 上
断言会因**平台闸**而不是因**身份复核**通过 —— 结果对、理由错、覆盖为零。

处理方式是**两类平台各自独立断言**,而不是想办法让一台机器覆盖两条路径:

```text
Windows job    真正进入身份复核分支，验证 healed:false / kill 0 次 / owner 未删
非 Windows job 只验证平台闸拒绝自愈，【不得】声称覆盖了身份复核分支
```

release-gate 同时含 Windows 与 Ubuntu,两条路径都会被真实执行。
**禁止修改或伪造 `process.platform`** —— 那只会制造一条在真实平台上从未跑过
的绿色断言。

另外,`attemptSelfHeal` 会**重新取快照**(`getProcessSnapshot(owner.pid,
ctx.seams)`),所以测试必须注入快照 seam;只注入 `killFn` 会让它落到真实
PowerShell,九种 reason 一种也造不出来。

---

## 证据文档不得形成 CI 递归

```text
git 内证据文档   记录实现合同、确定性测试与本地验证结果
                 【不写】当前 PR 的动态 CI run number
PR 正文          记录本 PR 的 release-gate run
合入后 checkpoint 记录最终 main gate
```

理由:把"实施后首次 release-gate 结果"写回文档会新增提交、触发新 run,而新
结果又不属于最终 head —— 追写永远落后一拍。一次收口,不循环。

---

### Task 1: 归一化器与结果分类器

**Files:**
- Modify: `.evo-lite/cli/memory-index-lock.js`
- Sync: `templates/cli/memory-index-lock.js`
- Test: `.evo-lite/cli/test/governance.js`
- Sync: `templates/cli/test/governance.js`

**Interfaces:**

```text
Consumes:  seams.execFileSyncFn（原生合同）、seams.pidAliveFn
Produces:  runSnapshotCommand(exe,args,options,execFn) → 归一结果
           getProcessSnapshotResult(pid, seams) → { state, snapshot } |
                                                  { state:'unavailable', reason, detail }
```

- [ ] Step 1 — 写失败测试 `T-snap-classify`,经 `execFileSyncFn` 注入九种情形,
      断言 `state` 与 `reason` 与 D2 九步优先级一致;先只写测试,不写实现
- [ ] Step 2 — `node .evo-lite/cli/test.js`
      Expected: `getProcessSnapshotResult is not a function`
- [ ] Step 3 — 实现 `runSnapshotCommand`(唯一 try/catch)与
      `getProcessSnapshotResult`;分类严格按 D2 短路;超时即使有部分 stdout 仍
      为 `timeout`,部分输出只进 `detail`
- [ ] Step 4 — `node .evo-lite/cli/test.js`  Expected: `✅ T-snap-classify passed`
- [ ] Step 5 — `node .evo-lite/cli/memory.js sync-runtime`
- [ ] Step 6 — `npm test`(EXIT 0)+ `node .evo-lite/cli/memory.js sync-runtime --check`
- [ ] Step 7 — `git add .evo-lite/cli/memory-index-lock.js templates/cli/memory-index-lock.js .evo-lite/cli/test/governance.js templates/cli/test/governance.js && git commit`

### Task 2: detail 的 sanitizer 与截断

**Files:**
- Modify: `.evo-lite/cli/memory-index-lock.js`
- Sync: `templates/cli/memory-index-lock.js`
- Test: `.evo-lite/cli/test/governance.js`
- Sync: `templates/cli/test/governance.js`

**Interfaces:**

```text
Consumes:  归一结果的 stdout / stderr
Produces:  detail（E1 固定键集），partialStdout = truncate(sanitize(raw))
```

- [ ] Step 1 — 写失败测试 `T-snap-detail`:注入含哨兵
      `OPENAI_API_KEY=secret-sentinel` 与 `--token secret-sentinel` 的 stdout,
      断言 `detail.partialStdout` **不含** `secret-sentinel`;断言键集恰为 E1
      十项;断言 `alive`/`dead` 无 `detail`
- [ ] Step 2 — `node .evo-lite/cli/test.js`  Expected: 哨兵出现在 partialStdout,断言失败
- [ ] Step 3 — 实现 sanitizer(先清洗后截断;抛错则输出 `<redacted:N bytes>`)
      并接入 detail 构造
- [ ] Step 4 — `node .evo-lite/cli/test.js`  Expected: `✅ T-snap-detail passed`
- [ ] Step 5 — `node .evo-lite/cli/memory.js sync-runtime`
- [ ] Step 6 — `npm test` + `sync-runtime --check`
- [ ] Step 7 — `git add` 四个文件 `&& git commit`

### Task 3: 兼容 wrapper 与调用点迁移

**Files:**
- Modify: `.evo-lite/cli/memory-index-lock.js`
- Sync: `templates/cli/memory-index-lock.js`
- Test: `.evo-lite/cli/test/governance.js`
- Sync: `templates/cli/test/governance.js`

**Interfaces:**

```text
Consumes:  getProcessSnapshotResult
Produces:  getProcessSnapshot（行为不变的兼容 wrapper）
           diagnoseLockConflict / attemptSelfHeal 内部改用结构化结果
```

- [ ] Step 1 — 写失败测试 `T-snap-compat`:断言 `getProcessSnapshot` 对
      alive/dead 返回旧 snapshot、对每种 unavailable 返回 `null`;断言既有
      `assert.strictEqual(lock.getProcessSnapshot(1, { snapshotFn: () => { throw ... } }), null)`
      仍通过;断言 `snapshotFn` 四条适配规则
- [ ] Step 2 — `node .evo-lite/cli/test.js`  Expected: 适配规则相关断言失败
- [ ] Step 3 — 实现 wrapper 与适配;`:248` 与 `:387` 改用
      `getProcessSnapshotResult()`;两处 `unknown`/report-only 分支语义**逐字
      不变**,只把 `reason` 加进诊断报告文本
- [ ] Step 4 — `node .evo-lite/cli/test.js`  Expected: `✅ T-snap-compat passed`
- [ ] Step 5 — `node .evo-lite/cli/memory.js sync-runtime`
- [ ] Step 6 — `npm test` + `sync-runtime --check`;确认 `T-lock-ident`、
      `T-lock-owner`、a177 并发矩阵仍绿
- [ ] Step 7 — `git add` 四个文件 `&& git commit`

### Task 4: 确定性安全测试(含直接自愈入口)

**Files:**
- Test: `.evo-lite/cli/test/governance.js`
- Sync: `templates/cli/test/governance.js`

**Interfaces:**

```text
Consumes:  seams（execFileSyncFn / pidAliveFn / killFn / writeOwnerFn）
Produces:  T-snap-failclosed —— 每种 unavailable reason × 两个入口
```

- [ ] Step 1 — 写失败测试 `T-snap-failclosed`:对**每一种** unavailable reason
      断言 `diagnoseLockConflict → unknown/report-only`;并**分别**断言直接调用
      `attemptSelfHeal` 时仍 fail-closed。**必须注入快照 seam**,否则
      `attemptSelfHeal` 内部的重新取快照会落到真实 PowerShell,九种 reason 一种
      也造不出来:

      ```js
      attemptSelfHeal(dir, orphanedDiag, {
          seams: {
              snapshotFn: () => ({ state: 'unavailable', reason, detail: makeDetail() }),
              killFn,
          },
      })
      ```

      断言 `healed === false` / `killFn.calls === 0` / owner 文件仍存在
- [ ] Step 2 — `node .evo-lite/cli/test.js`  Expected: 直接自愈入口的断言失败或缺失
- [ ] Step 3 — 补齐实现侧缺口(若有);本 Task 以测试为主,不放宽任何生产行为
- [ ] Step 4 — `node .evo-lite/cli/test.js`  Expected: `✅ T-snap-failclosed passed`
- [ ] Step 5 — **两类平台各自独立断言**,不得互相冒充覆盖:

      ```text
      Windows job    必须真正进入身份复核分支；对每种 unavailable reason 验证
                     healed:false / kill 0 次 / owner 未删
      非 Windows job 独立验证平台闸拒绝自愈；【不得】声称覆盖了 Windows 的
                     身份复核分支
      ```

      release-gate 同时含 Windows 与 Ubuntu,两类合同都会被真实执行。
      **禁止修改或伪造 `process.platform` 来绕过这一区分。**
- [ ] Step 6 — `npm test` + `sync-runtime --check`
- [ ] Step 7 — `git add` 两个文件 `&& git commit`

### Task 5: 真实 probe 拆分与诊断资产提取

**Files:**
- Test: `.evo-lite/cli/test/governance.js`
- Sync: `templates/cli/test/governance.js`
- Add: `scripts/diagnostics/memory-lock-cim-snapshot.js`
- Modify: `docs/validation/memory-lock-win-cim-snapshot-reliability.md`

**Interfaces:**

```text
Consumes:  真实 getProcessSnapshotResult(process.pid)
Produces:  T-lock-ident 拆分为 availability block + deterministic safety block
```

- [ ] Step 1 — `git checkout f640755 -- scripts/diagnostics/memory-lock-cim-snapshot.js`;
      `git status --short | grep -c "\.github/"` **必须为 0**
- [ ] Step 2 — 写失败测试:`T-lock-ident` 的 availability block 对
      `unavailable/timeout` 通过、对其他 reason 失败;先注入非 timeout reason
      验证该块**确实会红**(否则宽容是空的)
- [ ] Step 3 — 实现拆分;timeout 分支输出 `CIM_SNAPSHOT_DIAG`(经同一 sanitizer)
- [ ] Step 4 — `node .evo-lite/cli/test.js`  Expected: 两块均 PASS
- [ ] Step 5 — `node .evo-lite/cli/memory.js sync-runtime`;更新证据文档
      (只写实现合同与本地验证,**不写**本 PR 的 CI run number)
- [ ] Step 6 — `npm test` + `sync-runtime --check`;逐对确认 live/template SHA 相同;
      确认禁改集 `git diff main..HEAD` 为空
- [ ] Step 7 — `git add` 上述文件 `&& git commit`

---

## 验收合同

```text
npm test                 EXIT 0
sync-runtime --check     in-sync
live/template SHA        逐对相同
禁改集 diff               空
release-gate             first-attempt 5/5 SUCCESS
```

**只有一种可接受结果:首跑 5/5。** 不存在"可接受的 4/5"。

若真实 timeout 在实施后发生,Windows job 应当:

```text
输出 CIM_SNAPSHOT_DIAG
availability block          PASS（对 timeout 宽容）
deterministic safety block  PASS
整个 job                    SUCCESS
```

因此**任何 `T-lock-ident` 造成的 4/5 都是 Phase 3A 实施失败**,旧 residual
豁免不再适用。这条判定方向必须写死:3A 的成功标志不是缺陷消失(外部长尾
依旧存在),而是同一个长尾事件**不再表现为确定性代码失败**。

## 不在本计划范围

```text
Phase 3B    timeout-only 有界重试（需单独证据与冻结的总预算）
Task 6–8    zvec containment 的 marker/recovery、verify、release enforcement
PR #11      在诊断资产提取完成前保持 Draft、冻结、不合并、不关闭
```
