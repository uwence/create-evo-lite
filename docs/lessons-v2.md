# Lessons from Evo-Lite 2.x

2.x（AI Governance Runtime）于 2026-09-21 冻结在 `v2.4-governance-freeze` / `maintenance/2.x`。

> **本文件是历史经验，不是 3.x 的待办。**
> 任何 agent 都不得把这里的条目当成 backlog、议题或待修缺陷。它们已经关闭了。
> 保留它们的唯一理由，是不要在 3.x 里重新犯同样的错。

## 三条经验

1. **外部宿主身份不可证明时，不构建自动推断链。**
   宿主不提供权威身份，就不要用目录扫描、slug 反推、注册表猜测去补。缺的是权威，不是实现。

2. **Runtime health 只检查本产品拥有的事实。**
   把不属于自己的事实纳入健康判定，结果是既报不准，也修不了。

3. **Hook 是 convenience，不是 correctness root。**
   正确性不能建立在「hook 一定被安装且一定执行成功」之上。hook 失败时产品应当照常可用。

## 它们从哪来（已关闭，不再跟进）

| 2.x 议题 | 结局 | 对应经验 |
|---|---|---|
| `[3d78] attp-hive-rollout` | v2 historical lesson | 1 |
| `[attp-lw-memory-identity]` | v2 historical limitation | 1 |
| `[0ce0] verify-hook-runtime-health` | v2 historical lesson | 2、3 |

这三条在 2.x 里全部处于 blocked，且没有一条能靠自己解阻。它们不迁入 3.x backlog。

## 结构性诊断（一次性记录，不再展开）

- 治理层约 115,000 行 JS（`.evo-lite/cli` 与 `templates/cli` 逐字节镜像，等于每次改动都要同步两份），对应 720 行产品代码；单个测试文件 `test/governance.js` 23,111 行。
- 168 次提交里 `feat:` 只有 10 次；最近 120 次提交的文件触达中，产品代码只占 18 次。
- 推理链 `unknown → authority missing → judgement forbidden → implementation forbidden` 使 unknown 最终等价于 blocked。**3.x 的 `Assumed` 状态就是为了切断这条链。**
- `active_context.md` 的 FOCUS 膨胀成 1835 字符的单个段落：只有 append，没有 evict。**3.x 的硬上限与驱逐路径就是为了这一条。**
- 为跨 session / 跨 agent 接手而建的整套装置，在一次真实的新 clone 里因缺少原生模块而完全无法启动。**3.x 的「检索是 capability 不是 dependency」就是为了这一条。**

2.x 的代码与文档完整保留在 git history 与 `maintenance/2.x`，不在 3.x 树内，也不应被复活。
