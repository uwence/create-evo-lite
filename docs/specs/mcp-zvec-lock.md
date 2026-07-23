---
id: spec:mcp-zvec-lock
title: "Spec: MCP zvec lock coordination (a177)"
status: adopted
linkedPlan: plan:mcp-zvec-lock-mvp
---

# Spec: MCP zvec 锁生命周期与单写者协调([a177])

- 谱系:backlog `[a177] mcp-zvec-lock`(2026-07-23 4b-1 收口事故:8 个跨会话僵尸
  `memory.js mcp` 持有 `.evo-lite/zvec/collection/LOCK`,阻断 `mem commit`/`context track`)。
- **契约正文(canonical):**`docs/superpowers/specs/2026-07-23-mcp-zvec-lock-design.md`
  (设计 R2 外部复阅 APPROVED,2026-07-23)。本文件是治理挂接层,不复制契约细节;
  两者分歧时以设计文档为准。
- 实施计划:`plan:mcp-zvec-lock-mvp`(`docs/superpowers/plans/2026-07-23-mcp-zvec-lock.md`)。
- 关联独立议题:`[zvec-06-upgrade]`(0.6 升级与 readOnly 拆分,**不在本 spec 范围**)。

## 一句话定位

三层最小组合让 zvec 写锁的租期 = 单次操作、MCP 进程随宿主死亡自行退出、
残留冲突可诊断且孤儿持有者可安全自愈 —— 恢复治理写链路的可用性。

## Acceptance Criteria

与设计 §5 测试契约一一对应:

- owner sidecar:schema v1 十字段 identity-critical 强制验证;`readOwner.state !== 'valid'` 只能 report-only。
- CAS 唯一删除入口:finalize / 自愈 / 死持有者清理均经 `clearOwner(dir, leaseId)`,晚到的 clear 绝不删新持有者。
- ephemeral 五行矩阵:success/throw/nested-success/nested-throw 后锁释放且第二实例可立即打开;默认模式行为不变。
- refusal matrix 11 例全部拒杀:open 失败带诊断 / 目标进程存活 / owner 与 LOCK 未被删改。
- live-foreign 富化错误:含 holder pid、verdict、明示不自动终止、argv 形式枚举命令;holder 与其 owner 不受影响。
- 孤儿自愈(原事故最小复刻):detached 孙子 holder → 四道闸全过 → 阶梯终止 → open 成功、stale owner 清除。
- 非锁错误零干预:原样 rethrow,不 backoff、不诊断、不产 owner。
- MCP stdin EOF:exit code 0 + owner 已清 + 新 writer 立即 initialize 成功。
- 回归:`memory-index-lock.js` 入 template-manifest;`node templates/cli/test.js all` 与镜像侧 all EXIT 0;`mem sync-runtime` 二次运行 copied: 0。
- 终局门:一次性存量僵尸清点后,真实 `mem commit` 走通;hive nurture CodePLC + hungersnakegame4 套件绿。

收口条件:上述测试全绿 + 双侧 all 套件全绿 + 镜像 double-run-zero + 母仓实景
`mem commit` 不再撞锁 + 两个子仓 nurture 完成。

## Phases

- Phase L(唯一):L1 owner sidecar → L2 进程快照/身份 → L3 诊断+拒杀矩阵 →
  L4 协调打开+自愈 → L5 ephemeral 租期 → L6 MCP 生命周期 → L7 manifest/镜像/回归闭环。
