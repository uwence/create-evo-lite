---
description: 记忆清洗与脑区重铸协议 (Brain Rebuild Protocol)
---
# 🛁 响应 Evo 脑区重铸协议 (Wash Protocol)

当你收到此指令时，代表我们需要对向量记忆库进行重置或清洗。
**注意**：在 Evo-Lite v2.0.0+ 架构中，`raw_memory/` 目录下的 Markdown 档案是唯一真理源 (Single Source of Truth)。

// turbo-all
**执行步骤 (严格按顺序执行):**

1. **原始库审查 (Audit)**:
   前往 `.evo-lite/raw_memory/` 目录，检查档案格式是否规范（必须包含 `## 原因` 等二级标题、`[Time]` 时间戳与 `[Commit: <hash>]` 溯源锚点）。
   *命名规范：建议采用 `YYYY-MM-DDTHH-mm-ss-SSSZ-UUID.md` 格式，确保档案按时间线自然排序。*

2. **人工/AI 修复 (Fix)**:
   直接使用编辑器打开并修改有误的 Markdown 文件。

3. **物理重铸 (Rebuild)**:
   当档案修复完成后，请在终端执行以下指令彻底重置数据库并自动重铸：

   ```bash
   # 1. 物理删除旧记忆脑区
   del /f /s /q .evo-lite\memory.db

   # 2. 清理向量缓存区
   del /f /s /q .evo-lite\vect_memory\*

   # 3. 触发交互式升维管线 (请按提示输入数字选择模型)
   node .evo-lite/cli/memory.js vectorize
   ```

4. **确认与汇报 (Handover)**:
   观察 CLI 输出，确认所有语义碎片已被成功重新提取与 Embedding。确认无误后宣告：“记忆脑区已重铸完毕，当前记忆库已恢复纯净状态。”
