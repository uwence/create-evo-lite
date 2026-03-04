# 🧠 Evo-Lite Active Context

> **更新时间**: 2026-03-03
> **项目状态**: “吃自己的狗粮” - create-evo-lite 为自身初始化了记忆沙盒体系。

## 0. 🏛️ 项目核心技术铁律 (Tech Stack & Aesthetics)
本项目为底层的 Node.js CLI 工具，为了维护代码纯净度，必须严格遵守以下法则：
1. **运行环境**: 原生 Node.js (CommonJS 规范，保持最大兼容性，拒绝 Babel/Webpack 等构建工具污染)。
2. **包管理**: npm (原生支持即可，保持极简)。
3. **架构信条**: 
   - **绝对零污染**: 一切向量库或核心依赖，统统锁死在目标生成的 `.evo-lite` 独立沙盒内。禁止越权修改或依赖目标系统环境。
   - **防御性编程**: CLI 工具高度面向未知的终端环境与宿主系统，针对所有的 I/O (文件读写)、Stream(流控、终端交互) 和网络请求 (向大模型发包)，必须使用 `try/catch`，给出人类易读的中文降级报错，绝对不能让进程默默崩溃。

## 1. 🎯 核心目标与当前阶段
- **当前目标**: 持续打磨和迭代 `create-evo-lite` 骨架代码，使其成为 Agentic Workflow 的终极“记忆挂件”。确保各种极限边界测试顺利通过，准备发布 v1.0.3 版本。

## 2. 🚧 当前进度与任务
- [x] 完成了 npm 发布与 `index.js` CLI 初始化剧本。
- [x] 为本仓库（Evo-Lite 的老家）植入了 Evo-Lite 记忆芯片。
- [x] **v1.0.3 核心升级实装**：
  - 优化了用户交互体验：优雅拦截了 `readline` 过程中的 `Ctrl+C` (\`ABORT_ERR\`) 中断异常。
  - 增强了极限环境容错：实装了 `npm install` 失败后的“脱机离线包兜底方案”。
- [x] **v1.1.0 记忆库大盘与 CLI 增强**：
  - `memory.js` 新增了 5 大高级子命令 (`forget`, `stats`, `export`, `import`, `compact`)。
  - 实现了 `compact` 时动态提取嗅探 LM Studio 当前正在运行的对话大模型 ID，并在 `verify` 命令中同步展示。
  - 实装本地模型 Lazy Loading 过慢时的“指数补偿等待机制”。
  - 当无任何模型或连接失败时，激活 **“纯文本/脱机降级兜底方案”** (`offline_memories.json` + `SQLite LIKE` 提取)，并引导大模型在 IDE 宿主终端内人机协作。
  - 实装 **向后兼容无损热更新协议 (Seamless Upgrade)**，确保 `active_context.md` 等被严格保护，旧环境模板被 `.bak` 备份，并附嵌智能体自动导读警报语。

## 3. ⏭️ 下一步行动
- [ ] 解决并绕过 GitHub Push 及 npm 发布阶段所遇到的外网/2FA 网络阻碍，完成项目的最终上线流转。
- [ ] 探究 `Cursor` 和 `Cline` 的差异化适配层 (v1.2.0)。