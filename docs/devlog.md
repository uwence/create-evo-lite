# Devlog

开发过程记录，3.x 真正的 memory。**最新在上。** 每条 5–10 行，四段：Changed / Why / Learned / Next。

一条 devlog 的作用是让下一个 agent 不必重读 diff 就知道上一轮为什么这么改。写「为什么」比写「改了什么」重要——改了什么 git 已经知道了。

---

## 2026-09-21 · 测试卫生修复

Changed
- spec 12 条验收勾上 5 条有证据的；freeze tag 一条保持未勾——远端至今没有该 ref，本地有不算 durable freeze。
- `Now` 改写为正常项目状态；两条此前只存在于对话里的边界落盘为 Decision（renderer 只读展示、3.x 故意不是 npm package）。
- `branchLabel()` 补 `stdio: ['ignore','pipe','ignore']`；`docs/project.html` 停止跟踪，改为需要时重新生成。

Why
- Dogfood #1: INVALID due to self-referential test setup. Content reconstruction was correct and exposed four documentation/runtime defects. No pass/fail credit assigned.
- 产品没有失败，是测试设计失败：`Now` 当时写着「本次审阅就是第 5 步」，把「当前焦点 / 下一步」两个答案退化成复述测试本身。

Learned
- 边界只写在对话里等于没写。`SPEC_LINE_CAP` 和缺席的 `package.json` 都被外部复核当成疑点，因为树里读不到理由。
- 注释宣称的行为必须可实测：`degrades silently` 在无 `.git` 时实际会打印 `fatal: not a git repository`。
- 生成物入库就是 mirror-sync tax 的起点，2.x 已经为此付过一次学费。

Next
- 第 6 步仍未授权；在它正式关闭前不写 CLI 实现，只可能先写 spec。

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
