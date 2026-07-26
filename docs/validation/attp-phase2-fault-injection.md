# ATTP 阶段二故障注入验收记录

- 日期:2026-07-26
- 宿主:Claude Code 2.1.220
- 仓库:`create-evo-lite`(母仓),分支 `main`
- 安装事件:`SessionStart` + `UserPromptSubmit` + **`PreToolUse`**(本轮新增)
- 命令入口:`node .evo-lite/cli/memory.js takeover …`(运行时镜像;`templates/cli/memory.js`
  无法作为入口运行 —— `better-sqlite3` 仅在 `.evo-lite/node_modules/` 可解析)
- 前置:阶段一见 [`attp-phase1-dogfood.md`](attp-phase1-dogfood.md),Gate 1 已通过并外部验收

## 结论速览

| 验收项 | 结果 |
|---|---|
| 八条阶段二验收用例全部通过(1–7 故障/状态注入,8 端到端恢复) | **达成**(`✅ T-takeover-fault-suite passed`) |
| 注入被真实消费这件事**锁进了回归**,不只是当下成立 | **达成**(Gate 2 复审 P1-1 修订后),详见 §2 |
| `PreToolUse` 装入真实仓库 | **达成**,三事件在位 |
| 安装前备份逐字节可回滚 | **达成**,sha256 与安装前一致 |
| 全套件在守卫在位时回归 | **达成**,`test.js all` EXIT 0 |
| 实景守卫三门行为正确 | **达成**,详见 §3 |
| 第三方 hook 共存保护 | **未在实景观察到** —— 本仓 `settings.json` 只有受管 hook,该行为由自动化回归覆盖,见 §4 |

---

## §1 安装

安装前 `.claude/settings.json`(阶段一两事件配置):

```text
sha256: b6a1c98ef83d851e49dc544d9906479f2a352fed0d4834ecc28f1d2b22c384cd
```

```bash
node .evo-lite/cli/memory.js takeover install --backup \
  --events SessionStart,UserPromptSubmit,PreToolUse \
  --settings .claude/settings.json
```

```text
🗄️  settings backed up: …\.claude\settings.json.attp-backup-42444-9b02d6122730
✅ takeover hooks installed (SessionStart, UserPromptSubmit, PreToolUse)
ℹ️  scope: takeover only engages when Claude Code is launched from D:/Data/ProjectAgent/create-evo-lite
   launching from a subdirectory loads no project hooks — there is no supported workaround.
```

manifest:

```json
{
  "kind": "attp-settings-backup",
  "schemaVersion": 1,
  "settingsPath": "…\\.claude\\settings.json",
  "existed": true,
  "backupPath": "…\\.claude\\settings.json.attp-backup-42444-9b02d6122730",
  "sha256": "b6a1c98ef83d851e49dc544d9906479f2a352fed0d4834ecc28f1d2b22c384cd"
}
```

备份文件实测 sha256 与安装前**完全一致**,且 `existed: true` —— 回滚目标是「阶段一已批准的两事件配置」,不是 ATTP 安装前的空配置。这一点是刻意的:Gate 1 已经验收了两事件安装,Gate 2 若不通过,应退回到那个状态。

`takeover status`:

```text
installed: SessionStart, UserPromptSubmit, PreToolUse | missing: (none)
scope: root-launch-only — engages only when Claude Code starts in D:/Data/ProjectAgent/create-evo-lite
```

---

## §2 八条阶段二验收用例

全部位于 `templates/cli/test/governance.js` 的 `T-takeover-fault-suite`,注入 seam 为
`takeover-receipt.js` 的 `__setFsOps` / transport 的 `write` / `deps.collect`。

用例 1–7 是故障/状态注入,**用例 8 不注入任何故障** —— 它是端到端恢复验收,
放在同一块里是因为它消费的正是前面几条造成的锁定状态。

| # | 注入的失败 | 承重断言 |
|---|---|---|
| 1 | receipt 发布时 `renameSync` 抛错 | 非零退出,且盘上**没有** committed receipt |
| 2 | collector 返回残缺 payload | 校验拦截 → exit 0(宿主只在 exit 0 解析 JSON)+ 不发布 + `failure` 标记 + `systemMessage` |
| 3 | collector 抛错 | exit 0 + 不发布 + `systemMessage` + degraded 上下文里带**可执行**的恢复命令(含 `--session-id`) |
| 4 | 失效持久化双失败(tombstone 与 unlink 均抛) | 守卫仍 deny,**且 deny 出自健康门**(见下) |
| 5 | `source=resume` / `clear` 且 receipt 缺失 | 走 establishment,不因 source 跳过 |
| 6 | CLI stdout 写出失败 | 不发布 receipt |
| 7 | 同会话 refresh 失败 | 旧 receipt **不**自动撤销;健康正常时 Write 仍 allow;删 `active_context` 后转 deny |
| 8 | 不注入(端到端恢复) | 子进程真实执行恢复命令后,Write 解锁 |

