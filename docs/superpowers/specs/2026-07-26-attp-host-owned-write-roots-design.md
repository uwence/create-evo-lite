# ATTP 宿主自有写入根(host-owned write roots)设计

- 日期:2026-07-26
- 议题:`[db8a] [attp-guard-allowlist]`
- 授权状态:**设计阶段 AUTHORIZED;生产实现、测试、installer 改动、hive nurture 均 NOT AUTHORIZED**
- 运行时锚点证据:[`attp-guard-allowlist-step0-transcript-path.md`](../../validation/attp-guard-allowlist-step0-transcript-path.md)
  (Step 0,Claude Code 2.1.220,8 次真实 PreToolUse 捕获)
- 前置关系:本议题是 `[attp-hive-rollout]` 的**阻塞前置**。未关闭前不得向子仓分发 ATTP。
- 上游契约:[`2026-07-24-agent-takeover-trigger-protocol-design.md`](2026-07-24-agent-takeover-trigger-protocol-design.md)
  (ATTP,R8)。本文件**不重开**该设计,只在其 §0.3 已确立的守卫定位内增加一条窄例外。

---

## §1 问题

ATTP 的 PreToolUse 守卫按已批准契约拒绝一切项目外 `Edit`/`Write`。Claude Code 的
**项目级持久记忆目录**在 `~/.claude/projects/<project>/memory`,天然在项目外。于是:

> 装上 ATTP = 该项目里的 agent **写不了自己的跨会话记忆**。

这不是守卫实现错误。守卫执行的正是被批准的契约;是原设计**没有建模**「位于项目外、
但属于当前宿主 + 当前项目的受信写入根」这一类对象。

严重度定为 **P1 rollout blocker**:母仓可以人工绕过一次(已做,经显式授权),
子仓不行 —— 而子仓恰恰是最不容易发现记忆静默失效的地方。

## §2 非目标(承重,不得在后续实现中漂移)

- **不是通用路径白名单。** 不提供 `allow ~/.claude/projects/**`,不提供用户可配的 glob。
  一条窄兼容性例外一旦变成可配置通道,就等于取消了项目外 containment。
- **不重开 ATTP MVP。** Gate 1 / Gate 2 结论不变,`root-launch-only` 不变。
- **不改变守卫的定位。** 守卫仍是治理保证而非隔离边界:`Bash` 及其他工具照旧放行,
  本例外不使守卫成为安全隔离,也不得被描述成安全加固。
- **不猜 `<slug>` 编码。** 宿主 slug 的生成规则是宿主内部实现,不是契约。

## §3 信任锚:`transcript_path`

Step 0 已在真实 PreToolUse 输入中观测到该字段(8/8),并验证:

```text
hostProjectStateRoot = dirname(transcript_path)
allowedMemoryRoot    = dirname(transcript_path) / "memory"
```

- 同一项目的不同会话(交互会话 + 无头会话)导出**同一** root → 锚点绑定项目而非会话。
- 不同项目导出**互异** root → 无需实现 slug 编码。
- 母仓的派生结果精确命中真实记忆目录。

**`transcript_path` 是宿主输入锚,不是用户配置项。** 它只能来自当前事件;
不得从环境变量、settings、receipt 或任何持久化位置读取同名值。

## §4 派生:`deriveHostOwnedWriteRoots(hookInput)`

放在 `takeover-receipt.js`,与既有路径原语(`canonicalProjectRoot` / `realpathStrict` /
`normalize` / `pathEntryInfo`)同层,共用同一个 `fsOps` 注入 seam,便于 `__setFsOps` 直测。

返回结构与 `readMetaAnchor` 同形(永不返回 null,永不抛出到守卫之外):

```text
{ ok: boolean, reason: string|null, roots: string[] }
```

`ok:false` 时 `roots` 恒为 `[]`。**任何一条不满足即 `ok:false`,不启用例外:**

```text
- hookInput 不是对象
- transcript_path 不是自有属性 / 不是 string / 为空
- transcript_path 不是绝对路径
- dirname(transcript_path) 等于其自身(退化到根)
- dirname(transcript_path) 不存在,或 realpathStrict 失败
```

成功时 `roots = [ normalize(realpathStrict(dirname(transcript_path))) + '/memory' ]`。

注意:**只对 project-state root 做 realpath,不要求 `memory/` 已存在**。
新项目的首次记忆写入必然发生在 `memory/` 尚未创建时(见 §6),这是常态而非边角。

## §5 判定规则

守卫的三道门保持不变,本例外**只放宽第三道**(target-path),不放宽前两道:

```text
(a) receipt 必须 committed        —— 不变
(b) 治理健康检查                   —— 不变
(c) target-path                    —— 增加一条并列的允许根
```

**刻意选择:未接管的会话同样写不了记忆。** 例外解决的是「记忆目录在项目外」这一
路径问题,不是「无接管也该放行」。若放宽 (a)/(b),等于给出一条无需接管即可写盘的通道,
与 ATTP 的 P0(不可静默绕过)冲突。代价是首次接管失败时记忆也写不了 —— 可接受,
因为该状态本就有明确的恢复命令。

第三道门变为:

```text
resolved = 目标的物理归一化路径(见 §6)

allow ⟺
    resolved === projectRoot   或   resolved 位于 projectRoot + '/' 之下
  或
    resolved === allowedMemoryRoot 或 resolved 位于 allowedMemoryRoot + '/' 之下
```

**不得对 `~/.claude/projects` 下的 slug 做裸字符串前缀匹配。** 判定发生在
**`memory` 目录这一层**;project-state root 只是派生的中间量,永不直接参与包含判定。

