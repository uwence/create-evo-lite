# <项目名>

人和 AI 共用的驾驶舱。每段有硬上限，超出就把旧内容驱逐到 `docs/devlog.md`，再旧的交给 git history。

## Identity (<= 10)

一句话说清这个项目是什么、给谁用、解决什么问题。

## Now (<= 5)

现在在做什么，下一步是什么。超过 5 行就说明它不是 Now。

## Milestones (<= 20)

| # | 里程碑 | 状态 |
|---|---|---|
| 1 | <第一个里程碑> | 未开始 |

## Decisions (<= 20)

| 日期 | 决策 | 理由 | 被否方案 |
|---|---|---|---|
| <YYYY-MM-DD> | <决定了什么> | <为什么> | <考虑过但没选的> |

## Specs (<= 20)

| spec | 说明 | 行数 |
|---|---|---|
| `docs/specs/TEMPLATE.md` | 新 spec 模板 | 模板 |

## Known Issues (<= 20)

- <已知但暂时不修的问题，写清为什么不修>

## Commands (<= 30)

```bash
# 渲染开发文档（单向生成，产物不入库）
npx create-evo-lite render        # -> docs/project.html

# 机械事实
npx create-evo-lite status

# 新建 spec
npx create-evo-lite spec <slug>
```

## Handoff (<= 10)

1. 读本文件的 **Identity** 与 **Now** 两段。
2. 读 `docs/specs/` 里当前 active 的 spec。
3. 读 `docs/devlog.md` 最新一条。

**禁区**：<这个项目里明确不该做的事>

**不确定时**：缩小范围继续（记为 `Assumed`），不要升级成 `Blocked`。只有不可逆操作、安全、数据破坏、兼容性才 BLOCK。
