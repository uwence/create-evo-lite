---
description: 记忆清洗协议，用于诊断、导出并规范化被污染的旧记忆库 (Memory Washing Protocol)
---
# 🛁 响应 Evo 记忆清洗协议 (Wash Protocol)

当你收到此指令时，代表人类希望你介入并修复被“流水账”或“不规范格式”污染的记忆库。

**步骤：**
// turbo-all
1. 执行 `./.evo-lite/mem.cmd export evo_memories_exported.json` 将全量记忆导出到项目根目录。
2. 读取导出的 `evo_memories_exported.json`，根据 `.evo-lite/active_context.md` 中的最新规范（必须包含 `[Time]` 时间戳与 `[Commit: <hash>]` 锚点）进行分析。
3. 请编写一个一次性的 Node.js 修复脚本（`wash-memory.js`），读取上述 JSON，根据新的格式规范进行修复，输出 `fixed_memories.json`。
4. 待我确认脚本逻辑后，依次执行：
   - 运行该脚本清洗出安全的数据。
   - 运行 `./.evo-lite/mem.cmd forget <all_old_ids>` 删除旧垃圾数据。
   - 运行 `./.evo-lite/mem.cmd import fixed_memories.json` 重建纯净规范的超高维记忆库。
