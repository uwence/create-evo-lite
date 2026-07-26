# ATTP 阶段一 dogfood 实测记录

- 日期:2026-07-25(§1–§4);2026-07-26 Gate 1 复审收口重测(§5)
- 宿主:Claude Code 2.1.218(§1–§4)/ 2.1.220(§5 及复验),行为一致
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
| ~~子目录 cwd 下仍生效~~ | **该验收项已撤销** —— 实测证伪,范围收窄为 root-launch-only,见 §5 |

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

Gate 1 收口后,`install` 与 `status` 各增一行适用范围提示(§5 的产物):

```
$ node .evo-lite/cli/memory.js takeover status --settings .claude/settings.json
installed: SessionStart, UserPromptSubmit | missing: PreToolUse
scope: root-launch-only — engages only when Claude Code starts in D:/Data/ProjectAgent/create-evo-lite
```

Gate 1 修订后的实景复验(2.1.220,项目根启动):`takeover probe` → `{"ok":true,"skipped":false,"reason":null}`;
receipt 5 → 6;`Cannot find module` 计数 0;两条 hook 均注入
(SessionStart 9301 chars / UserPromptSubmit 342 chars)。

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

## 5. 适用范围实测:root-launch-only(Gate 1 复审 P0-1 收口)

计划 Step 9 原断言「在子目录 cwd 下仍生效(证明宿主确实展开了 `$CLAUDE_PROJECT_DIR`)」。
**实测不成立**,且失败机制与首轮判断也不同。已按 Gate 1 裁定重跑三组对照。

- 宿主:Claude Code **2.1.220**(首轮 §1–§4 在 2.1.218,行为一致)
- 方法:同一提示词(「回答两个字:收到」),`--debug-file` 取 setting sources,
  以 **receipt 增量**作客观地面真值(receipt 恒写在 canonical project root,与启动 cwd 无关)

| 启动方式 | setting sources(debug 原文) | hook envelope | receipt |
|---|---|---|---|
| 项目根 `claude` | `C:\Users\uwenc\.claude\settings.json, D:\Data\ProjectAgent\create-evo-lite\.claude\settings.json, …settings.local.json` | 3 | 4 → 5 |
| `templates/` `claude` | `C:\Users\uwenc\.claude\settings.json`(**仅用户级**) | 0 | 5 → 5 |
| `templates/` + `--settings <root>/.claude/settings.json` | 同上 | **0(已执行但失败)** | 5 → 5 |
| `templates/` + `--settings` + `CLAUDE_PROJECT_DIR` 环境变量 | 同上 | 0(同样失败) | 5 → 5 |

两条**各自独立**、都锚定启动 cwd 的机制:

**机制 1 —— 项目设置按启动 cwd 定位,不向上查找。** 第二组的 setting sources 里根本没有项目
settings,hook 未注册。官方 permissions 文档称配置「从当前工作目录及其父目录发现」,与 2.1.220
实测冲突;按**宿主能力偏差**记录,不假定所有版本一致。

**机制 2 —— `$CLAUDE_PROJECT_DIR` 展开为启动 cwd,不是项目根。** 第三组是决定性证据:settings
已被显式喂入、hook **确实被调用了**,但命令解析到子目录:

```
Error: Cannot find module 'D:\Data\ProjectAgent\create-evo-lite\templates\.evo-lite\cli\takeover-adapter.js'
```

对照第一组的同一条命令(`grep 'takeover-adapter' dbg-root.log`):

```
[DEBUG] Hook SessionStart (node "$CLAUDE_PROJECT_DIR/.evo-lite/cli/takeover-adapter.js") provided additionalContext (9646 chars)
[DEBUG] Hook UserPromptSubmit (node "$CLAUDE_PROJECT_DIR/.evo-lite/cli/takeover-adapter.js") provided additionalContext (342 chars)
```

根启动日志 `Cannot find module` 计数 = **0**。

**推广边界(自限)**:第一、二组中 cwd 恰好等于项目 settings 所在目录,无法区分「展开为 cwd」
与「展开为项目根」;只有第三组能分辨。故结论仅在「settings 目录 ≠ 启动 cwd」这一实测配置下
成立,不作更强推广。

**Workaround:经测试不存在。** 显式 `--settings` 受机制 2 阻断;`CLAUDE_PROJECT_DIR` 环境变量
被宿主覆盖(第四组仍 3 个 module error、0 envelope)。因此 Gate 1 复审建议的「把显式
`--settings` 记为可选 workaround」**不成立**,不予记录 —— 它不但不恢复接管,还会让 hook
进程每轮真实报错。

**裁定落点(已写入):**

- 设计文档 §0.2「宿主契约勘误二」、计划 Global Constraints「启动 cwd 范围」;
- `takeover install` 与 `takeover status` 的 CLI 输出各增一行 scope 提示;
- 计划 Step 9 的错误断言已删除,改为「记录三组对照,仅项目根启动生效」;
- README 首次写入 ATTP 时必须同写该限制 —— 已挂为 Task 8 前置项(Gate 1 时 README
  尚无任何 ATTP 章节,无可修正文案)。
- **用户级 `~/.claude/settings.json` 安装不予采纳**:既扩散项目专属 hook 到所有项目,
  又受机制 2 制约在子目录下依然不工作。

## 6. 本轮 dogfood 未覆盖

- `PreToolUse` 守卫:阶段二内容,未安装、未验证。
- 压缩后重注入(`SessionStart(compact)`):未构造长会话触发。
- 多会话并发:未测。
