# 🧠 Evo-Lite Active Context (EvoRouter)

> **更新时间**: 2026-03-08
> **项目状态**: v1.4.2 正式发布。修复了精排模型兼容性死角与“伪 200”探活误报。

## 1. 🎯 核心目标
- **工程愿景**: 持续打磨和迭代 `create-evo-lite` 骨架代码，使其成为 Agentic Workflow 的终极“无感高压治理挂件”。确保其具备高度的稳定性、跨平台容错性以及极低的侵入感。

## 2. 🚧 当前进度与任务 (History)
- [x] v1.4.2 精排兼容性加固：
  - **精排功能修复**: 改进了 `getRerankedScores`，实现对 `.results` / `.data.results` 及原始数组格式的全面兼容。
  - **探测逻辑验身**: 在 `index.js` 探活中加入了 Body 级校验，可识别并拦截 LM Studio 等返回的“Unexpected endpoint”虚假成功响应。
  - **优雅降级**: 当检测到提供者不支持精排接口时，系统现在会给出精准诊断建议并平滑回退至向量检索，不再崩溃。
- [x] v1.4.1 核心修补与 Antigravity 适配。
  - **精排探活修复**: 修正了 `index.js` 探活请求中 Reranker 的 Payload 结构，消除了“模型在线但显示离线”的误报。
  - **术语对齐**: 统一了 `index.js` 与 `memory.js` 的状态提示术语为“向量模型”与“精排模型”。
  - **原生工作流强制**: 在 `evo-lite.md` 规则中明确阻断了 AI 使用 `dir /s /b` 等命令进行终端遍历，强制其通过 Antigravity 的原生视界进行文件操作。
  - **存档剧本升级**: 优化了 `/mem` 协议，将“版本小跃迁 (Bump Version)”由建议改为强制步骤。
  - **模板脱敏**: 将 `templates/rules/architecture.md` 还原为纯净的通用引导模板。

## 3. 📝 下一步行动指南 (Next Actions)
- [ ] 监控 v1.4.1 在复杂多智能体环境下的规则治理稳定性。
- [ ] 考虑下一步增加对 Python/Go 等非 Node 环境的轻量化适配支持。

## 4. 📌 架构备忘录 / 搁置区 (Backlog & Ideas)
- 这里用于存放触发的灵感、架构备忘或暂时搁置低优先级的任务，防止遗忘且不干扰主线。