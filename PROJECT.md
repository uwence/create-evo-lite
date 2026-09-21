# create-evo-lite

3.x 的驾驶舱。人和 AI 都从这里开始。每段有硬上限，超出就把旧内容驱逐到 `docs/devlog.md`，再旧的交给 git history。

## Identity (<= 10)

**create-evo-lite 3.x — AI Project Continuity Toolkit**

给项目安装一套让人和 AI 能持续接手开发的基础设施。一条命令装好三个对象：`PROJECT.md`（我在哪）、`docs/specs/`（要做什么）、`docs/devlog.md`（做过什么、为什么）。

纯 Markdown，零原生依赖。索引坏了、引擎装不上、hook 没生效，项目仍然 100% 可接手——这才是 lite 的定义。

2.x 是另一代产品定义（AI Governance Runtime），已于 2026-09-21 冻结，经验见 `docs/lessons-v2.md`。npm 上 `latest` 仍是 2.4.x，3.x 预发布走 `next`。

## Now (<= 5)

minimal CLI spec 已定义：`docs/specs/3.1-minimal-cli.md` 拥有 CLI 的全部实现验收，3.0 只保留一条聚合结果。

**实现仍未授权。** 下一步是审这份 spec——重点不是功能够不够多，而是有没有哪条 AC 悄悄要求发明新的状态机、镜像或 enforcement layer。

交付面仍未成立：树内没有 `package.json`，任何人都还装不到自己的项目里。

## Milestones (<= 20)

| # | 步骤 | 状态 |
|---|---|---|
| 1 | annotated tag `v2.4-governance-freeze` | 本地已建，远端推送被拒（HTTP 403），待 owner 执行 |
| 2 | branch `maintenance/2.x` | 已推送 |
| 3 | 干净分支建 3.x skeleton，不复制 `.evo-lite` | 完成 |
| 4 | PROJECT.md + specs/ + devlog.md + renderer | 完成 |
| 5 | 独立接手复核 | 完成 |
| 6 | 极小 CLI（init / status / spec / render） | spec 已定义，实现未授权 |
| 7 | fresh clone 全链路通过后 main 切 3.x | 未开始 |

## Decisions (<= 20)

| 日期 | 决策 | 理由 | 被否方案 |
|---|---|---|---|
| 2026-09-21 | 2.x 冻结为 Governance Runtime，不再演进 | 治理层 ~115,000 行 JS 对 720 行产品代码，三条活跃 backlog 全部自锁 | 原地砍瘦 2.x |
| 2026-09-21 | 3.x 重定义为 Project Continuity Toolkit | 解决的已不是同一个问题 | 保留治理定位 |
| 2026-09-21 | 复用包名 `create-evo-lite` | 顶层用户任务未变，major version 足以表达断裂 | 另起新包名 |
| 2026-09-21 | 3.0 预发布走 dist-tag `next` | 现有用户普通安装仍拿到 2.4.x | 直接发 `latest` |
| 2026-09-21 | main 不保留 `legacy/` 目录 | git 层归档不等于 AI 上下文层精简 | 把 `.evo-lite` 搬进 `legacy/` |
| 2026-09-21 | 检索是 capability，不是 dependency | `better-sqlite3` 缺席即整条接管链失败 | 继续以索引为状态模型依赖 |
| 2026-09-21 | Unknown 触发 scope reduction，不触发 blocking | 2.x 的 unknown 最终等价于 blocked | 保留 authority-first 模型 |
| 2026-09-21 | 本阶段不写 CLI，也不写行数检查器 | 写「治理轻量的治理器」是复发第一征兆 | 顺手把 CLI 一起做了 |
| 2026-09-21 | renderer 只读显示 spec 行数，不得阻断或自动改写 | 「展示事实」与「治理执行器」的边界必须落盘，否则复发从这里开始 | 超限即阻断 / 自动搬运 |
| 2026-09-21 | 3.x 当前故意不是 npm package，`package.json` 留到 CLI 阶段整体建立 | 提前单点拆 2.x 发布链会开出半断窗口；2.x 的 scripts 完整保留在 `maintenance/2.x` | 现在就建 package.json |
| 2026-09-21 | 不跟踪生成物 `docs/project.html` | Markdown 是 truth，HTML 是可丢弃投影；跟踪它等于在第一周重造 mirror-sync tax | 入库并靠人工保持同步 |

## Specs (<= 20)

| spec | 说明 | 行数 |
|---|---|---|
| `docs/specs/3.0-product-reset.md` | 2.x 冻结与 3.x 重定位的唯一权威 | 114 / 120 |
| `docs/specs/3.1-minimal-cli.md` | CLI 的实现验收拥有者 | 108 / 120 |
| `docs/specs/TEMPLATE.md` | 新 spec 模板 | 模板 |

## Known Issues (<= 20)

- `v2.4-governance-freeze` tag 未推到远端：该会话凭据对 `refs/tags/*` 返回 403。补救命令见 Commands。
- git 里从未打过 `v2.4.0` tag（最新是 `v2.1.0`），所以 freeze tag 会是标记该版本的第一个 ref。
- 远端遗留 70+ 条 2.x 开发分支，未清理，不影响 3.x。
- `maintenance/2.x` 的维护窗口未定；现有 hive 子仓是否需要显式迁移通知未定。
- `docs/project.html` 的样式内联在 renderer 里，主题化未定；该文件不入库，需要时重新生成。
- `PROJECT.md` 的 eviction 目前纯人工。**本阶段禁止写自动检查器。**

## Commands (<= 30)

```bash
# 渲染开发文档（单向生成，永不回写源文件）
# 产物不入库：Markdown 是 truth，HTML 是可丢弃投影，需要看时重新生成
node scripts/project-render.js          # -> docs/project.html

# 检索：canonical truth 是纯文本，永远只需要 grep
rg -n "关键词" PROJECT.md docs/

# 新建 spec：复制模板，改标题，硬上限 120 行
cp docs/specs/TEMPLATE.md docs/specs/<slug>.md
wc -l docs/specs/<slug>.md

# owner 待执行：补上被 403 拒绝的 freeze tag
git tag -a v2.4-governance-freeze 5c091b9 -m "Evo-Lite 2.x governance runtime — frozen baseline"
git push origin v2.4-governance-freeze
```

## Handoff (<= 10)

1. 读本文件的 **Identity** 与 **Now** 两段。
2. 读 `docs/specs/3.0-product-reset.md`——当前唯一的 active spec。
3. 读 `docs/devlog.md` 最新一条，了解上一轮做了什么、留下什么。

**禁区**：不要把 `docs/lessons-v2.md` 里的 2.x 议题当成待办，它们已关闭；不要新增 CLI、行数检查器、hook、MCP、search adapter、dashboard——第 6 步之前一律未授权。

**不确定时**：缩小范围继续（记为 `Assumed`），不要升级成 `Blocked`。只有不可逆操作、安全、数据破坏、兼容性才 BLOCK。
