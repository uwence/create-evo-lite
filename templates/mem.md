---
description: 状态保存、进度更新与记忆闭环交接协议
---
# 📦 进度存档与交接协议 (/mem)

当你在本会话中完成了一个独立的功能点、修复了一个 Bug，或者你需要主动结束当前工作闭环时，**必须调用此协议**以确保上下文和经验被安全存档，供下一任 AI 助理（或者下一次你的唤醒）无缝接管。

// turbo-all
步骤：
1. **显性单据覆写 (Update Active Context)**: 使用文件编辑工具修改本项目根目录下 `.evo-lite/active_context.md`。更新顶部的 `> **更新时间**:`和项目状态；将刚刚做完的事情在"2. 🚧 当前进度与任务"追加写为 `[x]` 勾选项；在 `## 3. ⏭️ 下一步行动项` 重新罗列接下来的目标，并将上下文断点精确记录。若是小功能可以直接工具编辑闭环。
2. **项目版本小跃迁 (Bump Version)**: 修订 `package.json` 中的 `version` 字段。若无重大重构，通常增加末尾修订号（z位），并将该版本号同步至 `.evo-lite/package.json`（若存在）。
3. **经验向量记忆 (可选但强烈建议)**: 请主动回顾刚才的工作中值得借鉴的开源方案或避坑方案，提炼总结，并在终端运行:
   ```bash
   $commit = git rev-parse --short HEAD
   .\.evo-lite\mem.cmd remember "核心总结：使用了 XX 算法处理了 XX 难题。(溯源历史点: [Commit: <hash1>, <hash2>])"
   ```
   *(注: 如果非 Windows 平台，请使用 `./.evo-lite/mem`)*
4. **版本快照约束与入库 (Git Commit)**: 执行全部修改文件的入库提交，提交信息务必使用 Conventional Commits 规范。
   ```bash
   git add .
   git commit -m "chore(docs): your commit message here"
   ```
5. **打 Tag 并汇报 (Final Handover)**: 如果改动了版本号，请配合打好 Git Tag 以备发布。
   ```bash
   git tag -a v1.0.X -m "Release vX"
   ```
6. **交接完成满分法定话术反馈**: 使用简炼的口语向开发者宣告：“交接协议已执行完毕。**Master，当前功能已闭环。建议您立即审视是否执行 Git Commit。**” 即使刚才自动提交了，也要执行该法定话术完成最后的状态机跳变信号。
