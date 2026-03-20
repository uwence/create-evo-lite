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
   优先通过状态机 CLI 更新可代理的区块，避免直接编辑锚点内容。
   - [A. 焦点 `FOCUS`]: 使用当前宿主可用的 `mem` 入口更新下一阶段焦点。
     Unix / Bash: `./.evo-lite/mem context focus "下一个会话的焦点"`
     Windows PowerShell / CMD: `.\.evo-lite\mem.cmd context focus "下一个会话的焦点"`
   - [B. 元数据 `META`]: 当前 CLI 还未提供专门的 `META` 写入口，如确需修改 `更新时间` 与 `项目状态`，只能在确认无对应 CLI 命令的前提下手动编辑 `<!-- BEGIN_META -->` 与 `<!-- END_META -->` 之间的内容。

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
   不要只输出一句“已挂起”。最终交接汇报至少要明确 4 件事：

   1. **会话状态**：这次是否真的满足“准备挂起 / 结束会话”的条件；若 backlog 未清空，要如实说明。
   2. **显性状态**：下一阶段 `FOCUS` 是否已经写入 `active_context.md`。
   3. **版本状态**：是否执行了版本号跃迁、`git commit`、tag；若没做，也要明确说“本次未发布版本快照”。
   4. **最小下一步**：告诉 User 现在是适合休息 / 切设备同步，还是还需要先补 backlog / 版本 / push。

   推荐口径：

   - 当 backlog 已清空、焦点已切换、需要的版本动作也已完成时，再说“本次会话已完成挂起交接”。
   - 当其中任何一项未完成时，只能说“已完成部分挂起动作，仍有未闭环项”，不得把半完成状态说成彻底交接。
