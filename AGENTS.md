# create-evo-lite 3.x — Agent 接手指引

本项目是 **AI Project Continuity Toolkit**。真相源是三个 Markdown 对象，没有运行时、没有数据库、没有 hook、没有 MCP。你读文件就够了。

## 先读这三样（按顺序）

1. `PROJECT.md` —— 我在哪 / 下一步。先读 **Identity** 与 **Now** 两段，30 秒。
2. `docs/specs/` —— 要做什么 / 怎么验收。当前 active：`3.0-product-reset.md`。
3. `docs/devlog.md` —— 做过什么 / 为什么。读最新一条。

## 工作方式

- 开工前先写 spec：`docs/specs/TEMPLATE.md` 是模板，硬上限 120 行，超了就拆。
- 改完一件事：往 `docs/devlog.md` 顶部追加一条（5–10 行，Changed / Why / Learned / Next），再更新 `PROJECT.md` 的 `Now`。
- 检索用 `rg`。canonical truth 是纯文本，不依赖任何索引；索引是可选 capability，不是依赖。
- `PROJECT.md` 每段有硬上限。溢出不是警告，是驱逐信号：`PROJECT.md` → `docs/devlog.md` → git history。
- 渲染可视化进度文档：`node scripts/project-render.js` → `docs/project.html`。单向生成，永不回写源文件。

## 禁区

- 不要把 `docs/lessons-v2.md` 里的 2.x 议题当成待办。它们已关闭，保留只为不再重犯。
- 不要新增 CLI、行数检查器、hook、MCP、search adapter、dashboard engine。迁移顺序第 6 步之前一律未授权。
  一旦发现自己正在写「自动检查 PROJECT.md 是否超行」的程序，就是复发的第一征兆：为了保持轻量，又开始开发治理轻量的治理器。
- 不确定时缩小范围继续（记为 `Assumed`），不要升级成 `Blocked`。只有不可逆操作、安全、数据破坏、兼容性才 BLOCK。

## 不要找的东西

`.evo-lite/`、`templates/cli/`、`.agents/` 属于已冻结的 2.x（`maintenance/2.x`、tag `v2.4-governance-freeze`）。它们不在本分支树内，也不应被复活。
