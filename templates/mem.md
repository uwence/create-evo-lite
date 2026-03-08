---
description: 状态保存、进度更新与记忆闭环交接协议
---
# 📦 进度存档与交接协议 (/mem)

当本会话完成独立功能点、Bug 修复，或需要主动结束当前工作闭环时，必须强制调用此协议，以确保上下文被安全存档。

// turbo-all
**执行步骤 (严格按顺序执行):**

1. 显性单据覆写 (Update Active Context)
   使用文件编辑工具修改本项目根目录下的 `.evo-lite/active_context.md`。针对该文件的不同层级，必须严格按序执行以下三项原子操作：
   - [A. 顶层元数据]: 修改 `> 更新时间:` 为当前最新时间，并按需更新 `> 项目状态:`。
   - [B. 状态机打勾 (微观/最高优先级)]: 精准定位 `## 2. 🚧 当前进度与任务`。⚠️ 严禁只更新第1节而忽略此处！必须将刚完成的任务项由 `- [ ]` 严格变更为 `- [x]`；若该任务不在现有列表中，必须在列表末尾追加一条新的 `- [x] 你的具体任务描述`。
   - [C. 行动指针偏移]: 精准定位 `## 3. 📝 下一步行动指南 (Next Actions)`。将已在 [C] 中打勾的任务从本列表中彻底清理，并根据上下文断点补充接下来的新目标。

2. 项目版本小跃迁 (Bump Version)
   修订 `package.json` 中的 `version` 字段。若无重大重构，增加末尾修订号（Patch），禁止修改 `.evo-lite/package.json`（若存在）。

3. 版本快照约束与入库 (Git Commit - 优先执行以获取 Hash)
   执行修改文件的入库提交，务必遵守 Conventional Commits 规范，并**读取终端返回的 Commit Hash**：
   ```bash
   git add .
   git commit -m "chore(docs): 你的提交信息"
   ```
4. 精确提取短哈希 (Fetch Short Hash)
   提交完成后，**必须立即在终端执行以下命令**，以获取刚刚生成的 7 位短哈希（Short Hash）：
   ```bash
   git rev-parse --short HEAD
   ```

5. 经验向量记忆 (可选但强烈建议)
   提炼本次工作中的开源方案借鉴或避坑总结，**使用第 3 步生成的真实 Commit Hash**，在终端运行以下命令：
   ```bash
   .\.evo-lite\mem.cmd remember "核心总结：使用了 XX 算法处理了 XX 难题。(溯源历史点: [Commit: <在此精确填入第4步获取的7位Hash>])"
   ```
   *(注: 非 Windows 平台请使用 `./.evo-lite/mem`)*

6. 打 Tag 并汇报 (Final Handover)
   若执行了第 2 步的版本号变动，必须打好 Git Tag：
   ```bash
   git tag -a v1.0.X -m "Release vX"
   ```

7. 状态机跳变反馈 (Mandatory Output)
   向 Master 宣告：“交接协议已执行完毕。Master，当前功能已闭环。建议您立即审视是否执行 Git Push。”