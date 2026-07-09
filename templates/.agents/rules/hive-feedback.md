# Hive Feedback Outbox 协议

本项目是母巢 (create-evo-lite) 的子巢。evo-lite 基因 (`.evo-lite/cli/`、`.agents/` 受管文件) 由母巢 nurture 单向下发，子巢不自行修改。

## 何时上报

当你在工作中撞到 **evo-lite 本身** 的摩擦 — CLI 报错误导、治理规则误判、文档与行为不符 — 而不是本项目代码的问题时：

1. 打开 `.evo-lite/hive/feedback.md`（不存在则直接创建）。
2. 追加一行，格式与 backlog 相同：

   `- [ ] [short-label] 现象 + 复现条件 + 期望行为`

   label 限 `[A-Za-z0-9_-]{1,32}`。

3. 正常提交。母巢下次 nurture 会收集这些条目（并勾选为 `- [x]`），转为母巢 backlog 候选。

## 禁止

- 不要直接修改 `.evo-lite/cli/` 下的受管基因文件来"顺手修掉"摩擦 — nurture 会检测到变异并拒绝推送；真正的修复应经由上报流入母巢。
- 不要把本项目自身的 bug 写进 outbox — 那属于本项目的 backlog。
