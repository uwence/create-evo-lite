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
   观察 CLI 输出，确认所有有效语义碎片已被成功重新提取与 Embedding，并注意是否有损坏档案被跳过待修。确认无误后宣告当前重铸结果与剩余待修项。
