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

## 1. 🎯 核心目标
- **工程愿景**: 持续打磨和迭代 `create-evo-lite` 骨架代码，使其成为 Agentic Workflow 的终极“无感记忆挂件”。确保其具备高度的稳定性、跨平台容错性以及极低的侵入感。

## 2. 🚧 当前进度与任务
- [x] 完成了 npm 发布与 `index.js` CLI 初始化剧本。
- [x] 完成了核心防线 v1.0.3 的建设：Offline 编译回退与 Ctrl+C 取消捕捉。
- [x] 完成了 v1.1.0 重构：扩充 `stats/forget/compact/import/export` 五大本地指令，并实现了与 LM Studio 动态模型嗅探。
- [x] 完成了 v1.2.0 加固：解决 SQLite 并发 Locked、大记忆体 Compact 溢出 (Map-Reduce)、并防拆了 Shell 的 `--file` 传参机制。
- [x] 完成了 v1.3.0 增强：注入时空锚点 (Space-Time Git Hashes)，增加 AI 智能体戒律法则。
- [x] 完成了 v1.3.1 架构升维：剥离 `compact` 函数内部对本地小语言模型的依赖。改由 CLI 输出 `.evo-lite/MEMORIES_TO_COMPACT.md` 唤醒协议交接给高智商宿主 IDE Agent 代为进行深度的中文总结提炼。
- [x] 完成了 v1.3.2 热修复：修复 `compact` 数据结构缺少 ID 字段导致批量交接失败的隐患，并全盘演练验收。

## 3. 📝 下一步行动指南 (Next Actions)
- [x] **v1.1.0 记忆库大盘与 CLI 增强**：
  - `memory.js` 新增了 5 大高级子命令 (`forget`, `stats`, `export`, `import`, `compact`)。
  - 实现了 `compact` 时动态提取嗅探 LM Studio 当前正在运行的对话大模型 ID，并在 `verify` 命令中同步展示。
  - 实装本地模型 Lazy Loading 过慢时的“指数补偿等待机制”。
  - 当无任何模型或连接失败时，激活 **“纯文本/脱机降级兜底方案”** (`offline_memories.json` + `SQLite LIKE` 提取)，并引导大模型在 IDE 宿主终端内人机协作。
- [x] **v1.2.0 架构加固与体验进阶 (Fortification & Frictionless)**：
  - **抗脏数据 OOM 重整**：引入了 Sliding Window 分块加 Map-Reduce 归纳模式，重塑 `compact` 深度睡眠，解决多碎片一并喂给大模型导致的显存爆炸。
  - **高并发写防锁死降级**：通过给 `templates/memory.js` 的 SQLite 挂起 `PRAGMA journal_mode=WAL` 及 `busy_timeout=5000`，彻底免疫多 AI 大量并发 `remember` 时导致的锁库报错。
  - **特殊字符截断防护**：为 `remember` 与 `recall` 原生实装 CLI 的 `--file=<path>` 追加传参规避法则，防御从纯终端管道传输引起的文本单/双引号解析破损。

## 3. ⏭️ 下一步行动
- [ ] 解决并绕过 GitHub Push 及 npm 发布阶段所遇到的外网/2FA 网络阻碍，完成项目的最终上线流转。
- [ ] 继续探究 `Cursor` 和 `Cline` 对 Evo-Lite 返回信息或上下文衔接逻辑层的差异化适配特性。