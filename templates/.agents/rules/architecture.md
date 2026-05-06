# PROJECT ARCHITECTURE & STANDARDS

> [!NOTE]
> 本文件只保留项目的长期硬约束。工作流细节应放在 `.agents/workflows/`，实现细节应放在真实代码与运行时目录中。

## 1. 核心栈

- Language: [填写主语言，如 Node.js / Python / Go]
- Framework/runtime: [填写核心框架或运行时]
- Package manager: [填写包管理器]
- Storage/retrieval: [填写数据库或检索栈]

## 2. 模块边界

- `index.js` or entry file: [填写脚手架或主入口职责]
- `templates/`: [如适用，填写模板层职责]
- Active runtime directory: [如适用，填写实例运行时目录]
- `.agents/`: canonical protocol and workflow layer

## 3. 长期约束

- [填写代码风格、模块边界或性能约束]
- [填写不能绕过的状态机、CLI 或数据一致性约束]
- [填写目录纪律、依赖偏好或禁止事项]
