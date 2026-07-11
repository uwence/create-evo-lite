---
id: spec:provider-first-code-perception-foundation
status: adopted
created: 2026-07-07
relations: [{"kind":"spawned-from","target":"spec:evo-lite-providers"}]
---

# Spec: Provider-First Code Perception Foundation (Umbrella)

> **本 spec 是架构总纲 (umbrella)。** 实现级契约、类型、路由、adapter、linker、CLI/MCP、Wiki 与 Acceptance Criteria 已迁移到三个子 spec(见 §5 Decomposition)。umbrella 只保留架构决策、边界、子 spec 职责与依赖、全局成功定义,不再承载实现细节——因此它不应触发 `size-exceeded`。

## 1. Summary

为 create-evo-lite 建立 Provider-First 的代码感知底座。

create-evo-lite 不重复实现完整 AST 解析、跨文件符号解析、调用图和影响分析,而是通过统一的 `CodePerceptionProvider` 契约接入已有代码智能工具,并将外部代码事实与 Evo-Lite 自身的 Spec、Plan、Task、Commit、Evidence 和 Active Context 连接起来。

核心定位:

```text
外部 Provider 负责理解代码结构
Evo-Lite 负责理解项目为什么这样开发
Unified Project Perception 负责把两者连接起来
```

## 2. Problem

现有系统能回答"焦点是什么 / 有哪些未完成任务 / 某 Task 是否有 evidence / 有哪些模块 / 架构是否过期",但**无法可靠回答**:

```text
某个功能由哪些 symbols 实现？
一个 CLI 命令经过怎样的调用链？
修改某个函数会影响哪些调用者和测试？
某个 Task 实际落到了哪些函数？
一个 Commit 改变了哪些代码实体？
当前焦点涉及哪些模块、文件和调用流程？
```

自研完整代码图谱要维护多语言解析器、import/类型/动态调用解析、增量索引、图查询、文件 watcher、大仓库性能——与成熟工具重复建设。因此差异化放在 **统一 Provider 契约 + 代码事实与治理事实连接 + 人类与 Agent 共用的项目感知**,而非重造全部代码分析基础设施。

## 3. Architectural Decision

```text
Provider-First      完整 symbol/call/impact graph 由外部 Provider 管理;不把 Provider 私有 DB 当作 canonical truth。
Capability-Routed   查询按 Provider 能力路由,不假设单一 Provider 支持全部功能。
Reference-Oriented  本地只存 Provider 状态/snapshot/entity references/Task-to-Code/Commit-to-Code 链接与轻量摘要,不复制完整外部图。
Governance-Linked   Evo-Lite 建立 Spec→Plan→Task→File→Provider Symbol→Test→Commit→Evidence 链。
Local-First         默认不上传代码、不自动安装工具、不自动建索引、不要求云服务;Provider 不可用时降级 Native Lite。
```

## 4. Reference Provider Roles(宏观,实现细节在子 spec)

```text
CodeGraph          structural-primary   —— 首个正式 Provider(子 spec 2)
Understand Anything enrichment           —— follow-up(spec:understand-anything-enrichment-provider)
GitNexus           structural-advanced   —— follow-up,用户独立安装+许可(spec:gitnexus-advanced-code-provider)
Evo-Lite           governance            —— task/spec/evidence 权威
```

结构事实与 enrichment 是**不同 authority 类**;enrichment 不得覆盖 CodeGraph 的确定性 symbol/source range/call edge。UA 与 GitNexus 不在本代际正式实现。

## 5. Sub-Spec Decomposition

umbrella 拆为三个可独立交付的子 spec,职责边界与依赖如下:

```text
① spec:code-perception-provider-native-lite        [foundation]
   CodePerceptionProvider 契约 + capability router + freshness/provenance
   + Native Lite fallback + fixture provider + contract tests。
   决定后两层的稳定边界。无外部工具时即可回答"文件属哪个模块/哪个 Task 声明关联"。

② spec:codegraph-adapter-governance-linker         [differentiation]
   CodeGraph CLI adapter(allowlist execFile / JSON normalize / opaque explore / no-DB-coupling)
   + Governance Linker(Task→File→Symbol / Commit diff-range→symbol / Evidence→Code,
   置信度分级 confirmed/derived/proposed)+ 本地 cache + 真实 CodeGraph dogfood。
   Evo-Lite 的核心差异化 (Task-to-Code) 落在这里。

③ spec:unified-code-explore-wiki-projection        [surface]
   mem code explore + MCP evo_code_explore(共用一个 service)
   + Minimal Code Wiki 投影 + Inspector Code 页 + degraded guidance。
   人类与 Agent 的统一感知面。
```

