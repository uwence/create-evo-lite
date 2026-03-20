---
description: 记忆清洗与脑区重铸协议 (Brain Rebuild Protocol)
---
# 🛁 响应 Evo 记忆清洗协议 (Wash Protocol)

当你收到此指令时，代表我们需要对向量记忆库进行重置或清洗。
**注意**：在当前 Evo-Lite 架构中，`raw_memory/` 目录下的 Markdown 档案是**结构化归档路径**的真理源，但并不自动覆盖所有 `remember` 直写数据库的记忆。

// turbo-all
**执行步骤 (严格按顺序执行):**

1. **原始库审查 (Audit)**:
   前往 `.evo-lite/raw_memory/` 目录，检查档案格式是否规范（至少应包含 frontmatter 中的 `id/timestamp/type` 字段，以及与类型匹配的结构化二级标题，如 `## 现象 (Symptom)` / `## 解决方案 (Solution)` 或 `## 实现细节 (Implementation)` / `## 架构决策 (Architecture)`）。
   *命名规范：建议采用 `YYYY-MM-DDTHH-mm-ss-SSSZ-UUID.md` 格式，确保档案按时间线自然排序。*

2. **人工/AI 修复 (Fix)**:
   直接使用编辑器打开并修改有误的 Markdown 文件。

3. **物理重铸 (Rebuild)**:
   当档案修复完成后，请直接使用标准重建入口：

   ```bash
   node .evo-lite/cli/memory.js rebuild
   ```

   当前 `rebuild` 会调用底层的 `vectorize` 管线：先备份旧 `memory.db`，再依据 `raw_memory/` 中的结构化档案重建数据库与向量标记。
   不要再手工删除 `memory.db` 或 `vect_memory/*`，以免绕过备份保护并误清仅存在数据库中的轻量缓存。

4. **确认与汇报 (Handover)**:
   不要只说“重建完成”。最终汇报至少要明确 4 件事：

   1. **原始档案状态**：这次是否仍有损坏的 `raw_memory` 档案被跳过待修。
   2. **重建结果**：`rebuild` 是否真的完成，处理了多少 archive / chunk，是否生成了备份。
   3. **记忆边界**：如本次重建只覆盖结构化归档路径，要明确提醒 `remember` 直写数据库的轻量缓存不在完全保证范围内。
   4. **最小下一步**：告诉 User 现在可以继续开发，还是应该先修剩余坏档案 / 再跑一次 `verify`。

   推荐口径：

   - 当损坏档案已清空、`rebuild` 成功、`verify` 也无活跃告警时，再说“本次脑区重铸已可靠完成”。
   - 当仍有坏档案、跳过项或未验证状态时，只能说“重建已执行，但仍有待修项”，不得报成完全恢复。
