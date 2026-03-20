---
description: 会话结束时，总结当前会话并创建 walkthrough 文档。
---
# 📝 Walkthrough Generation Protocol

当一次开发或调试会话结束时，执行此协议来固化会话过程，生成一份可供复盘的 `walkthrough` 文档。

## 1. 会话总结 (Session Summary)
首先，对整个会话进行全面总结，涵盖以下几个方面：
- **核心目标**: 本次会话旨在解决什么核心问题？
- **主要变更**: 实施了哪些关键的代码或协议修改？
- **遇到的问题与修正**: 在过程中遇到了哪些预期之外的困难，以及是如何解决的？
- **结论**: 本次会话达成了什么成果，对项目有何价值？

## 2. 生成文档 (Generate Document)
根据总结的内容，创建一个 Markdown 格式的 `walkthrough` 文档。

- **命名规范**:
  - 在 `.evo-lite/walkthroughs/` 目录下创建。
  - 文件名格式: `YYYY-MM-DDTHH-mm-ss-SSSZ-walkthrough-<SESSION_ID>.md`

- **内容结构**:
  - 使用 `# Walkthrough: <SESSION_ID>` 作为主标题。
  - 包含 `## 核心目标`, `## 主要变更和操作`, `## 遇到的问题与修正`, `## 结论` 等二级标题。
  - 内容应精炼、客观，清晰地复盘整个过程。

## 3. 确认与提交 (Confirm & Commit)
文档生成后，将其加入版本控制，并作为一个独立的 commit 提交，以便追溯。

```bash
# Unix / Bash
git add .evo-lite/walkthroughs/*.md

# Windows PowerShell / CMD
git add .evo-lite/walkthroughs
git commit -m "docs(walkthrough): add session summary for <SESSION_ID>"
```
