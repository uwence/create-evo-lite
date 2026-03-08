# PROJECT ARCHITECTURE & STANDARDS

**Core Stack**: 本项目全栈开发环境为 Next.js（前端）、Node.js（后端/网关）以及 Electron（桌面端）。
**TypeScript First**: 强制开启 TypeScript 严格模式 (`strict: true`)。必须显式定义 Interfaces 和 Types，严禁使用 `any` 绕过类型检查。
**Documentation**: 所有导出的核心逻辑和 API 路由必须使用 JSDoc/TSDoc。注释只解释“为什么这么设计 (Why)”，不解释“代码在做什么 (What)”。