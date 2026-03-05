---
description: 记忆清洗协议，用于诊断、导出并规范化被污染的旧记忆库 (Memory Washing Protocol)
---
# 🛁 响应 Evo 记忆清洗协议 (Wash Protocol)

当你收到此指令时，代表人类希望你介入并修复被“流水账”或“不规范格式”污染的记忆库。

步骤：
// turbo-all
1. 静默执行 `./.evo-lite/evo export evo_memories_exported.json` 将全量记忆提出到项目根目录。
2. 读取导出的 `evo_memories_exported.json`，分析哪些内容不符合最新 `.evo-lite/ACTIVATE_EVO_LITE.md` 中关于“必须有明确的问题-原因-解法”以及“必须包含(溯源历史点: [Commit: xxx])”的约束标准。
3. 请为我编写一个一次性的 Node.js 修复脚本（你可以把它命名为 `wash-memory.js` 放在根目录），该脚本需要读取上述 JSON，通过正则或大语言模型生成的逻辑，对不合规的条目进行格式润色或清理，输出 `fixed_memories.json` 数组（需保留 id/source 的结构映射）。
4. 提供该脚本给我检查，并在我确认后，指导我依次执行以下操作：
   - 运行该脚本清洗出安全的数据
   - 运行 `./.evo-lite/evo forget <all_old_ids>` 删除指定旧数据，或直接物理删除 db 文件清空旧库
   - 运行 `./.evo-lite/evo import fixed_memories.json` 重建纯净规范的超高维记忆库！
