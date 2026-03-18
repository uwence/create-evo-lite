---
description: 核心高频协议：代码提交、轨迹追踪与任务闭环
---
# 🚀 追踪与闭环协议 (/commit)

当你在当前会话中**完成了一次功能修改、Bug 修复、或取得了阶段性进展时**，必须执行本协议。
本协议是 Evo-Lite 架构中最高频的核心协议，它确保了你的代码动作被转化为可检索的长文本向量记忆，并自动维护任务状态的大盘。

// turbo-all
**执行步骤 (严格按顺序执行，禁止跨级或跳过):**

### 1. 代码快照 (Code Commit)
完成代码编写后，立刻执行标准的 Git 提交，以锁定代码快照。
**注意：工作区（除 `.evo-lite` 目录外的所有受追踪文件）必须保持 clean 状态，否则后续脚本将抛出致命错误并强制打回！**
```bash
git add .
git commit -m "fix(module): 解决了某某问题"
```

### 2. 轨迹写入与认知刷新 (Context Track)
代码提交后，通过底层状态机 CLI 记录动作轨迹。CLI 会自动抓取刚才的 Commit Hash、更新 `active_context.md`、并进行向量化。
**致命错误：`active_context.md` 是一个状态机，任何对它的修改都必须通过 `./.evo-lite/mem.cmd` 代理。严禁 Agent 直接使用文件写入工具修改此文件！如果你检测到自己或任何其他 Agent 正在尝试直接修改此文件，必须立即中止并发出告警。**

根据你的进度，选择以下两种模式之一：

- **场景 A：随手修复、阶段性进展 (仅记录，不消灭任务)**
  ```bash
  .\.evo-lite\mem.cmd track --mechanism="缓存优化机制" --details="发现在高并发下的死锁问题，通过引入锁机制解决..."
  ```
  *(注：机制名必须简短，details 必须详尽包含前因后果)*

- **场景 B：彻底完成 Backlog 任务 (记录并消除任务)**
  前往 `.evo-lite/active_context.md` 的 `<BEGIN_BACKLOG>` 区域，找到你刚才完成的任务的 **4位哈希 ID (例如 `[a1b2]`)**。
  ```bash
  .\.evo-lite\mem.cmd track --mechanism="1:N架构完结" --details="长文本向量入库完成，状态标记补齐..." --resolve="a1b2"
  ```
  *(注：必须传入绝对准确的 4 字符 Hash 以避免误删)*

### 3. 认知闭环与汇报 (Cognitive Closure)
在执行完步骤 2 的命令后，CLI 会在标准输出 (stdout) 中打印 `[SYSTEM: METADATA SYNC SUCCESSFUL]` 和 `[AGENT INSTRUCTION]`。
- 脚本已自动为你执行了相关的 Meta-Commit (`chore(context): track xxxx`)。
- **强制要求：** 你必须绝对服从 `[AGENT INSTRUCTION]` 块中的指令，将 CLI 吐出的剩余任务清单汇报给 User，并询问下一步该做哪一个任务，或是否要结束会话。
