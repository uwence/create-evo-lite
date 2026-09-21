# Devlog

开发过程记录，3.x 真正的 memory。**最新在上。** 每条 5–10 行，四段：Changed / Why / Learned / Next。

一条 devlog 的作用是让下一个 agent 不必重读 diff 就知道上一轮为什么这么改。写「为什么」比写「改了什么」重要——改了什么 git 已经知道了。

---

## 2026-09-21 · 3.x skeleton

Changed
- 冻结 2.x：annotated tag `v2.4-governance-freeze` + branch `maintenance/2.x`，均指向 `5c091b9`。
- 从该冻结点建 `3.x` 干净分支，删除 764 个文件 / 232,764 行，树内不再有 `.evo-lite/`、`templates/cli/`、`.agents/`。
- 落地三个核心对象与 renderer：`PROJECT.md`、`docs/specs/`、`docs/devlog.md`、`scripts/project-render.js`。

Why
- 2.x 治理层约 115,000 行 JS 对应 720 行产品代码，且三条活跃 backlog 全部自锁在「权威尚未实例化」上。
- 新 clone 里 `better-sqlite3` 缺席即整条接管链失败——为跨 agent 接手而建的装置，在新 agent 真正接手时第一个动作是抛错。

Learned
- git 层归档不等于 AI 上下文层精简：`legacy/` 留在主线树内，AI 仍会搜到并决定复用旧实现。
- 迁移顺序本身是设计：`package.json` 的 `test` / `prepublishOnly` 仍指向 `.evo-lite/cli`，提前单点拆 hook 会开出发布链半断的窗口。

Next
- 第 5 步 fresh-agent dogfood。第 6 步 CLI 未授权，dogfood 通过也不自动开始。
- Owner 待执行：补推 freeze tag（本会话凭据对 `refs/tags/*` 返回 403）。
