---
id: spec:agent-takeover-trigger-protocol
status: done
created: 2026-07-26
title: "Spec: Agent Takeover Trigger Protocol (ATTP)"
linkedPlan: plan:agent-takeover-trigger-protocol
relationMode: independent
---

# Spec: Agent Takeover Trigger Protocol([agent-code-routing])

- 谱系:backlog `[agent-code-routing]`(4a.x P2 final —— 实测证伪「agent 在裸 prompt 下会自发
  发现治理层」这一假设,即使竞争界面为零也不发现,S9b CodePLC 复现)。
- **契约正文(canonical):**`docs/superpowers/specs/2026-07-24-agent-takeover-trigger-protocol-design.md`
  (设计 R5 外部复阅 APPROVED;R8 含 §0.1 退出码勘误、§0.2 root-launch-only 勘误、
  §0.3 守卫定位勘误)。本文件是治理挂接层,不复制契约细节;两者分歧时以设计文档为准。
- 实施计划:`plan:agent-takeover-trigger-protocol`
  (`docs/superpowers/plans/2026-07-24-agent-takeover-trigger-protocol.md`)。
- 能力探测:`docs/validation/attp-cc-capability-probe.md`(Claude Code 2.1.218)。
- 阶段一 dogfood:`docs/validation/attp-phase1-dogfood.md`(2.1.218 / 2.1.220)。
- 阶段二故障注入验收:`docs/validation/attp-phase2-fault-injection.md`(2.1.220)。
- 后续独立议题:`[attp-hive-rollout]`(子仓分发,**不在本 spec 范围**)。

## 一句话定位

把项目接管从「等 agent 自己去读」改成**宿主生命周期驱动** —— Claude Code 每次开会话、
每轮提示词都执行一条 hook 主动注入治理状态,并在没有有效接管上下文时对 `Edit`/`Write`
fail-closed,从而让「agent 先接管再动代码」成为确定性行为而非期望。

## Acceptance Criteria

与设计 §5 测试契约、以及两道外部复审门一一对应:

- 纯函数 builder + 两个 discriminated validator:session 与 capsule 分开校验;capsule 恒 ≤ 1 KiB;
  emergency capsule 独立于正常 builder、恒合法且恒在预算内,恢复命令只整条带上或整条省略。
- receipt 层:严格根发现(找不到即抛,无 fail-open 兜底)、project-bound 路径、session-scoped、
  ordered publication;判定与副作用分离(守卫用只读变体,权限检查绝不改治理状态)。
- 单一 collector:三条入口(`mem bootstrap` / SessionStart hook / CLI recovery)统一经
  `collectSessionTakeoverContextFull` → `buildTakeoverPayload` → `validateSessionPayload` → 各自 transport;
  可恢复失败入 `degraded[]`,不可恢复抛错。
- **宿主退出码契约**:凡已成功序列化 envelope 的返回一律 `exit 0`(宿主只在 exit 0 解析 JSON,
  非零会把 degraded capsule 与恢复说明一并丢弃);失败由 `failure` + `systemMessage` + stderr 表达。
- installer:事务化 capability-gate,受管身份按**精确同一**判定并下沉到 hook 条目级(第三方 hook 与
  受管 hook 同组时不得被误删);`hooks` 容器与受管事件值类型 fail-loud;备份/回滚/discard 三件套
  按 sha256 字节级校验,受管对象锁死为唯一文件 `<canonicalProjectRoot>/.claude/settings.json`。
- PreToolUse 守卫:完整 health gate + target-path 绑定;任何异常一律 deny
  (PreToolUse 缺 `permissionDecision` 等于放行,异常泄到 `main` 即 fail-open);
  路径归一化用文件系统真实大小写,不做字符串 case-fold。
- 阶段二验收套件八条用例(1–7 故障/状态注入,8 端到端恢复)全绿,且每个注入 seam 的消费
  都有能杀死「seam 未被调用」变异体的承重断言。
- 回归:`node templates/cli/test.js all` EXIT 0;`mem sync-runtime` 二次运行 `copied: 0`。

### 范围限制(承重,不得在文档中弱化)

- **root-launch-only**:仅当 Claude Code 从 canonical project root 启动时接管才生效。
  子目录启动既不接管也无守卫,且**无 workaround** —— 项目 settings 按启动 cwd 定位不向上查找,
  `$CLAUDE_PROJECT_DIR` 亦展开为启动 cwd。该限制同样约束守卫的 no-silent-bypass 保证。
- **守卫是治理保证,不是隔离边界**:MVP 只守 `Edit`/`Write`,`Bash` 及其他工具放行,
  一条 shell 重定向即可绕开。它防的是「未读治理状态就改代码」,不防有意规避。

收口条件:两道外部复审门(Gate 1 阶段一 / Gate 2 阶段二)均 PASSED + 双侧套件全绿 +
镜像 double-run-zero + 阶段二备份按授权 discard。

**收口记录(2026-07-26):**Tasks 1–8 实施于 `5985dff..16ee1cd`(Subagent-Driven Development,
逐任务独立复审)。**Gate 1**(Tasks 1–6)经三轮复审 APPROVED —— 收窄为 root-launch-only
(原「子目录仍生效」验收项实测证伪并撤销)、受管身份改精确同一并下沉到条目级、
`hooks` 形状 fail-loud。**Gate 2**(Tasks 7–8)经四轮复审 APPROVED —— 守卫 case-fold
越界(U+212A KELVIN SIGN 可写出项目外)改为 `realpathSync.native` 真实大小写比较并加永久回归;
故障注入用例 4/7 的伪 deny(空指针经内层 catch 兜成 deny)补文案断言;注入消费加 seam 计数,
消除「删掉触发步骤后断言仍全过」的空转。Step 5 `backup-discard` 已执行,阶段二备份与 manifest
均已清理,`.claude/settings.json` 字节未被触碰,三事件仍在位。

**Rollout 注意:**(1) 本 MVP 只保证 installer 幂等可用,子仓需在 nurture 侧自行调用
`mem takeover install`,该分发是独立议题 `[attp-hive-rollout]`;(2) 装上守卫后项目外
`Edit`/`Write` 会被 deny,agent 的临时文件必须落在项目内;(3) 母仓 `settings.json` 中没有
第三方 hook,因此「第三方 hook 共存」只有自动化回归证据,无实景观察。
