---
id: spec:attp-host-owned-write-roots
status: done
created: 2026-07-26
linkedPlan: plan:attp-host-owned-write-roots
title: "Spec: ATTP host-owned write roots (attp-guard-allowlist)"
relations: [{"kind":"spawned-from","target":"spec:agent-takeover-trigger-protocol"}]
---

# Spec: ATTP 宿主自有写入根(`[attp-guard-allowlist]`)

- 谱系:backlog `[db8a] [attp-guard-allowlist]` —— 2026-07-26 ATTP 闭环后 dogfood 实撞:
  守卫拒绝了 agent 自身的持久记忆写入。
- **契约正文(canonical):**`docs/superpowers/specs/2026-07-26-attp-host-owned-write-roots-design.md`。
  本文件是治理挂接层,不复制契约细节;两者分歧时以设计文档为准。
- 运行时锚点证据:
  - `docs/validation/attp-guard-allowlist-step0-transcript-path.md`(Step 0,主会话,8 次真实捕获)
  - `docs/validation/attp-guard-allowlist-step0b-subagent-correlation.md`(Step 0b,真实 subagent
    关联观测,判定**分支 A**:子 agent 携带父会话的 `transcript_path`,单锚设计成立)
- 上游:`spec:agent-takeover-trigger-protocol`(ATTP MVP,已 CLOSED)。本议题**不重开**它。
- 阻塞关系:本 spec 是 `[attp-hive-rollout]` 的**前置**,但**不是充分条件** —— 本 spec 收口后
  rollout 仍保持 BLOCKED(见下「支持拓扑」)。任何时候都不得在未解阻前向子仓分发 ATTP。
- 授权状态(**当前**,2026-07-27):

  ```text
  Tasks 1–7                  ACCEPTED
  Task 8                     COMPLETE / ACCEPTED within 设计 §2.1 SUPPORTED topology
  Topology-scope amendment   APPROVED / FROZEN
  Task 9                     COMPLETE —— 本 spec status: done，plan 9/9
  current issue              CLOSED within the supported topology only
  new production changes     NOT AUTHORIZED
  child distribution         NOT AUTHORIZED
  hive rollout               REMAINS BLOCKED（本次收口未解除）
  ```

## 一句话定位

让 ATTP 守卫在不削弱项目外 containment 的前提下,识别一类**位于项目外、
但属于当前宿主与当前项目的受信写入根** —— 目前只有一个:该项目的持久记忆目录。

## Acceptance Criteria

与设计 §4–§8 一一对应:

- 派生只来自**当前事件**的 `transcript_path`,不从环境变量/settings/receipt 读取同名值;
  `deriveHostOwnedWriteRoots(hookInput)` 返回 `{ok, reason, roots}`,失败时 `roots` 为空且不启用例外。
- 允许根**只能**是 `dirname(transcript_path)/memory`,不得放宽到 project-state root 整体,
  更不得是 `~/.claude/projects/**`;不实现也不依赖 `<slug>` 编码。
- 包含判定在 **memory 目录这一层**做,形式为
  `target === allowedMemoryRoot || target 位于 allowedMemoryRoot + 分隔符之下`;
  **禁止对 project-state slug 做裸字符串前缀匹配**(本机已存在两个与母仓 slug 构成
  前缀关系的真实目录,裸前缀会误纳)。
- 守卫的 receipt 门与健康门**不放宽**,例外只作用于 target-path 门。
- 未存在的 `memory/` 必须能被安全判定:比较对象是「已物理验证的祖先前缀 + 回拼的
  未存在尾部」,而非祖先本身 —— 否则新项目的首次记忆写入会被拒。
  该改动对既有项目判定必须 verdict-preserving,证据是既有 `T-takeover-*` 全套原样通过。
  **Step 0c 实景修正**:当前宿主在 SessionStart 自行创建空 `memory/`,所以实景走的是
  「目录已存在、目标文件不存在」的单级尾部;多级尾部再拼只有自动化证据,仍作为防御性下界保留。
- fail-closed 单向:锚点缺失/畸形/不可解析、宿主版本变化导致字段消失,一律**不启用例外**,
  绝不退回宽白名单;`Bash` 边界维持原设计,不得据此宣称守卫成为安全隔离。
