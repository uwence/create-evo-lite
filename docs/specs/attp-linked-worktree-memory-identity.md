---
id: spec:attp-linked-worktree-memory-identity
status: parked
created: 2026-07-27
title: "Spec: ATTP linked-worktree memory identity (residual, blocked upstream)"
relations: [{"kind":"spawned-from","target":"spec:attp-host-owned-write-roots"}]
parkedUntil: "blocked-upstream / waiting-host-contract — Claude Code 尚未提供权威且稳定的 project memory identity;宿主版本变化前不得进入设计,不得做 slug 逆向或路径探测实验"
---

# Spec: ATTP linked-worktree 记忆身份(residual)

- 治理状态:**blocked-upstream / waiting-host-contract**
  (registry 里记为 `parked` —— 本仓 spec portfolio 只识别
  `draft / adopted / parked / shipped`,`parked` + `parkedUntil` 是本仓表达该语义的既有习惯)
- 谱系:`spawned-from spec:attp-host-owned-write-roots`
- 证据:[`attp-guard-allowlist-step0c-worktree-memory-identity.md`](../validation/attp-guard-allowlist-step0c-worktree-memory-identity.md)
- 关联议题:`[attp-hive-rollout]`(**保持 BLOCKED**,解阻条件见下)

## 一句话定位

记录一个**当前宿主契约下无法安全实现**的缺口:在 git linked worktree 中启动的会话,
其宿主持久记忆根不可由 hook 可见输入或 Git identity 安全派生,因此 ATTP 守卫的窄例外
在该拓扑下不成立,必须 fail-closed。

本 spec **不是**待办实现项。它是把「当前可以安全实现的部分」与「需要宿主新增权威契约的
部分」分开记账,避免 `[attp-guard-allowlist]` 被当成一个看似仍可编码解决的普通开放任务。

## 缺口事实(已观测,不需重复验证)

```text
linked worktree 中
  transcript / cwd / CLAUDE_PROJECT_DIR   → 当前 worktree 的身份
  宿主实际使用的 memory root              → 主工作树的身份
  两者不同源
```

且该重定向**不稳定**:同一物理目录以小写路径拼写启动时重定向消失,宿主改用 cwd 自身派生的
记忆根;而 git 在同一情形下仍返回规范大小写。判定条件不在 hook 可见输入里。

`PreToolUse` 完整键集(Step 0c 实测)不含任何 memory root 字段:

```text
cwd, effort, hook_event_name, permission_mode, prompt_id,
session_id, tool_input, tool_name, tool_use_id, transcript_path
+ agent_id, agent_type（仅 subagent 发起的调用）
```

## 已正式排除的路线(不得重新提出)

```text
重实现 Claude slug 编码            未文档化、有损（非 ASCII 塌缩）、Windows 上非单射
扫描 ~/.claude/projects/**         按相似名择一 = 猜测
目标路径自证                       target 指向某个 memory 目录不构成信任
~/.claude.json 注册表推断          用户可编辑、无 memory/slug 字段、同项目多种非规范拼写
git common-dir → 猜 memory slug    大小写用例中会【同时】扩权与失效
settings / receipt 配置额外根      等于把窄例外变成可配置通道
```

`agent_id` / `agent_type` 不进入派生逻辑,不构成第二个 allowed root,也不构成 worktree 绕过
(Step 0b 边界继续有效)。

## 重新开启条件(满足任一即可进入设计)

```text
1. PreToolUse 直接提供权威 memory_root
2. 宿主提供稳定、文档化、无碰撞的 project-memory identity
3. 宿主提供可验证的 main-worktree identity → memory-root API
4. 宿主统一 transcript 与 memory 的项目身份语义
```

宿主版本变化前,**不再继续做 slug 逆向或路径探测实验**。

## 对 `[attp-hive-rollout]` 的影响

`[attp-hive-rollout]` **保持 BLOCKED**,只能在 rollout 设计满足下列之一后解阻:

```text
A. 所有目标子仓都被证明是独立单工作树仓库
B. rollout 增加 topology preflight —— 检测到 linked worktree 时拒绝启用该 memory 例外，
   并输出明确诊断
C. Claude Code 提供新的权威 memory identity
```

**「多数子仓可能不是 worktree」不构成解阻证据。**

## 当前行为(无需改动)

守卫在该拓扑下已经是 fail-closed:target 与当前事件派生根一致才放行,不一致必须拒绝,
不为可用性猜第二个根。代价是 linked worktree 中宿主持久记忆不可用 —— 这是**已记录的限制**,
不是静默失败。**本 spec 不要求任何生产改动。**
