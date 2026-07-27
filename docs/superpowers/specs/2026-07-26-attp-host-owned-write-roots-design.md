# ATTP 宿主自有写入根(host-owned write roots)设计

- 日期:2026-07-26
- 议题:`[db8a] [attp-guard-allowlist]`
- 授权状态:**设计阶段 + 设计修订 AUTHORIZED;实施计划、生产实现/测试、installer 重构、
  子仓分发、hive nurture 均 NOT AUTHORIZED**
- 运行时锚点证据:
  - [`attp-guard-allowlist-step0-transcript-path.md`](../../validation/attp-guard-allowlist-step0-transcript-path.md)
    (Step 0,主会话,Claude Code 2.1.220,8 次真实 PreToolUse 捕获)
  - [`attp-guard-allowlist-step0b-subagent-correlation.md`](../../validation/attp-guard-allowlist-step0b-subagent-correlation.md)
    (Step 0b,真实 subagent 关联观测,判定**分支 A**,见 §9)
  - [`attp-guard-allowlist-acceptance.md`](../../validation/attp-guard-allowlist-acceptance.md)
    (Task 8,单工作树拓扑双会话实景验收)
  - [`attp-guard-allowlist-step0c-worktree-memory-identity.md`](../../validation/attp-guard-allowlist-step0c-worktree-memory-identity.md)
    (Step 0c,linked worktree 记忆身份观测,终止分支 **B ∧ C**,冻结 §2.1 的支持拓扑)
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

### §2.1 支持拓扑(**Step 0c 后冻结**)

本例外的适用范围是**有条件的**,条件由宿主的 project 身份语义决定,不由本设计决定。
证据:[`attp-guard-allowlist-step0c-worktree-memory-identity.md`](../../validation/attp-guard-allowlist-step0c-worktree-memory-identity.md)。

```text
单工作树仓库(普通 clone)              SUPPORTED
独立项目副本 / 独立 git init            SUPPORTED
git linked worktree                     UNSUPPORTED（Claude Code 2.1.220）
```

linked worktree 中,宿主对 **transcript** 用当前 worktree 的身份、对 **memory** 用
主工作树的身份,两者不同源;且该重定向**不稳定** —— 同一物理目录换成小写路径拼写启动时
重定向消失。判定条件不在 hook 可见输入里,也无法由 Git identity 安全补足(§2 的
「不猜 slug」在此依然承重,且观测证明该编码有损:非 ASCII 字符会塌缩)。

**因此 mismatch 必须 fail-closed:**

```text
target 与当前事件派生根一致    → 可以放行
两者不一致                    → 必须拒绝
为提高可用性去猜第二个根       → 禁止（会同时造成扩权与失效）
```

「UNSUPPORTED」不等于无条件拒绝一切 linked worktree —— 它等于:守卫在该拓扑下只按同一条
安全证明工作,证明不成立就拒绝,代价是该拓扑下宿主持久记忆不可用。这是**已记录的限制**,
不是静默失败。

重新进入 linked worktree 设计的条件见 `spec:attp-linked-worktree-memory-identity`
(residual,blocked-upstream)。宿主版本变化之前,不再做 slug 逆向或路径探测实验。

## §3 信任锚:`transcript_path`

Step 0 已在真实 PreToolUse 输入中观测到该字段(8/8),并验证:

```text
hostProjectStateRoot = dirname(transcript_path)
allowedMemoryRoot    = dirname(transcript_path) / "memory"
```

- 同一项目的不同会话(交互会话 + 无头会话)导出**同一** root → 锚点绑定项目而非会话。
- 不同项目导出**互异** root → 无需实现 slug 编码。
- 母仓的派生结果精确命中真实记忆目录。

以上三条在 **§2.1 列为 SUPPORTED 的拓扑内**成立。Step 0c 已证明:在 git linked worktree 中,
`dirname(transcript_path)` 指向当前 worktree 的 project-state,而宿主使用的是主工作树的
project-state —— 单锚在该拓扑下被真实宿主行为证伪。这不是锚点选错,而是宿主的 memory
身份本身没有稳定契约(§2.1)。

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

关于「`memory/` 尚未创建」的实景修正(Step 0c 观测):**当前宿主(Claude Code 2.1.220)
会在 SessionStart 阶段自行创建空的 `memory/`**,因此 agent 侧真实遇到的首次写入是
「`memory/` 已存在、**目标文件**尚不存在」的单级尾部再拼。「`memory/` 整体不存在时的
多级尾部再拼」在真实宿主中**未被观察到**,只有自动化回归证据(见 §8.1)。
该能力仍然正确且必要 —— 它是宿主行为变化时的防御性下界,不得因未被实景触发而移除 ——
但不得再被描述为「已获得真实宿主证据」。

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

### §6.1 原语归属(冻结,不留给实现者现场决定)

