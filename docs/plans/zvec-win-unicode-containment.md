---
id: plan:zvec-win-unicode-containment
status: draft
linkedSpec: spec:zvec-win-unicode-containment
created: 2026-07-31
---

# Zvec Windows Unicode Containment — IR Plan

> ⛔ **实施尚未授权。** 本文件只让该议题在 Spec Portfolio 中可见为 `active`，
> 不构成实施启动。
>
> **治理时序**：adopt Spec → 文档闭环 → **单独授权实施** → Task 1–8 → Task 9 收口。
> adopt 发生在实施**之前**，不在 Task 9（spec §13）。

**Canonical 详细计划**：`docs/superpowers/plans/2026-07-31-zvec-win-unicode-containment.md`
**契约文档（canonical Spec）**：`docs/specs/zvec-win-unicode-containment.md`
**运行时证据**：`docs/validation/zvec-win-unicode-path-matrix.md`
**可复现 fixture**：`docs/validation/fixtures/zvec-win-unicode/`（默认拒绝执行）

本文件是**轻量 IR plan**，只做索引与阶段概览。任务步骤的唯一真相源是上面的 canonical
详细计划 —— 刻意不在此复制，避免形成两个会漂移的实施真相源。

## 问题一句话

Windows 上部分非 ASCII collection 路径在 `insertSync` 触发 `0xC0000409`
原生 fail-fast，进程被 OS 终止，`try/catch` 拿不到，进程内无法降级。
0.5.0 与 0.6.0 行为相同，非升级引入。阻断**下一次正式发布**与
**Windows 非 ASCII 子仓 rollout**。

## Phase 概览

| Phase | 范围 |
|---|---|
| **Phase 1** 判定层与单一决策 | Task 1–4：characterization、lexical classifier、supported-profile evaluator、单一 `resolveEngineDecision()` |
| **Phase 2** 入口收口与恢复 | Task 5–7：native 入口收口（含 `memory-ab`）、降级恢复状态机、`verify` 诊断 |
| **Phase 3** 发布门与闭环 | Task 8–9：`releaseBlocking` 派生 + `prepublishOnly` 发布阻断、文档同步与治理闭环 |

## 任务清单

### Task 1: Characterization —— 锁住现状（零生产改动）

**Files:**
- Test: `.evo-lite/cli/test/governance.js`
- Sync: `templates/cli/test/governance.js`

- [ ] 固化 `resolveActiveImpl` 现有行为与**双路径事实**（Task 4 的 RED 前置）

### Task 2: Lexical classifier

**Files:**
- Create: `.evo-lite/cli/zvec-path-containment.js`
- Create: `templates/cli/zvec-path-containment.js`
- Modify: `.evo-lite/cli/template-manifest.js`
- Sync: `templates/cli/template-manifest.js`
- Test: `.evo-lite/cli/test/governance.js`
- Sync: `templates/cli/test/governance.js`

- [ ] 纯谓词：不加载 zvec、不访问文件系统

### Task 3: Supported-profile evaluator

**Files:**
- Modify: `.evo-lite/cli/zvec-path-containment.js`
- Sync: `templates/cli/zvec-path-containment.js`
- Test: `.evo-lite/cli/test/governance.js`
- Sync: `templates/cli/test/governance.js`

- [ ] 只读 FS 探查；探查失败 → `UNKNOWN`；合成 `SAFE` 需两层均通过

### Task 4: 单一 engine decision

**Files:**
- Create: `.evo-lite/cli/zvec-collection-path.js`
- Create: `templates/cli/zvec-collection-path.js`
- Modify: `.evo-lite/cli/memory-index.js`
- Sync: `templates/cli/memory-index.js`
- Modify: `.evo-lite/cli/memory-index-zvec.js`
- Sync: `templates/cli/memory-index-zvec.js`
- Modify: `.evo-lite/cli/template-manifest.js`
- Sync: `templates/cli/template-manifest.js`
- Test: `.evo-lite/cli/test/governance.js`
- Sync: `templates/cli/test/governance.js`

- [ ] 诊断与实例化消费同一决策；**非 `SAFE` 时 `loadZvecIndex` 调用次数 = 0**

### Task 5: native 入口收口

**Files:**
- Modify: `.evo-lite/cli/memory-ab.js`
- Sync: `templates/cli/memory-ab.js`
- Modify: `.evo-lite/cli/memory-index-lock.js`
- Sync: `templates/cli/memory-index-lock.js`
- Modify: `.evo-lite/cli/memory-index-zvec.js`
- Sync: `templates/cli/memory-index-zvec.js`
- Add: `docs/validation/zvec-win-unicode-native-entry-audit.md`
- Test: `.evo-lite/cli/test/governance.js`
- Sync: `templates/cli/test/governance.js`

- [ ] `memory-ab` 非 `SAFE` 拒绝执行；`memory-index-lock` 静态审查；全仓复查绕行路径

### Task 6: 降级恢复状态机

- [ ] `marker → rebuild → 清除 marker → 方可切回 zvec`；禁止自动复用旧 collection

### Task 7: verify 诊断与恢复指引

- [ ] 报告判定、原因、degraded 与 marker 状态；危险路径上已存在的 collection 只报告不打开

### Task 8: 发布 enforcement point

- [ ] `spec-portfolio.js` registry 输出 `releaseBlocking` + waiver schema 并派生 blockers
      （**当前 registry 尚未解析该字段**）；非布尔值 → schema error → **fail-closed**
- [ ] `prepublishOnly` → `release-preflight` **现场** `buildSpecRegistry(root,{write:false})`
      派生 blockers，**不读** stale `.evo-lite/generated/spec-registry.json`

### Task 9: 实施完成后的状态推进与闭环

> **adopt 不在此处** —— 已前移至实施授权之前（spec §13）。

- [ ] 状态推进；`sync-runtime --check`；上游上报；`mem commit` 闭环；backlog resolve

## 三处硬停

1. **Task 3 后** —— 判定层复审通过前不接入生产 seam。
2. **Task 4 后** —— 真实 Windows 非 ASCII 路径端到端人工验收通过前不继续。
3. **Task 9 前** —— 复审 ACCEPTED 前不做治理闭环。

## 本轮范围外

修改 hive nurture（留待 `[attp-hive-rollout]` 重新授权）、修复上游 native 缺陷、
解决 8.3 短名 residual、architecture IR 刷新。
