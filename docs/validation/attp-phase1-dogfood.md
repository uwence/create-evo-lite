# ATTP 阶段一 dogfood 实测记录

- 日期:2026-07-25
- 宿主:Claude Code 2.1.218(装机版)
- 仓库:`create-evo-lite`(母仓),分支 `main`
- 安装事件:`SessionStart` + `UserPromptSubmit`(`PreToolUse` 属阶段二,**未安装**)
- 命令入口:`node .evo-lite/cli/memory.js takeover …`(运行时镜像;`templates/cli/memory.js`
  无法作为入口运行 —— `better-sqlite3` 仅在 `.evo-lite/node_modules/` 可解析)

## 结论速览

| 验收项 | 结果 |
|---|---|
| 裸 prompt 下 Agent 自发进入项目接管 | **达成** |
| receipt 落 `committed`,身份字段齐全 | **达成** |
| 每轮 capsule `takeover-active`,预算内 | **达成**(454 / 1024 字节) |
| hook 进程 `exit 0`,stdout 只有 JSON | **达成** |
| 命令级 probe 在真实仓库通过 | **达成**(`skipped:false`) |
| **子目录 cwd 下仍生效** | **未达成 —— 计划该条假设有误,见 §5** |

---

## 1. 安装(事务化)

```
$ node .evo-lite/cli/memory.js takeover status --settings .claude/settings.json
installed: (none) | missing: SessionStart, UserPromptSubmit, PreToolUse

$ node .evo-lite/cli/memory.js takeover probe
{"ok":true,"skipped":false,"reason":null}

$ node .evo-lite/cli/memory.js takeover install --backup --events SessionStart,UserPromptSubmit --settings .claude/settings.json
🗄️  settings backed up: (no prior settings file)
✅ takeover hooks installed (SessionStart, UserPromptSubmit)

$ node .evo-lite/cli/memory.js takeover status --settings .claude/settings.json
installed: SessionStart, UserPromptSubmit | missing: PreToolUse
```

`probe` 的 `skipped:false` 是有分量的:它说明**将被写入 settings 的那条命令原文**确实在本机可发现的
POSIX shell 下跑通了,`$CLAUDE_PROJECT_DIR` 展开正常 —— 不是被跳过的乐观结论。

安装前仓库**不存在** `.claude/settings.json` 且未受版本控制,故备份 manifest 记为
`existed:false`(回滚 = 删除新建文件),不涉及任何既有用户配置。

## 2. 裸 prompt 接管(主证据)

提示词全文,**未提及 Evo-Lite、mem、active_context 或任何治理概念**:

> 分析当前项目正在做什么,下一步该做什么?

Agent 首轮直接产出(节选):

```
## 🎯 当前焦点
**[a177] mcp-zvec-lock 已完成并关闭**(main@79032cb)
- 三层锁协调机制已分发完成(母仓镜像 + CodePLC + hungersnakegame4 子仓)

## 📋 当前活跃任务(3项)
1. [agent-code-routing] — P2 最终债务
2. [c482 wiki-ux-debt] — Wiki 三项体验改进(不重开 4b-1)
3. [zvec-06-upgrade] — 核心依赖升级 (0.5.0→0.6)
   - 验证 isLockError 文案在 0.6.0 中是否一致
```

焦点行、三条 backlog 及其具体内容、乃至 zvec-06 的前置条件,均与 `active_context.md` 一致。
这正是 S9b 当初证伪的那件事 —— 彼时零竞争面下 Agent 仍不会自发发现治理面。

## 3. receipt

```json
{
 "state": "committed",
 "host": "claude-code",
 "sessionId": "c521abd1-debd-40fd-ab8b-5273f8d1a317",
 "projectRoot": "D:/Data/ProjectAgent/create-evo-lite",
 "focusHash": "18e2ec14037179d5",
 "sourceEvent": "SessionStart:startup",
 "generatedAt": "2026-07-25T14:43:18.953Z"
}
```

sessionId 是宿主真实会话 id;`projectRoot` 为 canonical 形式;`focusHash` 与下节 capsule 一致。

## 4. 每轮 capsule 与宿主退出码契约

```
$ echo '{"hook_event_name":"UserPromptSubmit","session_id":"c521abd1-…"}' | node .evo-lite/cli/takeover-adapter.js
exit=0
stdout parsed as ONE json object; top keys: hookSpecificOutput
capsule: {"evoLite":"takeover-active","project":"create-evo-lite","receipt":"valid",
          "focusHash":"18e2ec14037179d5","focus":"[a177] mcp-zvec-lock SHIPPED & CLOSED…"}
additionalContext bytes: 454 (budget 1024)
```

与官方契约一致:`exit 0`、stdout 仅一个 JSON 对象、capsule 合法且在 1 KiB 预算内。

## 5. 未达成项:子目录 cwd

计划 Step 9 断言「在子目录 cwd 下仍生效(证明宿主确实展开了 `$CLAUDE_PROJECT_DIR`)」。**实测不成立。**

对照实验(同一提示词,同一模型):

| 启动 cwd | 新增 receipt | 首轮回答 |
|---|---|---|
| 项目根 | 有(1 → 2) | 当前 focus,与 `active_context` 精确一致 |
| `templates/` | **无** | 陈旧内容,来自 recall 而非注入 |

结论:Claude Code 依启动 cwd 加载项目 `.claude/settings.json`。从子目录启动时,
`templates/.claude/settings.json` 不存在 → **项目级 hook 根本未加载** → ATTP 完全不参与。
这不是 `$CLAUDE_PROJECT_DIR` 展开失败,而是 hook 压根没被执行。

**影响(产品级,需在复审门裁定):**

- ATTP 只在「从项目根启动 Claude Code」时生效。`cd src && claude` 的用户得不到接管。
- 计划把这条写成 `$CLAUDE_PROJECT_DIR` 展开的证据,属**推断错误**:展开与否由 §1 的
  命令级 probe 与 §2/§4 的真实注入证明,与 cwd 无关。
- 可能的收口方向(均超出阶段一授权,留待裁定):① 文档明确「须从项目根启动」;
  ② 改用用户级 `~/.claude/settings.json` 安装(牵出跨项目污染问题);
  ③ 探测 Claude Code 是否支持从 git 根向上查找项目设置。

## 6. 本轮 dogfood 未覆盖

- `PreToolUse` 守卫:阶段二内容,未安装、未验证。
- 压缩后重注入(`SessionStart(compact)`):未构造长会话触发。
- 多会话并发:未测。
