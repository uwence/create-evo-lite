---
description: 会话结束时，总结会话并创建 walkthrough 文档。
---
# 📝 Walkthrough Generation Protocol

一次开发/调试会话结束时，执行此协议，固化过程，生成可复盘的 `walkthrough` 文档。

## 1. 会话总结 (Session Summary)
先总结整场会话，涵盖：
- **核心目标**: 本次会话想解决啥？
- **主要变更**: 改了哪些关键代码/协议？
- **遇到的问题与修正**: 哪些意外困难，怎么解决？
- **结论**: 结果是什么，对项目有啥价值？

## 2. 生成文档 (Generate Document)
按总结内容，创建 Markdown 格式 `walkthrough` 文档。

- **命名规范**:
  - 在 `.evo-lite/walkthroughs/` 目录下创建。
  - 文件名格式: `YYYY-MM-DDTHH-mm-ss-SSSZ-walkthrough-<SESSION_ID>.md`

- **内容结构**:
  - 用 `# Walkthrough: <SESSION_ID>` 作为主标题。
  - 包含 `## 核心目标`, `## 主要变更和操作`, `## 遇到的问题与修正`, `## 结论` 等二级标题。
  - 内容要精炼、客观，清晰复盘整个过程。

## 3. 确认与提交 (Confirm & Commit)
文档生成后，加入版本控制，作为独立 commit 提交，便于追溯。

```bash
# Unix / Bash
git add .evo-lite/walkthroughs/*.md

# Windows PowerShell / CMD
git add .evo-lite/walkthroughs
git commit -m "docs(walkthrough): add session summary for <SESSION_ID>"
```
