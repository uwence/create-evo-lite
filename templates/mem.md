---
description: 状态保存、进度更新与记忆闭环交接协议
---
# 📦 进度存档与交接协议 (/mem)

当本会话完成独立功能点、Bug 修复，或需要主动结束当前工作闭环时，必须强制调用此协议，以确保上下文被安全存档。

// turbo-all
**执行步骤 (严格按顺序执行):**

1. 显性单据覆写 (Update Active Context)
   使用文件编辑工具修改本项目根目录下的 `.evo-lite/active_context.md`。该文件由 HTML 注释锚点划分为四个隔离区块，**必须严格按锚点边界操作，禁止跨区块写入**：

   - [A. 元数据 `META`]: 修改 `<!-- BEGIN_META -->` 与 `<!-- END_META -->` 之间的 `> **更新时间**:` 为当前时间，并按需更新 `> **项目状态**:`。
   - [B. 焦点 `FOCUS` (最高优先级)]: 精准定位 `<!-- BEGIN_FOCUS -->` 与 `<!-- END_FOCUS -->` 之间的内容，将其替换为当前工作断点的一句话描述（1-2 行）。**严禁在此区块外写入任何焦点描述。**
   - [C. 任务 `BACKLOG` (状态迁移)]: 精准定位 `<!-- BEGIN_BACKLOG -->` 与 `<!-- END_BACKLOG -->` 之间的内容：
     - **推荐直接用 CLI 命令（自动流转及归档）**:
       ```bash
       .\.evo-lite\mem.cmd context complete "提取词" --details="长篇详细记录与踩坑点（>40字并支持结构化入库）"
       .\.evo-lite\mem.cmd context add "新任务描述"
       ```
     - 或 AI 手动按锚点格式操作（仍允许）：
       - 将刚完成的任务行从此区块中**彻底删除**。
       - 若存在新任务，在末尾追加 `- [ ] 新任务描述`。
     - ⚠️ **硬上限**: 此区块内 `[ ]` 任务条数严禁超过 **5 条**。超出时必须先将最低优先级任务移入 `## 📌 架构备忘` 区域后再追加。
   - [D. 轨迹 `TRAJECTORY` (滚动队列)]: 精准定位 `<!-- BEGIN_TRAJECTORY -->` 与 `<!-- END_TRAJECTORY -->` 之间的内容：
     - 在**顶部**插入一行：`- [YYYY-MM-DD] 刚完成的任务摘要（一句话）`。
     - 若总条数超过 **3 条**，删除最旧的一条。

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
   向 Master 宣告："交接协议已执行完毕。Master，当前功能已闭环。建议您立即审视是否执行 Git Push。"