### 5.1 依赖与关系

```text
② depends-on ①        (adapter/linker 依赖契约与 reference model)
③ depends-on ① + ②    (explore/wiki 消费契约、adapter 结果与 governance links)
② blocks ③            (③ 无法先于 ② 交付有效的 Task-to-Code 感知)
① 无外部依赖,可独立先行
```

Portfolio 血缘(`relations` frontmatter): 三者均 `spawned-from` 本 umbrella;②`blocks`③。**精确的执行级 dependsOn 放在各子 spec 正文与后续 plan**,不塞进 frontmatter(当前关系模型只表达宏观血缘/阻塞)。

### 5.2 边界决定

- **Governance Linker 不单拆为第四个子 spec**。它与 CodeGraph Adapter 价值链高度耦合(CodeGraph 提供代码事实 → Linker 把事实接入 Task/Commit/Evidence);单独做 Adapter 易退化成普通代码检索集成。二者同处子 spec ②,保证每阶段都围绕 Evo-Lite 差异化价值交付。
- **交付顺序**: 先 ① 收编+启动,②③ 保持 adopted 不并行起 plan(主动遵循未来在途预算原则),完成 ① dogfood 后再依 ②→③ 推进。

## 6. System Architecture

```text
                       Human / Agent
                            │
                            ▼
                  Evo Unified Query API          ← 子 spec ③
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
       Governance Data   Query Router   Code Wiki   ← ① router / ③ wiki
              │             │
              │       ┌─────┴─────┐
              │       ▼           ▼
              │  Native Lite   CodeGraph            ← ① native-lite / ② adapter
              │                    │
              └──────────┬─────────┘
                         ▼
               Unified Perception Result
```

## 7. Explicit Decisions(全局,子 spec 继承)

1. CodeGraph 是首个实现 Provider;UA/GitNexus 是 follow-up。
2. Native Lite 永远可用;Provider 缺失是受支持的降级态。
3. Evo-Lite 不打开 Provider 内部数据库、不自动安装/建索引。
4. Provider 能力按查询选择;结构事实与 enrichment 是不同 authority 类。
5. 不按 name 合并不同 Provider 实体;不复制完整外部图;只存轻量引用与治理链接。
6. MVP 只暴露一个主要 MCP 代码工具(`evo_code_explore`)。
7. staleness 必须出现在每个代码结果中。
8. 人类 Code Wiki 与 Agent 查询共用一个 service。
9. **Task-to-Code 是 Evo-Lite 主要差异化。**
10. 外部 Provider 许可证由用户负责;Provider 不作为强制依赖。
11. post-commit 不隐式跑昂贵的外部索引。
12. 子 spec ② closure 前必须有一次真实 CodeGraph dogfood。

## 8. Success Definition

安装并索引 CodeGraph 的项目中:

```text
用户查看当前 Task → Evo-Lite 读 Planning IR → 解析 linkedFiles/Commit/Evidence
→ CodeGraph 解析对应 symbols 与影响范围 → 生成 Task-to-Code 页面
→ Agent 通过 evo_code_explore 获取同一份结果
```

无 CodeGraph 的项目中: Native Lite → 文件/模块/任务/提交仍可见;symbol/调用链/Impact 显示 unavailable;其他治理功能不受影响。

create-evo-lite 由 `Project-local AI Governance Runtime` 演进为 `Project-local AI Governance and Provider-First Project Perception Runtime`,同时保持: 本地优先、可降级、可重建、无强制 Provider/daemon/模型、不复制完整外部图、不绑定单一工具。

## 9. Follow-up Specs

```text
spec:understand-anything-enrichment-provider
spec:gitnexus-advanced-code-provider
spec:code-wiki-interactive-visualization
spec:native-code-intelligence-provider
```
