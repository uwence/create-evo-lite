---
description: 记忆清洗与脑区重铸协议 (Brain Rebuild Protocol)
---
# 🛁 响应 Evo 记忆清洗协议 (Wash Protocol)

收到指令 = 需重置/清洗本地记忆索引。  
**注意**：当前 Evo-Lite 架构里，`raw_memory/` 下 Markdown 档案是**结构化归档路径**真源，但不自动覆盖所有 `remember` 直写数据库记忆。

// turbo-all
**执行步骤 (严格按顺序执行):**

1. **原始库审查 (Audit)**:
   去 `.evo-lite/raw_memory/` 看档案格式是否规范（至少要有 frontmatter 里 `id/timestamp/type` 字段，还有匹配类型结构化二级标题，如 `## 现象 (Symptom)` / `## 解决方案 (Solution)` 或 `## 实现细节 (Implementation)` / `## 架构决策 (Architecture)`）。  
   *命名规范：统一用 `mem_YYYY-MM-DD_HH-mm-ss_<commit>_<random>.md` 格式，时间线和来源可追。*

2. **人工/AI 修复 (Fix)**:
   直接用编辑器打开，改错 Markdown 文件。

3. **物理重铸 (Rebuild)**:
   档案修好后，直接用标准重建入口：

   ```bash
   node .evo-lite/cli/memory.js rebuild
   ```

   当前 `rebuild` 会走兼容别名仍叫 `vectorize` 的本地重建管线：先备份旧 `memory.db`，再按 `raw_memory/` 里结构化档案重建数据库和 FTS/index 标记。  
   不要手工删 `memory.db` 或 `index_memory/*` / 旧 `vect_memory/*`，免绕过备份保护，也别误清只在数据库里的轻量缓存。

4. **确认与汇报 (Handover)**:
   不要只说“重建完成”。最终汇报至少要讲清 4 件事：

   1. **原始档案状态**：这次还有没有坏 `raw_memory` 档案被跳过待修。
   2. **重建结果**：`rebuild` 是否真完成，处理多少 archive / chunk，是否生成备份。
   3. **记忆边界**：如本次只覆盖结构化归档路径，要明确说 `remember` 直写数据库的轻量缓存不在完全保证范围内。
   4. **最小下一步**：告诉 User 现在能继续开发，还是要先修剩余坏档案 / 再跑一次 `verify`。

   推荐口径：

   - 当坏档案已清空、`rebuild` 成功、`verify` 也无活跃告警时，再说“本次脑区重铸已可靠完成”。
   - 当还有坏档案、跳过项或未验证状态时，只能说“重建已执行，但仍有待修项”，不能报成完全恢复。
