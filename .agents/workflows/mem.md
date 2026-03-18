---
description: 状态重置、项目跃迁与挂起发布协议
---
# 📦 挂起发布与跃迁协议 (/mem)

**使用场景**:
本协议为**低频核心协议**。仅在功能迭代彻底结束、Backlog 清空、或你需要结束当前工作会话（准备让 User 休息或跨设备同步）时才被调用。

⚠️ **警告**: 如果你的目的是闭环单个 Bug 修复或某个小任务，**请使用 `/commit` 协议，不要使用本协议！**

// turbo-all
**执行步骤 (严格按顺序执行):**

1. 全局审查 (Global Audit)
   确保 `active_context.md` 中的 `FOCUS` 目标已经全部达成。如果 Backlog 尚未清空，你必须警告 User，并询问是否确定要在此刻强制挂起会话。

2. 显性单据覆写 (Update META)
   使用文件编辑工具修改本项目根目录下的 `.evo-lite/active_context.md`。
   - [A. 元数据 `META`]: 修改 `<!-- BEGIN_META -->` 与 `<!-- END_META -->` 之间的 `> **更新时间**:` 为当前时间，并更新 `> **项目状态**:`。
   - [B. 焦点 `FOCUS`]: 描述下一个会话或者接下来的长远打算。

3. 项目版本小跃迁 (Bump Version)
   修订 `package.json` 中的 `version` 字段。若无重大重构，增加末尾修订号（Patch）。禁止修改 `.evo-lite/package.json`（若存在）。

4. 版本快照与打 Tag (Release Handover)
   若执行了第 3 步的版本号变动：
   ```bash
   git add .
   git commit -m "chore(release): bump version to v1.0.X"
   git tag -a v1.0.X -m "Release v1.0.X"
   ```

5. 状态机跳变反馈 (Mandatory Output)
   向 Master 宣告："交接协议已执行完毕。本次会话已彻底闭环与挂起。请问 Master 是否立即执行 Git Push 同步至远端？"
