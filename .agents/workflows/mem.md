---
description: 状态重置、跃迁、挂起发布协议
---
# 📦 挂起发布与跃迁协议 (/mem)

**使用场景**:
本协议属**低频核心协议**。只在功能迭代彻底收尾、Backlog 清空、或要结束当前工作会话（让 User 休息/跨设备同步）时用。

⚠️ **警告**: 目标若是闭环单个 Bug 或小任务，**用 `/commit` 协议，不要用本协议！**

// turbo-all
**执行步骤 (严格按顺序执行):**

1. 全局审查 (Global Audit)
   确认 `active_context.md` 里 `FOCUS` 已全部达成。若 Backlog 未清空，必须警告 User，并问是否确定此刻强制挂起会话。

2. 显性单据覆写 (Update META)
   优先用状态机 CLI 更新可代理区块，避免直接改锚点内容。
   - [A. 焦点 `FOCUS`]: 用当前宿主可用 `mem` 入口更新下一阶段焦点。
     Unix / Bash: `./.evo-lite/mem context focus "下一个会话的焦点"`
     Windows PowerShell / CMD: `.\.evo-lite\mem.cmd context focus "下一个会话的焦点"`
   - [B. 元数据 `META`]: 当前 CLI 还没专门 `META` 写入口；如确需改 `更新时间` 与 `项目状态`，只能在确认无对应 CLI 命令后，手动编辑 `<!-- BEGIN_META -->` 与 `<!-- END_META -->` 之间内容。

3. 项目版本小跃迁 (Bump Version)
   改 `package.json` 里 `version` 字段。若无大重构，末尾修订号 +1（Patch）。禁止改 `.evo-lite/package.json`（若存在）。

4. 版本快照与打 Tag (Release Handover)
   若第 3 步改了版本号：
   ```bash
   git add .
   git commit -m "chore(release): bump version to v1.0.X"
   git tag -a v1.0.X -m "Release v1.0.X"
   ```

5. 状态机跳变反馈 (Mandatory Output)
   不要只说“已挂起”。最终交接汇报至少讲清 4 件事：

   1. **会话状态**：这次是否真满足“准备挂起 / 结束会话”；若 backlog 未清空，要如实说。
   2. **显性状态**：下一阶段 `FOCUS` 是否已写入 `active_context.md`。
   3. **版本状态**：是否做了版本号跃迁、`git commit`、tag；若没做，也要明确说“本次未发布版本快照”。
   4. **最小下一步**：告诉 User 现在适合休息 / 切设备同步，还是还要先补 backlog / 版本 / push。

   推荐口径：

   - 当 backlog 已清空、焦点已切换、需要版本动作也已完成时，再说“本次会话已完成挂起交接”。
   - 当任一项未完成时，只能说“已完成部分挂起动作，仍有未闭环项”，不得把半完成状态说成彻底交接。
