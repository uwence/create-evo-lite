---
id: plan:memory-lock-win-cim-snapshot-reliability
title: "Plan: Windows CIM snapshot reliability — Phase 3A"
format: superpowers
status: draft
---

# Windows CIM Snapshot Reliability — Phase 3A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ⛔ **本计划未获实施授权。** 它只冻结实施文件图、验收合同与 E1–E3 的接口
> 决定。执行任何 Task 之前必须获得单独的实施授权。

设计冻结:`docs/superpowers/specs/2026-08-02-memory-lock-win-cim-snapshot-reliability-design.md`
(状态:设计冻结 — ACCEPTED)
证据:`docs/validation/memory-lock-win-cim-snapshot-reliability.md`
Backlog:`[0020] [memory-lock-win-cim-snapshot-reliability]`

## 本计划只做 A1

```text
采纳    A1  合同拆分 + CI 语义分离
不做    A2  timeout-only 有界重试（Phase 3B，需单独授权与总预算）
不做    B   增大 timeout
不做    C   更换 transport
```

Phase 3A 的 **retry count = 0**,单次尝试预算 **10 000 ms 不变**,生产墙钟
语义不变。本计划不改变任何超时数值。

## 冻结的实施文件图

**允许修改**:

```text
.evo-lite/cli/memory-index-lock.js
templates/cli/memory-index-lock.js
.evo-lite/cli/test/governance.js
templates/cli/test/governance.js
scripts/diagnostics/memory-lock-cim-snapshot.js
docs/validation/memory-lock-win-cim-snapshot-reliability.md
```

**禁止带入**(出现任何一项立即硬停并报告):

```text
.github/workflows/memory-lock-cim-diagnostic.yml   ← D5：不进 main
.github/workflows/release-gate.yml
package.json
.evo-lite/active_context.md
.evo-lite/raw_memory/**
docs/specs/zvec-win-unicode-containment.md
docs/plans/zvec-win-unicode-containment.md
docs/superpowers/plans/2026-07-31-zvec-win-unicode-containment.md
任何其他生产 CLI 文件
```

`scripts/diagnostics/memory-lock-cim-snapshot.js` 与 `test/governance.js` 里的
失败现场 instrumentation 从 **PR #11 提取**(cherry-pick 或重写皆可),但
**不得**连带 workflow。PR #11 在提取完成前保持 Draft、冻结、不合并、不关闭。

## 计划内禁止出现

```text
生产 retry
timeout 数值变更
pwsh 切换
Windows skip
把 null / alive 断言简单删除
把所有 unavailable 一律降级为通过
自动 diagnostic workflow
verify unavailable counter
```

---

## E1 — `detail` 的确切接口

`{ state: 'unavailable', reason, detail }` 中 `detail` 冻结为**固定键集**,
不是自由对象:

```text
platform        process.platform
elapsedMs       实测墙钟毫秒
timeoutMs       本次使用的预算（3A 恒为 10000）
status          子进程退出码 | null
signal          终止信号 | null
errorCode       error.code | null
errorMessage    error.message | null（不含堆栈）
stdoutBytes     字节数
stderrBytes     字节数
partialStdout   截断样本，见下
```

`partialStdout` 的截断规则冻结为:**首尾各至多 400 字节**,中间省略。理由:
超时时的部分输出是判断"查询已开始应答"的唯一线索,但完整 stdout 可能很大
且可能含命令行(即含路径与参数)。

**禁止**:

```text
完整 process.env 或任何环境变量转储
未截断的 stdout / stderr
token、凭据路径或任何 secret
堆栈（errorMessage 只取 message）
```

`alive` / `dead` 分支**不携带** `detail` —— 它只用于解释"为什么没有可用答案"。

## E2 — seam 形态

保留现有 `seams.snapshotFn`(整体替换,现有测试依赖它),**新增更低一层**:

```text
seams.execFileSyncFn(exe, args, options) → { status, signal, stdout, stderr, error }
```

分类器必须**完全**建立在这一层之上,使九种结果都能确定性制造:

```text
timeout        error.code = 'ETIMEDOUT' 或 signal = 'SIGTERM'
spawn-error    error.code = 'ENOENT'
nonzero-exit   status = 1
empty-output   status = 0, stdout = ''
parse-error    status = 0, stdout = '<not json>'
no-row         status = 0, stdout = 'null' / '[]'
invalid-row    status = 0, stdout = 合法 JSON 但字段非法
alive          status = 0, stdout = 合法完整行
dead           pidAlive 注入 false（不经 exec 层）
```

**不得依赖真实 PowerShell 来测试分类器。** 分类是纯函数,真实 runner 只用于
验证真实数据形状(见 E3)。

两个 seam 的优先级冻结为:`snapshotFn` 存在时整体接管(与今日行为一致);
否则走 `execFileSyncFn`;两者都无则用真实 `execFileSync`。

## E3 — 真实 Windows probe 的两块拆分

同一个测试内**两个独立断言块**,互不代偿:

```text
availability block
  真实结果 = alive
    → 验证真实字段形状：isNode / commandLine 非空 / startedAt 可解析 / ppid 整数
  真实结果 = unavailable / timeout
    → 输出结构化证据（CIM_SNAPSHOT_DIAG 格式）
    → 不使该块失败
  真实结果 = 其他任何 reason（含 invalid-row）
    → 该块失败

deterministic safety block   —— 无论真实结果如何，恒执行
  对每一种 unavailable reason（seam 注入，不依赖真实 runner）：
    → diagnoseLockConflict 返回 unknown / report-only
    → kill 调用次数 = 0
    → owner 未被删除
  任何违反 → 失败
```

关键点:**availability block 的宽容不得渗透进 safety block**。前者只对
"外部这次没回答"宽容;后者永远确定性,永远稳定阻断 release gate。

---

## Task 1: 结果分类器与 detail 接口

**Files:**
- Modify: `.evo-lite/cli/memory-index-lock.js`
- Sync: `templates/cli/memory-index-lock.js`
- Test: `.evo-lite/cli/test/governance.js`
- Sync: `templates/cli/test/governance.js`

- [ ] 新增 `getProcessSnapshotResult(pid, seams)`,按设计 D2 的九步优先级短路分类
- [ ] `detail` 按 E1 固定键集,`partialStdout` 首尾各 ≤400 字节
- [ ] `invalid-row` 判定覆盖 ProcessId 缺失/不匹配、Name 类型非法、CommandLine
      非字符串、StartedAt 不可解析、ParentProcessId 类型非法
- [ ] 超时即使已捕获部分 stdout 仍分类为 `timeout`,部分输出只进 `detail`
- [ ] 新增 `seams.execFileSyncFn`,分类器完全建立其上

## Task 2: 兼容 wrapper 与调用点迁移

**Files:**
- Modify: `.evo-lite/cli/memory-index-lock.js`
- Sync: `templates/cli/memory-index-lock.js`
- Test: `.evo-lite/cli/test/governance.js`
- Sync: `templates/cli/test/governance.js`

- [ ] `getProcessSnapshot(pid, seams)` 保留导出,行为不变:`alive`/`dead` 返回旧
      snapshot 对象,`unavailable` 返回 `null`
- [ ] `diagnoseLockConflict`(`:248`)与 `attemptSelfHeal`(`:387`)改用
      `getProcessSnapshotResult()` 以获得 `reason`
- [ ] 两处的 `unknown` / report-only 分支语义**逐字不变**;只增加 reason 进入
      诊断报告文本
- [ ] 现有 `assert.strictEqual(lock.getProcessSnapshot(1, {...}), null)` 保持通过

## Task 3: 确定性合同测试

**Files:**
- Test: `.evo-lite/cli/test/governance.js`
- Sync: `templates/cli/test/governance.js`

- [ ] 经 `execFileSyncFn` 注入,覆盖九种结果各一例(E2 表)
- [ ] 对**每一种** `unavailable`:`diagnoseLockConflict → unknown/report-only`、
      kill 调用次数 = 0、owner 未被删除
- [ ] `invalid-row` 的五种字段畸形各一例,断言**不得**呈现为 `alive`
- [ ] 空行/空输出断言**不得**呈现为 `dead`
- [ ] 这些用例必须稳定阻断 release gate(不依赖真实 runner)

## Task 4: 真实 Windows probe 拆分

**Files:**
- Test: `.evo-lite/cli/test/governance.js`
- Sync: `templates/cli/test/governance.js`
- Modify: `scripts/diagnostics/memory-lock-cim-snapshot.js`

- [ ] `T-lock-ident` 按 E3 拆成 availability block 与 deterministic safety block
- [ ] availability block 只对 `unavailable / timeout` 宽容,其余 reason 一律失败
- [ ] timeout 分支输出 `CIM_SNAPSHOT_DIAG` 结构化证据
- [ ] 从 PR #11 提取诊断脚本;**不得**带入 workflow
- [ ] 非 win32 行为不变

## Task 5: 证据与镜像收口

**Files:**
- Modify: `docs/validation/memory-lock-win-cim-snapshot-reliability.md`
- Test: `.evo-lite/cli/test/governance.js`
- Sync: `templates/cli/test/governance.js`

- [ ] 记录 Phase 3A 实施后的首次 release-gate 结果(含 timeout 是否仍出现、
      是否已不再打红)
- [ ] `sync-runtime --check` 通过;live/template 逐对 SHA 相同
- [ ] 确认禁改集 diff 为空

---

## 验收合同

```text
npm test                      EXIT 0
sync-runtime --check          in-sync
live/template SHA             三对文件逐一相同
禁改集 diff                    空
release-gate                  首跑 5/5，或唯一失败为 windows T-lock-ident
                              availability block 的 timeout 分支（此时该块不应
                              再打红 —— 若仍打红说明拆分未生效，属实施缺陷）
```

**注意最后一条的判定方向**:Phase 3A 成功的标志**不是**"缺陷消失"——外部
长尾依旧存在。标志是:**同一个长尾事件不再表现为确定性代码失败**。若
`T-lock-ident` 仍因 timeout 打红,说明 E3 的拆分没有生效,是实施缺陷而不是
环境问题。

## 不在本计划范围

```text
Phase 3B    timeout-only 有界重试（需单独证据与总预算）
Task 6–8    zvec containment 的 marker/recovery、verify、release enforcement
PR #11      在诊断资产提取完成前保持 Draft、冻结、不合并、不关闭
```
