# linkedPlan 消费者口径分歧 —— 观察记录与待冻结合同

状态：**OBSERVED / 合同未冻结 / 实现未授权**
记录日期：2026-09-04
触发来源：子巢 `hungersnakegame8` 经 `hive nurture` 上报的反馈项 `[linkedplan-3-way]`
本文性质：**观察记录 + 待裁决问题清单**，不是设计，也不是批准。

---

## 1. 为什么现在写这个，而不是直接修

`resolveLinkedPlanIds` 已经是一个被抽出来的共享判定函数，测试里甚至写着它存在的理由：

> `parse-markdown must export resolveLinkedPlanIds so portfolio and closure share ONE relation algorithm`
> （`templates/cli/test/governance.js:1567`）

但抽出共享函数**没有让所有消费者共享它**。缺陷从判定层迁移到了接入层：一部分消费者调用共享算法，另一部分绕过它直接读原始字段。这与本仓已记录的另一个同型教训一致 —— 抽出共享词汇表不等于共享了传输协议。

在没有裁定「哪个口径是权威」之前修改任何一个消费者，都是在用实现选择替代合同选择。所以本轮**只记录，不修改**。

## 2. 实测证据（本轮亲验）

探针：构造一个**完全不声明 plan 关系**的 spec，关系只声明在 plan 一侧（`linkedSpec: spec:probe`），然后同时问两个口径。

```
spec.linkedPlans        →  []
resolveLinkedPlanIds()  →  ["plan:probe"]

DIVERGENCE REPRODUCED: true
```

同一份数据、同一次解析，两个口径给出相反答案。这是纯函数调用的结果，不依赖夹具树，也不依赖 git 状态。

## 3. 消费者清单（本轮亲验的静态事实）

共享算法定义在 `templates/cli/planning/parse-markdown.js:378`。

| 消费者 | 读什么 | 是否走共享算法 |
|---|---|---|
| `spec-portfolio.js:482` | `resolveLinkedPlanIds(parsed, ir)` | ✅ |
| `verification/close-preview.js:66` | `resolveLinkedPlanIds(parsed, planIr)` | ✅ |
| `planning/scan.js:181` | `spec.linkedPlans` | ❌ 直接读 |
| `planning/traceability.js:15` | `spec.linkedPlans` | ❌ 直接读 |
| `planning.js:14` | `spec.linkedPlans` | ❌ 直接读 |
| `planning/lint.js:127` | `frontmatter.linkedPlan`（单数） | ❌ 连 body 段都不认 |

`spec.linkedPlans` 本身的填充规则（`parse-markdown.js:321-323`）：先取 body 的 `## Linked Plans` 段，为空时回落到 frontmatter 的 `linkedPlan`（单数）。**两条都只看 spec 一侧的正向声明**，不认 plan 一侧的反向声明。

因此本仓现存的三种声明形式各自被不同子集承认：

- body `## Linked Plans` 段 → 除 `lint.js` 外都认
- frontmatter `linkedPlan`（单数） → 全部都认
- plan 侧 `linkedSpec`（反向） → **只有走共享算法的两个消费者认**

子巢反馈里「必须在 spec 里同时写 body 段和 frontmatter 字段两处冗余声明才能让三者同时全绿」的结论，与上表一致。

## 4. 边界：本轮没有验证的部分

诚实标注，避免后续把推断当证据：

- 子巢报告的完整复现路径（`mem plan scan && mem plan trace && mem plan lint` 三命令连跑后 `chains=0`、全部任务显示 unlinked）**未在母仓独立复现**。本轮只复现了第 2 节那一层的判定分歧，以及第 3 节的静态接入事实。
- 该分歧对 **release verdict** 的影响未测量。姊妹问题 `[plan-status-parser-divergence]` 曾证伪过一条同类的 release-gate 影响链，不能据此推定本问题同样无影响，也不能推定有影响。
- 各消费者当前口径分别导致多少条现存 finding，未量化。

## 5. 与 `[plan-status-parser-divergence]` 的关系

两者是**兄弟问题，不是同一个问题**：

- `[plan-status-parser-divergence]`：同一个 plan，两种 parser 对「没有显式 status」派生出不同生命周期状态。
- 本条：同一个 spec↔plan 关系，六个消费者对「什么算一条链接」采用不同判据。

共同形状是「多消费者、无权威口径」。已登记的那一条明确写着「未冻结前不得修改 parser 或 closure production code」。本条采取相同约束。

两者应当**在同一次合同裁决里一起考虑**，因为任何一边单独冻结，都会把另一边的口径固化成既成事实。但它们**不得合并为一个工作项** —— 只修任一边都无法定义完整合同，这一点已在 backlog 中就 parser 分歧记录过。

## 6. 待冻结的问题（只有产品所有者能回答）

以下问题在得到裁定前，任何实现都是在替所有者做决定：

1. **权威口径**：一条 spec↔plan 链接的权威定义是什么？是 spec 的正向声明，还是 plan 的反向声明，还是两者的并集（即共享算法当前的行为）？
2. **声明形式**：三种声明形式（body 段 / frontmatter 单数字段 / plan 侧反向字段）是否都要长期支持？还是应当收敛到一种，其余标记为 deprecated？
3. **一致性义务**：所有消费者是否**必须**走同一个判定函数？如果允许例外（例如 `lint.js` 故意只检查 frontmatter 以强制某种书写规范），该例外必须写进合同并说明理由。
4. **迁移代价归属**：若统一口径会改变现存 finding 集合（zombie plan / aging / traceability chains），这些变化是「修复」还是「回归」？判据必须在改动之前冻结，而不是看到结果之后再定。

## 7. 本文不授权的事

- 不授权修改 `parse-markdown.js`、`scan.js`、`traceability.js`、`planning.js`、`lint.js`、`spec-portfolio.js`、`close-preview.js` 中任何一处的关系判定。
- 不授权把 `resolveLinkedPlanIds` 接入其余四个消费者 —— 那正是问题 1 和问题 3 的答案，不能由实现顺手给出。
- 不授权修改任何现存 spec 或 plan 的声明形式来「消警」。
- 不主张本问题的优先级。它可能长期停在 OBSERVED，那是正当终态。

---

附：本文所属目录 `docs/validation/` 已随同一轮工作纳入 R006 治理产物豁免，因此本文的后续修改不会再产生「请把本文链接到 docs/plans/ 的某个任务」这类自指要求。