`takeover-install.js:217` 的 `resolveManagedSettingsPath` 已有同形算法(R6 P0-2)。
两处**必须共用同一实现**,归属冻结如下:

```text
新增模块  templates/cli/takeover-physical-path.js
导出      resolvePhysicalPath(target, fsOps)
```

模块必须是 **dependency-neutral**:

```text
- 不 require runtime.js / receipt / installer / memory service
- 只 require node 内置 path
- 不持有任何模块级可变 fs seam;fsOps 由调用方每次显式传入
- 用 lstat 语义寻找最近存在条目(断链 symlink 算"存在",不得退到父目录)
- realpath 失败、断链、权限错误一律【抛出】,由调用方 fail-closed
- 回拼的 tail 只能来自已 path.resolve() 的绝对目标
- 返回:已物理验证前缀 + 未存在尾部,绝对路径
```

调用关系(单向,无反向耦合):

```text
takeover-receipt.js   → 传入自己的模块级 fsOps seam;可按需 re-export 给 adapter
takeover-install.js   → 直接传入其既有的函数级 fsOps 参数
takeover-adapter.js   → 经 receipt,不直接依赖 installer
```

**不让 `takeover-install.js` 去 import `takeover-receipt.js`。** 已核对:receipt 持有
模块级可变 `let fsOps`(`takeover-receipt.js:24`)、`require('./runtime')` 以及治理状态职责;
installer 则是函数级 `fsOps = fs` 参数(`readSettingsStrict` / `managedSettingsPath` /
`resolveManagedSettingsPath` 等)。把 installer 绑进 receipt 会制造不必要的反向耦合,
并让 installer 继承一个它无权控制的全局 seam。

### §6.2 两处 lstat 语义的差异必须先合一

这不是重命名,是一处真实的行为合并,必须有测试证据:

```text
receipt.pathEntryInfo   纯 lstat:断链 symlink → exists:true → 随后 realpath 抛错 → deny
installer 的循环        existsSync 先行(跟随链接,断链返回 false),
                        再用 lstat 补判 dangling,抛 "is a broken link; refusing to touch settings"
```

原语只能保留一种,取 receipt 的纯 lstat 语义(更简单、且严格不弱)。

#### §6.2.1 勘误(计划阶段源码核对,推翻本节初稿的「结论一致」表述)

本节初稿写的是「两者结论一致(都 fail-closed),但机制与错误文案不同」。
逐行核对 `takeover-install.js:222-231` 后,**该表述被证伪**:

```text
在 ENOENT、断链 symlink、普通 realpath 失败三种输入下,两者确实都 fail-closed。

但对【非 ENOENT 的 lstat 错误】(EACCES / EPERM / EIO / …):
    installer  existsSync → false（无权限时也返回 false）
               try { lstatSync(...) } catch (_) { dangling = false }   ← 错误被【吞掉】
               → 当作"还没建的文件"继续向上走,可能最终成功返回一个路径
    receipt    非 ENOENT 一律 throw（"权限等异常不得当成不存在"）
```

即 installer 在这一类输入下存在既有的 **fail-open-ish 漂移**。

**裁定(实施计划复审):统一采用 receipt 的严格语义。**

```text
installer 遇到非 ENOENT 的 lstat 错误 → 立即 fail-closed,不得当作路径不存在继续上溯
onStatError: 'treat-as-missing'        → NOT ALLOWED（不给原语加宽松模式开关）
```

理由:「不存在」与「无法证明存在状态」是两个不同事实;`EACCES`/`EPERM` 下已经失去了
构造物理路径证明的能力,继续上溯等于用一个更远的祖先替代不可验证的路径段;而 installer
的写入对象是 `.claude/settings.json`,不应在路径证明不完整时继续。给原语加模式开关会让它
同时承载安全与宽松两套语义,削弱它作为单一物理路径原语的价值。

**这是一次经复审授权的 installer 安全收紧,不属于 verdict-preserving 范围。**
§6 的 verdict-preserving 要求继续适用于:正常项目路径、ENOENT 尾部、symlink / junction、
以及既有的各条失败分支;**唯独不适用于**这一个已明确批准修正的 `STAT_FAILED` 场景。

由此产生一条硬约束:**installer 的既有错误文案契约不得漂移。** 实现上,原语抛带
`code` 的错误,installer 捕获后按 code 重新抛出它现有的原文消息。taxonomy 冻结为五项:

```text
ATTP_NOT_ABSOLUTE          目标不是绝对路径（相对性解析属于调用方，原语不代劳）
ATTP_NO_EXISTING_ANCESTOR  一路 ENOENT 走到文件系统根
ATTP_BROKEN_LINK           条目是 symlink 且 realpath 失败于 ENOENT / ENOTDIR
ATTP_REALPATH_FAILED       其余 realpath 失败（含 symlink 的 EACCES/EPERM/ELOOP/EIO）
ATTP_STAT_FAILED           lstat 失败于非 ENOENT
```