- 回归矩阵(设计 §8)全绿,含:其他项目 memory deny、前缀关系项目 memory deny、
  `<slug>` 下非 memory deny、`memory/../escape` deny、memory 内 symlink 指向外部 deny、
  Windows 大小写与 Unicode case-fold 变体不得扩大权限。
- 路径原语共用(设计 §6.1–§6.3):新增 dependency-neutral 的
  `takeover-physical-path.js`,导出 `resolvePhysicalPath(target, fsOps)`;installer 与 receipt
  共用同一实现,installer **不** import receipt;installer 既有错误文案不漂移(须补文案断言,
  当前无回归覆盖),`T-takeover-installer` 全套原样通过,镜像 `copied: 0`。
- 终局证据(设计 §8.1):**双会话**真实记忆验收 —— Session A 使用一个**目标文件初始不存在**的
  disposable **单工作树** project(设计 §2.1 的 SUPPORTED 拓扑;**不得用 linked worktree**),
  用真实 `Edit`/`Write`(非 Bash)写入唯一 marker 且守卫 allow;
  Session B 全新会话中该 marker 被宿主**正常的跨会话记忆机制**消费(不得靠给绝对路径或
  Bash 读文件冒充)。另需一次 `memory/` 已存在的普通路径写入。
  宿主可能在 SessionStart 自行创建 `memory/`,因此实景证明的是**首次 agent memory 文件写入**;
  `memory/` 整体不存在时的多级尾部再拼**只由自动化回归证明**。
- README 同步(设计 §10-3):`README.md` 与 `README_EN.md` 中「项目外 Edit/Write 一律 deny」
  须改为「默认 deny + 一条由当前事件 `transcript_path` 派生的窄例外」,并保留
  `Bash` 可绕过、守卫非隔离边界两条声明。

### 实施前置

**Step 0b —— 子 agent 关联观测:已完成,判定分支 A。** 观测捕获了
父/子 `session_id` 与 `transcript_path`、子 agent 的 `tool_name` 与 `tool_input.file_path`、
派生的 `allowedMemoryRoot` 以及**实际记忆写入目标**,并由宿主直接给出的
`agent_id` / `agent_type` 区分父子。结论:子 agent 携带**父会话的** `transcript_path`,
其记忆目标严格落在派生根之下 —— 当前事件单锚设计成立,无需第二个 allowed root,
且 `agent_id` / `agent_type` 不得进入派生逻辑。

### 支持拓扑(Step 0c 后冻结,承重)

```text
单工作树仓库 / 独立项目副本        SUPPORTED —— 双会话实景验收成立
git linked worktree                UNSUPPORTED（Claude Code 2.1.220）—— 必须 fail-closed
```

宿主在 linked worktree 中对 transcript 与 memory 使用**不同**的项目身份,且该映射
在路径大小写维度上不稳定;判定条件不在 hook 可见输入里,Git identity 也补不上
(路径→slug 编码未文档化、有损、Windows 上非单射)。证据:
`docs/validation/attp-guard-allowlist-step0c-worktree-memory-identity.md`。

该缺口**不在本 spec 内解决**,转由 residual spec 记录:

```text
spec:attp-linked-worktree-memory-identity
  status: parked
  parkedUntil: blocked-upstream / waiting-host-contract
```

(registry 只对 `done` / `parked` 做显式状态分支,其余无 linked plan 的未知状态会落入
`adopted` —— 写字面量 `blocked` 会把 residual 错误归类为已采纳议题。)

收口条件:上述回归全绿 + 既有 ATTP 套件零改动通过 + **SUPPORTED 拓扑内**的双会话
真实记忆验收通过 + 支持拓扑限制已落文档 + residual spec 已建立。

**`[attp-hive-rollout]` 的阻塞不随本 spec 收口自动解除。** 它需要下列之一:
目标子仓全部被证明是独立单工作树仓库;或 rollout 增加 topology preflight
(检测到 linked worktree 即拒绝启用该例外并输出明确诊断);或宿主提供新的权威 memory identity。