### 用例 4:计划原文的断言杀不掉变异体(本轮修正)

计划里用例 4 只断言 `decision === 'deny'`。把健康门整个删掉(`if (false)`)后它**依然通过**:

```text
基线    deny  ← [evo-lite] takeover unhealthy (active-context-unreadable). …
变异体  deny  ← [evo-lite] takeover payload build failed (Cannot read properties of null (reading 'text'))
```

`active_context` 被删后 `focus` 为 `null`,capsule 构建空指针,被**内层** catch 兜成一个伪 deny。
只看决策分不出真假。这与首轮 Task 7 复审在 `T-takeover-session-scope` 关掉的是同一种失效。

同时,该用例的 `writeFileSync`/`unlinkSync` 注入原本是**惰性**的:守卫走 `reconcileReadOnly`
(Task 7 复审 I2 的结论),自身根本不写盘,所谓「双失败」从未被触达。

修正后:先在同一注入下走 `UserPromptSubmit → reconcile`(这才是真正持久化失效的路径),再问守卫。
注入承重性实测:

```text
不注入:  committed → invalid   （失效确实落盘）
有注入:  committed → committed （双失败真实发生,失效无法记录）
```

并补两条文案断言 —— deny 必须措辞为 `unhealthy`,且**不得**是 `payload build failed`。
独立归因验证:`if (false)` 变异体现在由用例 4 自己杀掉,不再依赖相邻测试。

### 用例 4 续:注入被消费这件事当时仍未锁进回归(Gate 2 复审 P1-1)

上面那版**当下**成立,但没有把「双失败真的发生过」变成永久约束。删掉 `UserPromptSubmit` 调用后:

```text
基线              tombstone=1 unlink=1   四条断言全过
删 UserPromptSubmit tombstone=0 unlink=0   四条断言【仍然全过】
```

两个 seam 一次都没被调用,而守卫本来就会因 `active_context` 缺失而 deny —— 于是用例只证明了
「receipt 仍 committed + active_context 不可读 → deny」,与注入无关。上一轮验收记录把
「注入均为真实 seam」写成已达成,**超出了当时的证据**,该表述已在本轮更正。

修正:给两个 seam 加调用计数,并在 `UserPromptSubmit` 之后立即断言两者都被尝试过。
四条变异逐条独立归因(生产模块变异后均已复原):

| 变异 | 被杀于 |
|---|---|
| 删除 `UserPromptSubmit` 调用 | `tombstoneAttempts > 0` 与 `unlinkAttempts > 0` |
| 删除 `invalidateReceipt` 的 tombstone → unlink 回退 | `unlinkAttempts > 0` |
| 让 tombstone 注入不抛错 | `receipt 仍 committed`(另触发 `unlinkAttempts`、`unhealthy` 两条) |
| 删除 health gate | `unhealthy` 与 `非 payload build failed` |

三个承重点由此彼此独立:双失败确实发生、旧 committed receipt 确实残留、health gate 独立 fail-closed。

---

## §3 实景守卫探测

按宿主实际调用方式直接喂 `PreToolUse` 事件(`CLAUDE_PROJECT_DIR` 置为项目根):

| 场景 | 结果 |
|---|---|
| 伪造 session(无 receipt)+ 项目内目标 | `deny` — *takeover required before writing* |
| 本会话真实 session + 项目内目标 | `allow` |
| 本会话真实 session + 项目外目标 | `deny` — *resolves outside project* |

三条均 `exit 0`,stdout 只有 JSON。第一条与第三条走的是两道**不同**的门,文案互不撞词。

---

## §4 未观察到的项:第三方 hook 共存

计划 Step 3 期望「第三方 hooks 保留」。本仓 `.claude/settings.json` 里只有受管 hook,
因此这一条**无法在实景中观察**。它由自动化回归覆盖(`T-takeover-installer`:名称碰撞的第三方
hook 保留且组数为 2、同组第三方存活且受管 hook 恰一份),不在本文档中冒充实景证据。

---

## §5 门

```text
node --check                         clean
sync-runtime                         copied: 0 / unchanged: 119（连续两次）
node templates/cli/test.js all       EXIT 0（215 项通过,PreToolUse 在位）
takeover status                      installed: SessionStart, UserPromptSubmit, PreToolUse
```

---

## §6 尚未执行(等 Gate 2）

阶段二的备份**保留在盘上**,`backup-discard` 与 `rollback` 均未执行 —— 按计划 Step 5,
两者都要等复审门 2 出裁定后才动:

```bash
# Gate 2 通过 → 丢弃阶段二备份
node .evo-lite/cli/memory.js takeover backup-discard
# Gate 2 未通过 → 回滚到阶段一已批准的两事件配置
node .evo-lite/cli/memory.js takeover rollback
```
