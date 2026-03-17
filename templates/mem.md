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
   - [C. 任务 `BACKLOG` (状态迁移)]: **必须强制使用 CLI 命令完成自动流转与归档**，严禁 AI 越过 CLI 手动修改此区块：
     ```bash
     .\.evo-lite\mem.cmd context complete "提取词" --details="长篇详细记录与踩坑点（>40字并支持结构化入库）"
     .\.evo-lite\mem.cmd context add "新任务描述"
     ```
     - ⚠️ **硬上限**: 此区块内任务条数严禁超过 **5 条**。若需新增任务且达到上限，请先将最低优先级任务手动移入末尾无锚点保护的备忘区后，再使用 `context add`。
   - [D. 轨迹 `TRAJECTORY` (滚动队列)]:
     - 执行上述 `context complete` 命令后，系统会**自动将完成的任务移入此区块**并维持最近 10 条的滚动上限，因此 AI **无需手动干预此区块**。

2. 项目版本小跃迁 (Bump Version)
   修订 `package.json` 中的 `version` 字段。若无重大重构，增加末尾修订号（Patch），禁止修改 `.evo-lite/package.json`（若存在）。

3. 版本快照约束与入库 (Git Commit)
   执行修改文件的入库提交，务必遵守 Conventional Commits 规范：
   ```bash
   git add .
   git commit -m "chore(docs): 你的提交信息"
   ```

4. 经验向量记忆入库 (强制规范)
   根据当前 RAG 架构，**只有生成在 `.evo-lite/raw_memory/` 目录下的结构化 Markdown 文件才会被进行 1:N 向量化索引。**
   若本次开发中有不包含在上述 `context complete` 内的独立长篇经验（如架构选型心得、外部方案借鉴等），你有两种方式处理：
   - **方式一 (推荐)**：使用 CLI 命令自动生成归档并立刻入库：
     ```bash
     .\.evo-lite\mem.cmd archive "你的长篇经验或核心总结，详细描述问题与解决方案。" --type=note
     ```
   - **方式二 (手动补录)**：如果你手动在 `raw_memory/` 下创建了 Markdown 文件或者修改了已有文件，你**必须**执行一次全量增量同步轮询：
     ```bash
     .\.evo-lite\mem.cmd sync
     ```
   *(注: 系统底层通过 `vect_memory` 下的同名空文件作为追踪标识，执行 `sync` 命令会自动对所有未向量化的文件执行分块入库并打上标记)*

5. 打 Tag 并汇报 (Final Handover)
   若执行了第 2 步的版本号变动，必须打好 Git Tag：
   ```bash
   git tag -a v1.0.X -m "Release vX"
   ```

6. 状态机跳变反馈 (Mandatory Output)
   向 Master 宣告："交接协议已执行完毕。Master，当前功能已闭环。建议您立即审视是否执行 Git Push。"