理由不是理论洁癖 —— 本机 `~/.claude/projects/` 下**已经存在**两个与母仓 slug
构成前缀关系的目录(一个 git worktree、一个曾从 `templates/` 启动的会话),
其中后者是**单破折号** `-templates`。裸 `startsWith(A)` 会误纳 2 个;
`startsWith(A + '/')` 误纳 0 个。任何以母仓路径为前缀的兄弟目录、worktree
或子目录启动都会再生成一个。

## §6 物理归一化:必须回拼未存在的尾部

这是本设计**唯一需要改动既有守卫逻辑**的地方,也是朴素实现必然踩空的地方。

守卫当前的做法是:向上走到最近**条目存在**的一层(用 `lstat` 而非 `exists`,
以免断链 symlink 被当成"还没建的文件"而放行),`realpathStrict` 之,然后拿
**那个祖先**与 `projectRoot` 比较 —— **不回拼剩余路径**。

对项目包含判定这没有问题:祖先仍在项目内。但对 memory 例外会致命:

```text
写 <stateRoot>/memory/new.md,而 memory/ 尚不存在
  → 祖先退到 <stateRoot>
  → <stateRoot> 不在 <stateRoot>/memory 之下
  → deny
```

即**每个新项目的第一次记忆写入都会被拒**。子仓 rollout 时这是常态。

修法:保留祖先上溯(它提供的是物理安全 —— symlink / junction / 断链的真实解析),
但把比较对象换成 **「已物理验证的前缀 + 回拼的未存在尾部」**:

```text
resolvePhysicalPath(target):
    向上找最近存在条目 anc(lstat 语义不变)
    anc 无法 realpath → 失败(deny)
    resolved = normalize(realpathStrict(anc)) + 剩余相对尾部
```

`takeover-install.js` 的 `resolveManagedSettingsPath` 已有同形算法(R6 P0-2:
"不存在则逐级找最近存在祖先 realpath 后再拼回尾部"),应抽出共用而非再写一份。

**对既有项目判定必须是保持裁决不变的(verdict-preserving)。** 论证:回拼只是把
「祖先」换成「祖先 + 尾部」,而尾部是相对片段,不改变所属根 ——
`<projectRoot>/a/new.js` 仍在项目内;逃逸路径的祖先在项目外,回拼后仍在项目外;
断链与 realpath 失败仍在上溯阶段就 deny。**但这只是论证,不是证据。**
验收要求是既有 `T-takeover-target-path` / `T-takeover-guard` / `T-takeover-session-scope`
全套原样通过,一条不改。

## §7 fail-closed 语义

```text
transcript_path 缺失 / 类型不对 / 非绝对        → 不启用例外,按原规则判定(通常 deny)
dirname 不存在 / realpath 失败                  → 不启用例外
目标解析失败(权限 / 断链 / 不可解析 junction)  → deny(与现状一致)
派生函数内部异常                                → deny(守卫外层 catch,现状不变)
宿主版本变化导致字段消失                        → 退回"无例外"的 fail-closed 状态,
                                                  绝不退回宽白名单
```

**降级方向只有一个:更严,不更松。** 任何"锚点不可用时放宽"的分支都是本设计的反面。

## §8 回归契约

```text
项目内代码文件                                    allow
项目外普通文件                                    deny
当前 transcript 对应的 memory/MEMORY.md           allow
当前 memory 下新建文件(memory/ 已存在)           allow
当前 memory 下新建文件(memory/ 尚不存在)         allow   ← §6,朴素实现会 deny
其他项目的 memory                                 deny
与本项目 slug 构成前缀关系的项目的 memory         deny    ← §5,本机已有 2 个真实实例
<slug> 下的非 memory 路径(如 transcript 本身)    deny
memory/../escape                                  deny
memory 内 symlink / junction 指向外部             deny
transcript_path 缺失                              deny
transcript_path 非 string / 非绝对                deny
Windows 大小写变体(小写盘符等)                  不得扩大权限
Unicode case-fold 变体(U+212A 等)               不得扩大权限
```

每条注入/派生的消费都必须有能杀死「该步未执行」变异体的承重断言;
下游状态不足以证明消费时,加显式计数(ATTP Gate 2 P1-1 的教训)。

**另需一次真实证据:** 在真实 Claude Code 会话中完成一次跨会话 memory 写入,
不能只喂 adapter JSON。这是本议题的验收终局门。

## §9 实施前必须补的观测(Step 0b)

**子 agent 的 `transcript_path` 指向何处,尚未观测。** Step 0 只覆盖了主会话
(交互 + 无头)。若子 agent 的工具调用携带的是它自己的、位于**不同** project-state
目录的 transcript,则子 agent 的记忆写入会被拒 —— 而 subagent-driven-development
正是本项目的主力工作流。

这条不确定性**不得靠推理消解**(ATTP 已经因为"从文档推出子目录仍生效"付过一次代价)。
实施授权前应追加一次窄观测,方法与 Step 0 相同。

## §10 开放问题

1. `resolvePhysicalPath` 抽取后,`takeover-install.js` 与 `takeover-adapter.js`
   共用同一实现,还是各自保留?倾向共用,但会触及 Gate 1 已验收的 installer 代码,
   需要在计划阶段单独定范围。
2. 例外是否需要在 `takeover status` / installer 输出中显式声明?
   倾向需要 —— 用户应当能看出守卫放行了哪些项目外根。
3. README 是否需要同步(当前 README 明确写"项目外 Edit/Write 会被 deny")。
   一旦例外落地,该表述变得不准确,须同步修正。