每个错误携带 `code` / `target`(调用方请求的完整绝对路径,恒定)/ `probe`(实际失败的那一级祖先)
/ `cause`(底层 fs Error)。`target` 与 `probe` 是两个不同的诊断事实,**不得写成同一个值**
—— 上溯过 ≥1 级后,只有 `target` 还保留调用方原本请求的路径,而那是拼装用户可见文案的唯一来源。

已核查:`templates/cli/test/` 中**目前没有任何测试断言**
`"is a broken link; refusing to touch settings"` 或 `"no existing ancestor"` 这两条文案。
因此「不漂移」当前**没有回归网兜底** —— 实施时必须补上这两条文案断言,
否则该约束只是一句愿望。

### §6.3 installer 重构的验收条件

允许重构 installer 改用中性原语,但同时满足:

```text
- installer 既有【成功路径】与既有【错误路径文案】不漂移（见 §6.2，须新增逐字文案断言）
- 唯一批准的行为变化：非 ENOENT 的 lstat 错误由"继续上溯"改为 fail-closed（§6.2.1）
  该变化必须有前后两态证据：先 characterize 旧行为，再按裁定翻转期望值
- Gate 1 相关测试(T-takeover-installer 全套)原样通过,一条不改
- templates/cli/ 与 .evo-lite/cli/ 镜像一致:sync-runtime 连续两次 copied: 0
```

### §6.4 原语的异常边界:只包装真实 fs 错误

原语对 `lstatSync` / `realpathSync` 的异常**都**必须先判别:

```text
typeof e.code !== 'string'  → 原样抛出（这是程序缺陷，不是路径问题）
否则                        → 包装成带 code 的 path error
```

否则一个来自 fs 层的编程错误(如 `TypeError`)会被包装成 `REALPATH_FAILED`,
再被 `deriveHostOwnedWriteRoots` 当作正常的锚点不可用降级成 `{ok:false}` —— 缺陷被静默吞掉。
把这条边界放在**原语内部**,下游只需捕获已知 `PATH_CODES`,不必各自重复判别。

`BROKEN_LINK` 的分类同样要收窄 —— symlink 的 realpath 失败不都等于断链:

```text
symlink + cause 为 ENOENT / ENOTDIR   → BROKEN_LINK
其他 realpath fs 错误（EACCES / EPERM / ELOOP / EIO …）→ REALPATH_FAILED
```

否则 installer 会对一个仅仅是权限不足的链接输出误导性的 "is a broken link" 文案。

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
                                                          （仅自动化证据,见 §4 实景修正)
linked worktree 中指向主工作树的 memory           deny    ← §2.1,拓扑不受支持,必须 fail-closed
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

### §8.1 终局门:双会话真实记忆验收(冻结流程)

自动化回归证明不了「宿主的持久记忆功能真的恢复了」—— 它只能证明文件系统上出现了一个文件。
终局门必须是下面这个双会话流程,不能用喂 adapter JSON 代替。

**前置**:使用一个 disposable 的 project-state,其 `memory/` **初始不存在**,
且项目必须落在 §2.1 的 SUPPORTED 拓扑内(单工作树 / 独立副本;**不得用 linked worktree**)。

实景修正(Step 0c):宿主会在 SessionStart 自行建好空 `memory/`,所以这一前置实际保证的是
「**目标文件**尚不存在」,而不是「目录尚不存在」——「目录整体不存在」的分支在当前宿主中
无法由 agent 触发,只有自动化证据。

```text
Session A
  1. 从 canonical project root 启动(root-launch-only,不得从子目录)
  2. 完成正常 takeover
  3. 用真实 Edit / Write 工具 —— 不得用 Bash
  4. 创建 memory/MEMORY.md 或 memory/<topic>.md
  5. 写入一个唯一 marker
  6. 确认守卫返回 allow(而不是"没触发守卫")
  7. 确认文件确实落在【派生出的】memory root 上,而非别处

Session B
  1. 结束 Session A 后,重新启动一个全新会话
  2. 从同一 canonical project root 启动
  3. 证明该唯一 marker 被宿主【正常的跨会话记忆机制】消费
  4. 不得靠直接给绝对路径、或用 Bash 读文件来冒充"跨会话记忆成功"
```

另需单独保留一次 **`memory/` 已存在**时的写入,覆盖普通路径(不经过首次创建分支)。

三件事必须同时被证明,缺一不可:

```text
(1) 首次 agent memory 文件写入不再被误拒  ← §6 的回拼修法真的生效（单级尾部)
(2) 写入确实是【守卫放行】的结果          ← 而不是守卫压根没参与
(3) 宿主持久记忆功能真正恢复              ← 而不是磁盘上多了一个孤立文件
```

