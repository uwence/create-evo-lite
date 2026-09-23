# <项目名> — Agent 接手指引

本项目用 create-evo-lite 3.x 管理连续性。真相源是三个 Markdown 对象，没有运行时、没有数据库、没有 hook、没有 MCP。你读文件就够了。

## 先读这三样（按顺序）

1. `PROJECT.md` —— 我在哪 / 下一步。先读 **Identity** 与 **Now** 两段，30 秒。
2. `docs/specs/` —— 要做什么 / 怎么验收。
3. `docs/devlog.md` —— 做过什么 / 为什么。读最新一条。

## 工作方式

- 开工前先写 spec：`docs/specs/TEMPLATE.md` 是模板，硬上限 120 行，超了就拆。
- 改完一件事：往 `docs/devlog.md` 顶部追加一条（5–10 行，Changed / Why / Learned / Next），再更新 `PROJECT.md` 的 `Now`。
- 检索用 `rg`。canonical truth 是纯文本，不依赖任何索引；索引是可选 capability，不是依赖。
- `PROJECT.md` 每段有硬上限。溢出不是警告，是驱逐信号：`PROJECT.md` → `docs/devlog.md` → git history。
- `npx create-evo-lite status` 只报机械事实；`npx create-evo-lite render` 生成 `docs/project.html`，单向，不回写源文件。

## 禁区

- 不要把 `PROJECT.md` 当历史数据库。git 才是无限容量的 archive。
- 不要为了保持轻量而开发「检查轻量的检查器」——那是复发的第一征兆。
- 不确定时缩小范围继续（记为 `Assumed`），不要升级成 `Blocked`。只有不可逆操作、安全、数据破坏、兼容性才 BLOCK。
