---
id: spec:attp-host-owned-write-roots
status: adopted
created: 2026-07-26
title: "Spec: ATTP host-owned write roots (attp-guard-allowlist)"
relations: [{"kind":"spawned-from","target":"spec:agent-takeover-trigger-protocol"}]
---

# Spec: ATTP 宿主自有写入根(`[attp-guard-allowlist]`)

- 谱系:backlog `[db8a] [attp-guard-allowlist]` —— 2026-07-26 ATTP 闭环后 dogfood 实撞:
  守卫拒绝了 agent 自身的持久记忆写入。
- **契约正文(canonical):**`docs/superpowers/specs/2026-07-26-attp-host-owned-write-roots-design.md`。
  本文件是治理挂接层,不复制契约细节;两者分歧时以设计文档为准。
- 运行时锚点证据:`docs/validation/attp-guard-allowlist-step0-transcript-path.md`
  (Step 0,Claude Code 2.1.220,8 次真实 PreToolUse 捕获)。
- 上游:`spec:agent-takeover-trigger-protocol`(ATTP MVP,已 CLOSED)。本议题**不重开**它。
- 阻塞关系:本 spec 是 `[attp-hive-rollout]` 的**前置**。未收口前不得向子仓分发 ATTP。
- 授权状态:设计阶段 AUTHORIZED;**实施、生产测试、installer 改动、hive nurture 均 NOT AUTHORIZED**。

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
  未存在尾部」,而非祖先本身 —— 否则每个新项目的首次记忆写入都会被拒。
  该改动对既有项目判定必须 verdict-preserving,证据是既有 `T-takeover-*` 全套原样通过。
- fail-closed 单向:锚点缺失/畸形/不可解析、宿主版本变化导致字段消失,一律**不启用例外**,
  绝不退回宽白名单;`Bash` 边界维持原设计,不得据此宣称守卫成为安全隔离。
- 回归矩阵(设计 §8)全绿,含:其他项目 memory deny、前缀关系项目 memory deny、
  `<slug>` 下非 memory deny、`memory/../escape` deny、memory 内 symlink 指向外部 deny、
  Windows 大小写与 Unicode case-fold 变体不得扩大权限。
- 终局证据:在**真实 Claude Code 会话**中完成一次跨会话 memory 写入,不能只喂 adapter JSON。

### 实施前置(不得跳过)

**Step 0b —— 子 agent 的 `transcript_path` 观测。** Step 0 只覆盖主会话。若子 agent
携带的是位于不同 project-state 目录的 transcript,其记忆写入仍会被拒,而
subagent-driven-development 是本项目的主力工作流。该不确定性**不得靠推理消解**。

收口条件:上述回归全绿 + 既有 ATTP 套件零改动通过 + 真实会话跨会话记忆写入成功,
且 `[attp-hive-rollout]` 的阻塞随之解除。