(1) 的措辞在 Step 0c 后收紧过:实景证明的是**首次 memory 文件**写入,不是**目录创建**。

**验收与治理闭环必须分离。** 执行者产出证据后停下接受独立复审;
`spec → done`、`plan → done`、`mem archive`、backlog 关闭、`[attp-hive-rollout]` 解阻
一律**在复审 ACCEPTED 之后另行授权**。执行者不得同时是实现者与最终验收者
—— 这是 ATTP 两道 Gate 一直遵守的纪律。

## §9 实施前置观测(Step 0b)—— 已完成,分支 A

证据:[`attp-guard-allowlist-step0b-subagent-correlation.md`](../../validation/attp-guard-allowlist-step0b-subagent-correlation.md)

### §9.1 观测契约(冻结)

只看「子 agent 的 transcript 落在哪个目录」**不足以**判定本设计是否成立。
决定性的是一对数据 —— transcript 与**实际写入目标**的对应关系。观测必须捕获:

```text
parent   session_id / transcript_path
subagent session_id / transcript_path
subagent tool_name
subagent tool_input.file_path
derived  allowedMemoryRoot
actual   attempted memory target
```

且必须由**真实 subagent 机制**触发,不得用「从另一个 cwd 启动一个独立 Claude Code 项目」冒充。

判定分支冻结为:

```text
A. 子 root == 父 root,memory target 也在该 root/memory   → 当前设计成立
B. 子 root != 父 root,但 target 仍是父 root/memory       → 事件单锚设计不成立,
                                                            停止实施并重设身份绑定
C. 子 root != 父 root,target 是子自身 root/memory        → 事件级派生可能成立,
                                                            但该语义必须写进设计
D. transcript_path 缺失 / hook 未触发 / target 不可观测   → 不实施
```

### §9.2 观测结果:**分支 A**

```text
子 agent 的工具调用携带【父会话的】session_id 与 transcript_path;
宿主不为子 agent 另开 project-state 目录。
子 agent 的实际 memory target 严格位于 dirname(transcript_path)/memory 之下。
```

父/子的区分不靠推断:宿主在事件里直接给出 `agent_id` / `agent_type`,
父发起的调用(包括 `Agent` 派发动作本身)**没有**这两个字段。

「实际 memory target」也不是提示词造出来的 —— 在**不给它任何路径**的前提下,
子 agent 自述其系统提示中的持久记忆目录,报出的就是**父项目**的 memory root。
子 agent 发起的记忆写入是真实存在的路径,且当前同样被守卫以
`resolves outside project` 拒绝。

### §9.3 对设计的约束

`deriveHostOwnedWriteRoots(hookInput)` 只消费**当前事件**的 `transcript_path`,
**不区分事件由父还是子发起** —— 因为宿主在这条路径上本就不做区分,无需第二个 allowed root。

**`agent_id` / `agent_type` 不得进入派生逻辑。** 它们是本轮新观测到的字段,
不在任何文档契约里;分支 A 下它们对结果也没有影响。用了只会凭空增加一处对未文档化字段的依赖。

## §10 已关闭的开放问题(设计冻结前逐条定案)

**1. `resolvePhysicalPath` 的归属 —— 已冻结,见 §6.1/§6.2/§6.3。**
抽为 dependency-neutral 的 `takeover-physical-path.js`,installer 与 receipt 共用;
installer 允许重构,但受三条验收条件约束。不再留给实现者现场选择。

**2. `takeover status` 是否展示实际 allowed root —— 本阶段不改。**

理由是它做不到而不是不想做:实际 root 来自**每次事件**的 `transcript_path`,
而 `status` 是静态命令,**没有事件输入**。此时要输出一个具体路径,只能靠
(a) 重新猜 slug 编码、(b) 读取其他持久化状态、或 (c) 显示一个并非当前事件权威值的路径
—— 三条都直接违背本设计「只能从当前事件派生」的原则(§3),
而该原则已经写进 spec。

未来若确有可见性需求,只允许显示**静态策略**,例如:

```text
host-owned write policy: event-derived Claude project memory only
```

**不得声称展示的是当前实际 root。**

**3. README —— 不再是开放问题,升级为实施验收项。**

例外落地后,现有「项目外 `Edit`/`Write` 一律 deny」的表述即不准确。必须同步改成:

```text
项目外 Edit/Write 默认 deny;
唯一窄例外是由当前 PreToolUse 事件的 transcript_path
派生出的、本项目的 Claude Code memory 目录。
```

并继续保留既有的两条声明:`Bash` 可绕过;守卫是治理保证,**不是**隔离边界。
`README.md` 与 `README_EN.md` 两份都要改,列入实施任务的验收清单。
