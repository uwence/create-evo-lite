# plan 完整代码 vs 审查独立性 —— 观察记录与待裁决问题

状态：**OBSERVED / 未裁决 / 未授权任何规则变更**
记录日期：2026-09-04
触发来源：子巢 `hungersnakegame8` 完成一个阶段开发后对 Evo-Lite 的评估
本文性质：**观察记录 + 待所有者裁决的问题**，不是设计提案，也不是批准。

---

## 1. 规则原文（本轮亲验）

`.agents/rules/execution-model.md` 的 "What codex-executable means for the plan" 段：

> - Complete code in every code step — no "implement the rest", no placeholders.

同一文件的 Boundaries 段还写着：

> - Delegation does not lower the review bar. A wrong-but-plausible codex diff
>   that passes a shallow read is exactly what the review gate exists to catch.

两句都已逐字核对，不是转述。

## 2. 子巢报告的证据（转述，**未独立复现**）

子巢在一次完整的 spec → plan → 执行 → 复审 → 闭环之后，报告了这样一个缺陷：

> Space 键的暂停功能从一开始就是坏的 —— `pause` 后立刻 `resume`，净效果为零。
> 这段代码是我写在 plan 里的，sonnet 逐字照抄（它被明确要求不许改动），
> 我审查时读的是自己写的东西。三个 agent、两轮 review gate、24 个单元测试，
> 全都没抓到它。最后是实机点了一下 Space 才发现。

**边界声明**：本轮**没有**独立复现这个缺陷。原因是子巢已经自行修复 ——
当前 `hungersnakegame8/src/core/game.ts` 走的是 `toggle-pause`，
`game.test.ts` 也有对应的往返测试。因此上面的因果链（plan 作者写错 →
执行方逐字照抄 → 审查方读自己的代码）来自子巢的自述，**不是本仓的实测结论**。
如果这条要成为裁决依据，应当先从子巢的 git 历史中取回缺陷版本核对。

## 3. 这个观察指向规则的哪一处盲点

规则已经预见了一种失效：**codex 写出貌似合理但错误的 diff，审查者浅读放过**。
针对它的对策是 review gate 的四条（读 diff、核对 checkbox、重跑 verify、
对照 AC 与 Non-Goals）。

子巢报告的失效是**另一种**：错误在 plan 里就已经存在，执行方被明确要求
不得改动，于是错误被原样搬运到实现；审查方读到的是自己写下的代码。
四条 review gate 对它全部无效——

- 读 diff：diff 与 plan 逐字一致，看不出问题
- 核对 checkbox：全勾
- 重跑 verify：24 个单元测试全绿（测试同样出自同一作者的同一份理解）
- 对照 AC：AC 本身没有覆盖"暂停后必须真的停住"这条实机行为

也就是说，**四条 gate 都在检查"实现是否忠于 plan"，没有一条检查"plan 是否正确"**。
当 plan 携带完整代码时，"忠于 plan" 与 "正确" 之间的距离被压缩为零。

## 4. 这个设计换来了什么（不能只算代价）

`Complete code in every code step` 不是疏忽，它有明确收益：

- 执行方可以是更弱、更便宜的模型，因为任务不要求它做实现判断
- 任务自包含，执行方无需额外上下文，可并行、可重跑
- 执行结果可预测，减少"执行方自由发挥导致偏离 spec"这类失败

子巢建议的替代方案（plan 只放接口契约 + 关键约束 + 已知陷阱，把实现判断留给
执行方）会直接削弱以上三条中的第一条和第三条。这是一个**权衡**，不是一个 bug。

## 5. 待裁决的问题（只有产品所有者能回答）

1. **审查对象**：review gate 检查的应当是"实现忠于 plan"，还是"实现正确"？
   若是后者，完整代码 plan 下由谁、在什么位置提供独立视角？
2. **代价接受度**：为换取审查独立性，是否愿意放弃"可委派给弱模型"这一收益？
   还是只在某类任务（例如涉及实机交互、时序、状态机的任务）上放弃？
3. **是否有第三条路**：例如保留完整代码，但要求 AC 中必须含至少一条
   **实机/端到端** 判据（Space 键那个缺陷正是被实机点击发现的）。这条不改变
   执行模型，只改变验收契约的形状 —— 但它属于 spec-intake 的范围，不是本文的。
4. **证据门槛**：本文第 2 节是转述。裁决前是否要求先从子巢历史取回缺陷版本，
   独立复现一次？

## 6. 本文不授权的事

- 不授权修改 `.agents/rules/execution-model.md` 的任何一句。
- 不授权修改 review gate 的四条。
- 不授权修改 spec-intake 或 AC 的形状要求。
- 不主张本问题的优先级。它可能长期停在 OBSERVED，那是正当终态。

相关：本轮同批记录的 `linkedplan-consumer-divergence.md` 也是
"记录但不裁决" 的形状，两者互不依赖。
