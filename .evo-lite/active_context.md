# 🧠 Evo-Lite Active Context

> **更新时间**: 2026-03-04
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
- [x] 完成了 v1.3.3 优化：彻底剥离已弃用的本地对话模型嗅探逻辑，并实装 CLI 初始化时的版本号展示与 package.json 注入。
- [x] 完成了 v1.3.4 规范：新增版本发布打标签协议 (Release Tagging Protocol)。
- [x] 完成了 v1.3.5 热修复：修正 API 探测成功后未及时关闭 socket 导致的延迟超时误报。
- [x] 完成了 v1.3.6 补完：同步补齐了实例层 (`.evo-lite/`) 的记忆蒸馏消歧规则，并固化版本。
- [x] 完成了 v1.3.7 铁壁：将“记忆蒸馏规范”从纯提示词软约束，升级为 `memory.js` 底层的**程序级致命防线**，彻底拦截无溯源与错误区间省略格式的劣质长文本入库，并同步精简了 `ACTIVATE_EVO_LITE.md` 的提示词长度。

## 3. 📝 下一步行动指南 (Next Actions)
- [x] **v1.3.14 洗盘协议 (Data Washing)**：
  - 针对项目根目录 `.evo-lite/memory.db` 实现了初始化阶段提示升级机制。
  - 创造性引入了 `/wash` 工作流，强制 AI 取代死板脚本，通过导出 json -> 大语言模型判断清洗规范化 -> 重新 import 建立清洁高维记忆。
- [x] **v1.3.15 NPM 拦截风暴**：
  - 创建了 `.npmignore` 防止 `memory_dump` 等脏数据泄露上传。
- [x] **v1.3.16-1.3.17 语义归置 (Semantic Refactoring)**：
  - 将数据库 CLI 的命令行缩写别名强约束从 `evo` 更正为符合直觉的 `mem` (Memory)。
  - 保留 `/evo` 为高维总架构和上下文激活唤醒词，二者形成了物理及设计逻辑的严格剥离。

## 4. ⏭️ 待处理与研究
- [ ] 确保用户终端成功通过 `npm login` 完成发布。
- [ ] 继续探究 `Cursor` 和 `Cline` 对 Evo-Lite 返回信息或上下文衔接逻辑层的差异化适配特性。