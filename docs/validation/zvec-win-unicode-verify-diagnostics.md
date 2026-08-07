# zvec Windows 非 ASCII containment — Task 7 verify 只读诊断验证

- 议题：`[zvec-win-unicode-containment]`
- 任务：**Task 7 / AC6** —— `verify` 只读 containment 诊断
- 合同：spec §7.5 **D0–D8**（自包含；执行它不需要引用其他证据文件）
- 基线：`main@bc3ee2f`（分支 `codex/zvec-containment-verify-task7`）
- 日期：2026-08-05
- 承重裁定：**收法 B** —— verify 参与 ambient 判定；合同禁止的是 ambient 路径**之外**的 marker I/O

---

## 1. 证据分层

本文件严格区分两类内容。混淆二者正是 §7.5 D4 要防的事。

```text
仓库可复现证据 —— 任何人在本仓库重跑即可得到
  tests        T12 八条（governance）+ T-zwuc-T12-cli（integration）
  mutations    承重负控 A–I 共 12 条，12/12 effective，12/12 命中各自的守护断言
               逐条 patch 与三段哈希见 Appendix A
  hashes       三对 live/template SHA-256 逐对一致
  command exits npm test ×2 环境、sync-runtime --check

人工结论 —— 基于审计与阅读，不由测试自动证明
  本轮未修改任何模块的导出面（memory-index.js / zvec-containment-state.js 零改动）
  本次 verify 进程未加载 Zvec native binding，也未实例化或打开该 collection
  【不宣称】该 collection 从未被读取 —— verify 无从证实全局历史（§7.5 D4）
```

---

## 2. 命令与退出码

```text
基线（未改产品代码，Commit 1 之后）
  npm test                          EXIT 0
  TEMP=RUNNER~1 npm test            EXIT 0
  sync-runtime --check              EXIT 0

实施完成后
  npm test                          EXIT 0
  TEMP=RUNNER~1 npm test            EXIT 0
  sync-runtime --check              EXIT 0
  T12 八条                           全过
  T-zwuc-T12-cli                     过
  mutations A–I（12 条）              12/12 effective，12/12 guardHit
```

`TEMP=RUNNER~1` 是 Windows runner 的真实短名形状，必须一并跑 —— 该路径本身会被
containment 判为非 SAFE，是最容易暴露诊断段副作用的环境。

---

## 3. 最终文件哈希（SHA-256，live 与 template 逐对一致）

```text
memory.service.js    9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
test/governance.js   c0b880f877cde483ccbc75a723b3164256819f0d7944968183504dbe4144dffd
test/integration.js  44f79c622d5b5376c55a8c467bc6200a29487a9fdc617a571fe959f4f56a48bf
```

三对镜像均为 `MIRROR-IDENTICAL`。

> **哈希演进**：`memory.service.js` 在 §8 的 teardown 调查全程逐字节未变
> （`e7a0f107…`），这是「§8 是测试夹具修正、不是产品改动」的可复核依据；
> 它在 §9 的复审返工中才首次改变（`e7a0f107…` → `9d409b4e…`），
> 因为那一轮才动了产品的状态模型与输出。

---

## 4. 承重负控 A–G（第 1 轮记录 —— 已被 §9 与 Appendix A 取代）

> ⚠️ **本节是第 1 轮的历史记录，不再是当前证据。** 2026-08-07 的复审判定本轮
> 负控存在可证伪性缺口（详见 §9.3）：九项零副作用里只有四项有 guard，且
> `marker write count = 0` 用「文件存在性未变」替代 —— **覆写检测不到**。
> 当前有效的负控是 A–I 共 12 条，逐条 durable 记录见 **Appendix A**。
> 本节保留，因为它记录了第 1 轮真实发生过什么，包括下面 F 的 guardHit 教训。

纪律：每条突变都施加在**完整绿色基线**上；施加后 `npm test` 必须非零；随后还原并按
SHA-256 证明回到基线且与 template 镜像一致；**突变态下不开始下一条**（装置一次只跑一条，
`run-mutations-task7.js <id>`，正是为了让"不并发"成为机械保证而非纪律承诺）。

`effective` 的判据写死在装置里：`npm test` 的 `status !== 0`。此外每条还记录
`guardHit` —— 红点是否落在**它应当守护的那条断言**上。这条是必要的：一条突变可能因
无关的偶发失败而变红，那不是有效负控。本轮 F 第一次运行就抓到了这种情况（首条捕获到的
失败是无关的 `initialize response received before EOF`），装置因此改为收集**全部**断言
并筛出守护断言，重跑后确认 F 命中的是自己的断言。

**结果：7 条，7 effective，0 ineffective，7/7 guardHit。**

| # | 突变 | 守护 | 观察到的守护断言 | exit |
|---|---|---|---|---|
| A | containment 段 `require('@zvec/zvec')` | T12 case 6 native-load 计数为 0 | `the containment section must not load @zvec/zvec — diagnosing a path suspected of crashing the native binding must never be the thing that loads it (§7.5 D4.1, control A)` | 1 |
| B | containment 段实例化索引 | T12 case 6 索引实例为 null | `the containment section must not instantiate ANY index — it reads a decision and a marker, nothing else (§7.5 D4.1, control B)` | 1 |
| C | containment 段清 marker | T12 case 6 marker 不增不减 | `the containment section must neither mint nor clear a marker (§7.5 D4.1, control C)` | 1 |
| D | 输出声称上游缺陷已修复 | T12 措辞合同 + CLI 措辞检查 | `verify output must not contain the banned claim "内容确认完整" — §7.5 D6 forbids it because verify cannot 证实 global history, only this process's behaviour` | 1 |
| E | SAFE + marker present 不报 recovery-pending | T12 case 2 | `a SAFE path whose marker is still present is recovery-pending: the path stopped being dangerous, the debt did not clear — got {"state":"normal",…,"reason":"containment-recovery-pending"}` | 1 |
| F | invalid/unreadable 折叠进 present | T12 case 3 | `a schema-invalid marker must surface as marker-damaged, never folded into present (§7.5 D3 / control F)` | 1 |
| G | unsafe 与 recovery-pending 共用 remediation | T12 cases 2 & 5 | `recovery-pending must point at an explicit rebuild — that is the one action that can clear this state` | 1 |

每条突变的目标文件均为 `.evo-lite/cli/memory.service.js`（镜像
`templates/cli/memory.service.js`），还原后哈希一律为
`e7a0f1075012d407…`，镜像同值。

装置：`.evo-lite/generated/run-mutations-task7.js`、
`baseline-hashes-task7.json`、`mutations-task7-results.json`（均 gitignored）。
本表的每一行都从 `mutations-task7-results.json` 逐条转录。

---

## 5. 实施期发现并修正的三处真实问题

这些不是润色，每一处都会让合同在生产上落空。

### 5.1 `report.hasAlerts = true` 会让 containment 指引自己消失

第一版实现在 containment 非 normal 时设了 `report.hasAlerts`。但 `verify()` 只在
`!report.hasAlerts` 时打印 `report.nextSteps`（`memory.service.js` 尾部），因此该写法会
**抑制这一段刚刚排入的 remediation**，并连带吞掉全部无关治理提示。

暴露它的正是 `TEMP=RUNNER~1` 环境：短名路径被判非 SAFE → 置位告警 → T13
（`verify should recommend plan progress`）变红。

修正：不置 `hasAlerts`，改为把每条 remediation **同时** `log()` 与 `pushNextStep()`。
日志是无条件的，这才让指引在最需要它的降级机器上必定可见。

### 5.2 零副作用断言原本无法证伪

第一版 case 6 断言 `diag.processObservation.instantiatedCollection === false` —— 那是个
**硬编码字面量**，任何突变都不会让它变红。同时"collection 目录不存在"也不可靠：是否
落盘取决于 decision 选中的引擎，突变实例化 SQLite 索引时该断言静默通过（突变 B 第一次
运行确实 ineffective）。

修正：导出 `buildContainmentDiagnostics()`，对**该段单独**测量 —— 用 `Module._load` 钩
`@zvec/zvec` 计数，并断言 `peekMemoryIndex()` 调用前后均为 `null`。跨整个 `verify()`
测量没有意义：实体库段合法地打开活动索引，任何在那里取的计数都被本合同不管辖的行为淹没。

同理，控制 C 需要 marker **确实存在**才能观察到"未被清除"——删除一个本不存在的 marker
与不动它无法区分。case 6 因此先写入 marker fixture。

### 5.3 测试被前序测试的环境变量污染

`resolveEngine()` 优先读 `EVO_LITE_MEMORY_ENGINE`（`memory-index.js:180`）。套件中较早的
测试会留下该变量，继承来的 `sqlite-fts5-trigram` 让每个 case 静默走 engine-choice 分支，
断言全部失效却依然全绿。

修正：每个 case 显式 pin 引擎，并在 T12 结束时 `delete` 这两个变量，避免本测试反过来
污染后续测试。

---

## 6. 零接口扩大（人工结论 + 可复核依据）

诊断只消费**已经导出**的东西：

```text
peekEngineDecision()     memory-index.js:501，导出于 :649
readContainmentState()   zvec-containment-state.js:118，导出于 :458
getDbPath()              memory.service.js 已导入 :24
```

`memory-index.js` 与 `zvec-containment-state.js` 在本分支**零改动**，可由
`git diff --name-only bc3ee2f..HEAD` 复核。

唯一新增的导出是 `memory.service.js` 自身的 `buildContainmentDiagnostics`，用途是让
D4.1 的零副作用计数能对该段单独测量（见 5.2）。`memory.service.js` 属于 §7.5 D8 的
可改清单。

---

## 7. 边界

```text
本文件不主张：Task 7 之外任何任务的验收
Ready / merge     未执行
Task 8 / Task 9   未授权
context closure   未授权
```

**verify 能说什么、不能说什么**（§7.5 D4）：

```text
可以说："本次 verify 进程未加载 Zvec native binding，也未实例化或打开该 collection。"
不能说："该 collection 从未被读取。"
```

后者是关于全局历史的断言，`verify` 没有任何证据能支持它。测试层能证明的也只是
非 SAFE 路径下 `loadZvecIndex` 调用次数为 0（Task 4 的 T6、Task 6 的 T8b），
那是关于**进程行为**的性质，不是关于 collection 生命史的性质。

---

## 8. Windows Node 24 的 CI 失败 —— T12 teardown 缺陷（非产品缺陷）

### 8.1 三次 CI gate

```text
31005837322  head 57979db  pull_request attempt 1  4/5  windows-latest/node 24 FAILED
31012656035  head 73a9131  pull_request attempt 1  4/5  windows-latest/node 24 FAILED
31137819249  head d5d1216  pull_request attempt 1  5/5  ALL PASS
```

前两条永久保留为失败证据，**均未 rerun**。三次都是 `pull_request` / attempt 1；
每次新 SHA 触发的是新 gate，不是对旧 run 的重跑。

失败格固定为 **windows-latest / node 24**：Microsoft Windows Server 2025，
runner image `win25-vs2026/20260728.188`，OS build `10.0.26100`，node `v24.18.0`，
npm `11.16.0`。ubuntu 的 node 20/22/24 与 windows/node 22 三次全绿。

### 8.2 精确失败边界

首轮（`31005837322`）只能看到 `T12` 打印 banner 后进程消失，无 JS 断言、无栈、无 stderr，
GitHub step 报 `exit code 127`。第二轮加入同步 checkpoint
（`fs.writeSync(2, ...)`，因为被 native fail-fast 终止的进程不会 flush stdout 缓冲，
`console.log` 无法标记最后存活位置）后，边界被钉死：

```text
13:59:27.4912124  [T12-TRACE] suite begin
13:59:28.9210553  [T12-TRACE] unsafe cleanup begin      ← 最后一条完整 checkpoint
                  （预期但从未出现：unsafe cleanup complete）
13:59:29.2867341  ##[error]Process completed with exit code 127

T12 存活 1.795 s；最后 checkpoint 到死亡 0.366 s
```

两条 checkpoint 之间只有一行代码：

```js
try { fs.rmSync(unsafeBase, { recursive: true, force: true }); } catch (_) {}
```

`unsafeBase` 是 `fs.mkdtempSync(path.join(os.tmpdir(), 'evo-t12-不安全-'))`。
同一行在 windows/node 22 上耗时 **0.2 ms** 并正常完成
（`17.8558617 → 17.8560729`），随后 case 6 全部 checkpoint 正常走完。

**它被 `try/catch (_) {}` 包裹却仍然终止了进程** —— JS 异常不可能穿过该捕获，
所以这是进程级终止，不是可捕获的错误。

### 8.3 为什么这是测试 teardown 缺陷，不是产品 containment 缺陷

失败发生时，被测代码已经全部成功执行完毕：

```text
unsafe verify begin → verify returned      verify() 正常返回
unsafe reset begin  → reset complete       resetMemoryIndex() 完成
unsafe assertions complete                 containment 状态断言全部通过
unsafe cleanup begin → ✗                   死在测试自己的临时目录删除
```

机制上：`bootstrapRuntime()` 调用 `initDB()`，后者打开模块级 `better-sqlite3` 连接。
`resetMemoryIndex()` 只释放 memory-index 实例与它可能持有的 zvec LOCK，
**不触及那个 SQLite 句柄** —— 而该句柄正位于测试随后递归删除的目录内。

**生产不存在这种形状**：没有任何生产路径会在同进程仍持有项目数据库时，
递归删除该数据库所在目录。这是测试夹具自己制造的生命周期。

佐证：本套件的其它测试早已在 teardown 中调用 `closeDb()`
（`test/governance.js` 中 `anchored.db.closeDb()`、`loaded.db.closeDb()`、
`require('db.js').closeDb()` 等多处）。**T12 是唯一遗漏该步骤的测试。**

六个 case 全都缺这一步；Windows/node 24 只是在 `unsafe` 的 cleanup 上把它暴露出来。
因此修正应用于全部六个，而不只是那一个。

### 8.4 修正内容（仅测试夹具）

`runVerify()` 保存 `loaded.db.getDb()` 返回的真实句柄，并在 `finally` 中按序执行：

```text
verify returned → resetMemoryIndex() → closeDb() → 断言 database.open === false
               → 返回给调用方 → 外层断言 → 目录删除
```

放在 `finally` 意味着抛出路径同样执行 —— 断言失败的 case 不得把一个仍打开的数据库
交给下一个 case。`database.open` 断言**刻意不包 try/catch**：句柄若仍打开，
必须在此暴露，而不是在之后某个无关的 `rmSync` 上。

case 6 自行 `bootstrapRuntime()`，同样持有句柄，按
`Module._load restored → reset → closeDb → 证明已关闭 → anchor.cleanup` 收口。
ASCII 的 collection 路径不会让一个未关闭的句柄变得合法 —— 决定性的是 teardown 形状。

**未改动**：`fs.rmSync` 调用本身、目录清理的存在、case 顺序与数量、fixture 与 marker
内容、`bootstrapRuntime`/`verify`/`reset` 调用次数、engine choice、断言、timeout、
try/catch 边界、同进程执行模式；没有子进程隔离、retry、sleep、延迟到进程退出、
平台跳过，也没有改动产品的数据库生命周期。产品文件相对 `57979db` 逐字节未变。

### 8.5 本地复现结果（阴性）

Windows 11 build `10.0.26200` + node `v24.18.0` + npm `11.16.0`，
两处 `node_modules` 全部删除后清洁安装（未复用 node 22 的 native 模块）：

```text
node ./.evo-lite/cli/test.js        EXIT 0
npm test                           EXIT 0
TEMP=RUNNER~1 npm test             EXIT 0
Git Bash（CI 用 shell: bash）       EXIT 0
node 22.22.2 控制组（同工作树同安装流程）  EXIT 0
WER / Application Error            0 条记录
```

**本地从未复现**，因此拿不到 faulting module 或 exception code。已排除的变量：
node 24 本身、npm 11 包装层、npm 11 的 allow-scripts 行为
（zvec binding 经 `@zvec/bindings-win32-x64` optional dependency 分发，
不依赖 install script，node 24 下 `require` 成功）、Git Bash vs PowerShell、
8.3 短名 TEMP、复用 node 22 native 模块。

### 8.6 仍未证明（不得写成已归因事实）

```text
具体 NTSTATUS（exit 127 与 0xC0000409 相容，但不足以推定）
faulting module
由 Node、better-sqlite3 还是 Windows 内部执行了 fail-fast
Windows Server 2025 / build 26100 与 Windows 11 / 26200 之间的确切差异
```

可以陈述的是：**在删除临时 runtime 目录前关闭 T12 自己打开的 SQLite 连接后，
同一矩阵格从连续两次失败转为通过。** 这支持「未关闭句柄的非法 teardown 形状」
这一根因假设，但不构成对上述四项的证明。

---

## 9. 全量复审返工（2026-08-07，CHANGES REQUIRED）

`1cea66b` 的 CI 是 5/5，但全量复审仍判 **CHANGES REQUIRED**：绿灯与合同符合性是两件事。
四项发现中三项为 BLOCKER，均已核实属实。

### 9.1 BLOCKER 1 —— 实现越过了冻结合同（这是流程问题，不是设计分歧）

计划写明：**发现冻结项本身有误 → 停止并上报，不得在编码中静默改判。**

第 1 轮实现发现 D5 的四态没有覆盖「显式 sqlite pin + marker present」这一组合，
并**把这句话直接写进了代码注释**：

```text
because D2 requires an outstanding debt be shown SEPARATELY and
D5's four rows do not enumerate this combination.
```

写下这句话的那一刻就是必须停止的时刻。实际做法却是：现场补设计出第五状态
`debt-under-pin`、跑完全部门禁、推送 CI，然后在交付报告末尾「提请复审确认」。
**那是事后追认，不是停止并上报**，两者在治理上完全不同 —— 前者把既成事实交给复审承担，
后者才把裁定权留在该在的地方。

复审确认合同本身确有内部缺口：D2 要求 pin 不得掩盖既有 marker，§7.4 M8 又允许
`pin + marker present` 以 sqlite 正常运行，而 D5 只列四态 —— 三者无法同时成立。
设计方向因此被采纳，但**裁定权本应属于复审**。

同源缺陷：`buildContainmentDiagnostics()` 的末支是无条件 `state = 'normal'`，
而旧 `normal` 的判据含 `impl === 'zvec'`。于是

```text
pin sqlite + marker absent            → 被报成 normal（但 impl 是 sqlite）
SAFE + binding 不可用 + marker absent → 被报成 normal（但 impl 是 sqlite）
```

两种组合都落进了一个判据并不成立的状态。根因是 `normal` 同时表达了**债**与**引擎**
两个独立维度。

**修正**：§7.5 D5 局部重开并重新冻结为五态，`normal` → `no-debt`，且 `no-debt`
**只表达债**；引擎事实由独立的 `engine.{choice,impl,degraded,reason}` 承载。
D6 新增禁令：`no-debt` 文案不得断言引擎状态。T12 新增两个 case 分别钉住
`pin + absent` 与 `dependency-unavailable + absent`；mutation **H** 守护这条分离性质
（把 `no-debt` 重新耦合 `impl === 'zvec'` 后必须变红）。

### 9.2 BLOCKER 2 —— D3 要求的 marker 原始记录并未真正呈现

D3 明文要求 `present` 显示 marker `state` 中的 `collectionPath` 与 `containment`。
第 1 轮实现只在 report 里存了 `recordedCollectionPath`，**没有存 `containment`**，
而 CLI 输出**两者都没有**。

这在 `debt-under-pin` 下是实质缺失，而非文档细节：
`resolveEngineDecisionFromInputs()` 在 `choice !== 'zvec'` 时**直接返回
`containment: null`**（M8 分支在分类之前就返回），所以那条路径上唯一能说明
「这笔债针对哪个 collection、当初为何产生」的信息**全部只在 marker 里**。
不显示它，等于让操作者拿着一笔无法追溯来由的债。

**修正**：report 增加 `marker.recordedContainment{verdict,layer,reason}`，
复用 D2 已取得的**同一次** snapshot（不第二次读盘）；CLI 输出拆成「当前判定」与
「containment marker 原始记录」两层。T12 对 pin case 逐字段精确断言，并断言
recordedCollectionPath **确实出现在输出里**；mutation **I** 守护这条可达性
（只在 report 里有、不输出给操作者，必须变红）。

### 9.3 BLOCKER 3 —— D4.1 的九项零副作用只有四项真正被守护

第 1 轮 case 6 检测了：native load 计数、`peekMemoryIndex() === null`、
collection 目录不存在、marker 文件存在性未变。这**不能机械证明九项**：

```text
marker write count = 0   用「存在性未变」替代 —— 覆写回相同内容检测不到
rebuild count = 0        无独立计数
recovery lease           无独立计数
archive publication lock 无独立计数
collection read/query    无独立计数
```

而 D7 冻结的 mutation C 本是「清 marker、**自动 rebuild 或取得恢复所有权**」三合一，
第 1 轮只施加了清 marker 一种 —— 另外两条性质**从未被证伪过**。这正是 mutation
testing 应当防的「测试看起来覆盖、实际某些性质没有可证伪 guard」。

**修正**：改为 **call-level 计数**。在 `memory.service.js` 被加载**之前**拦截模块解析，
包住它将要解构的绑定，因此**即使被禁止的动作事后把现场恢复原样，调用仍被计到**。
终态哈希/指纹降级为 auxiliary，并在断言消息里写明它不能替代调用计数。

同时加入**正向对照**：`peekEngineDecision` 与 `readContainmentState` 各必须为 1。
没有它，「所有禁止项都是 0」在计数器根本没挂上时也会成立 —— 那会是一个恒真的假绿。

D7 的 C 拆为 C1（清 marker）/ C2（rebuild 语义）/ C3（recovery lease）/ C4（archive lock），
各自独立施加并各自命中专属断言。

> **实施期的一个次级发现**：断言顺序会决定 guardHit 落在哪条性质上。若把广义检查
> （`zvec.require`）排在前面，`C2` 会因 rebuild 路径顺带触发 native load 而命中
> control A，看起来像「C2 的性质没有 guard」。因此 forbidden 列表按**专属性从强到弱**
> 排序，正向对照移到 forbidden 之后 —— 后者若排在前面，`B` 会因 `getMemoryIndex`
> 顺带再读一次 marker 而命中正向对照。两处都调整后，12 条各自命中自己的断言。

### 9.4 IMPORTANT 4 —— durable evidence 未达 D7 自己规定的格式

第 1 轮只在本文件留了汇总表，逐条 patch、mutation point 与三段哈希仍只存在于
gitignored harness。**修正**：新增 **Appendix A**，由脚本从
`mutations-task7-results.json` 逐条转录（生成而非手抄，避免文档与实跑漂移），
使任何 reviewer 仅凭仓库内容即可重建每条负控改了什么、由哪条断言捕获。

### 9.5 本轮结果

```text
T12                  八条 case 全过
mutations A–I        12 条，12/12 effective，12/12 guardHit
产品改动             memory.service.js（状态模型 + marker 原始记录 + 两层输出）
                     e7a0f107… → 9d409b4e…
未触碰               memory-index.js / zvec-containment-state.js（零接口扩大不变）
Windows/node24       复审裁定 CLOSED，本轮未再追查
```

第 1 轮的负控记录保留在 §4，并已标注被本节取代 —— 它记录了当时真实发生过什么，
包括 F 那次「红在无关偶发失败上」的教训，那正是本轮把 guardHit 独立成字段的由来。

---

## Appendix A — 承重负控 A–I 逐条 durable 记录

本附录满足 §7.5 D7 的要求：**任何后来的 reviewer 仅凭本仓库内容，即可重建每一条
负控究竟改了什么、由哪条断言捕获**，无需访问 gitignored 的 harness。

全部 12 条在同一绿色基线上逐条施加、逐条还原；一次只施加一条，突变态下不开始下一条。
`guardHit` 单独记录，用于证明红点落在**该条自己守护的性质**上，而非无关的偶发失败。

```text
总计 12 条，effective 12/12，guardHit 12/12
目标文件      .evo-lite/cli/memory.service.js
镜像文件      templates/cli/memory.service.js
baseline sha  9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
```

### A

- **guard property**：containment section must not load @zvec/zvec (D4.1 #1)
- **mutation point**：buildContainmentDiagnostics() first statement
- **exit code**：1（非零 = effective）　**guardHit**：yes　**捕获断言总数**：2

施加的具体变化：

```diff
- function buildContainmentDiagnostics() {
-     const decision = peekEngineDecision();
+ function buildContainmentDiagnostics() {
+     try { require('@zvec/zvec'); } catch (_) {}
+     const decision = peekEngineDecision();
```

observed relevant assertion：

```text
the containment section must not perform: Zvec native require (§7.5 D4.1, control A) — observed 1 call(s) to zvec.require
```

```text
baseline SHA-256   9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
mutated  SHA-256   7eddf05f2faeeab077054bbb7ef571eaa6feb821ddda2ad2ff1f03c6ea24690c
restored SHA-256   9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
restored template  9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
mirror-identical   true
```

### B

- **guard property**：containment section must not construct an index / open the collection (D4.1 #2-4)
- **mutation point**：before `const reason = ...` in buildContainmentDiagnostics()
- **exit code**：1（非零 = effective）　**guardHit**：yes　**捕获断言总数**：2

施加的具体变化：

```diff
-     const reason = decision ? decision.reason : null;
+     try { getMemoryIndex(); } catch (_) {}
+     const reason = decision ? decision.reason : null;
```

observed relevant assertion：

```text
the containment section must not perform: index construction / collection open / read (§7.5 D4.1, control B) — observed 1 call(s) to memory-index.getMemoryIndex
```

```text
baseline SHA-256   9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
mutated  SHA-256   f1281710d560960c8b238aeb4884ef9e3aeae1d079814c70afb092d291b61c75
restored SHA-256   9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
restored template  9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
mirror-identical   true
```

### C1

- **guard property**：containment section must not clear the marker (D4.1 #6)
- **mutation point**：before `const reason = ...` in buildContainmentDiagnostics()
- **exit code**：1（非零 = effective）　**guardHit**：yes　**捕获断言总数**：2

施加的具体变化：

```diff
-     const reason = decision ? decision.reason : null;
+     try { clearContainmentState(markerDir); } catch (_) {}
+     const reason = decision ? decision.reason : null;
```

observed relevant assertion：

```text
the containment section must not perform: marker clear (§7.5 D4.1, control C1) — observed 1 call(s) to memory-index.clearContainmentState
```

```text
baseline SHA-256   9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
mutated  SHA-256   874cf7c8ff51dfd584481300cf2e0fa34217dd9a75e140c13c87c1f2e9e8f554
restored SHA-256   9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
restored template  9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
mirror-identical   true
```

### C2

- **guard property**：containment section must not enter recovery / rebuild semantics (D4.1 #7)
- **mutation point**：before `const reason = ...` in buildContainmentDiagnostics()
- **exit code**：1（非零 = effective）　**guardHit**：yes　**捕获断言总数**：2

施加的具体变化：

```diff
-     const reason = decision ? decision.reason : null;
+     try { resolveRecoveryRebuildDecision(); } catch (_) {}
+     const reason = decision ? decision.reason : null;
```

observed relevant assertion：

```text
the containment section must not perform: entering recovery / rebuild semantics (§7.5 D4.1, control C2) — observed 1 call(s) to memory-index.resolveRecoveryRebuildDecision
```

```text
baseline SHA-256   9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
mutated  SHA-256   d783b120c04ce42d5729e9e012545b2ec8bf155bf8682be9c7c7eded8c3ac110
restored SHA-256   9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
restored template  9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
mirror-identical   true
```

### C3

- **guard property**：containment section must not acquire recovery ownership / lease (D4.1 #8)
- **mutation point**：before `const reason = ...` in buildContainmentDiagnostics()
- **exit code**：1（非零 = effective）　**guardHit**：yes　**捕获断言总数**：2

施加的具体变化：

```diff
-     const reason = decision ? decision.reason : null;
+     try { acquireRecoveryLease(markerDir, { generation: 1 }); } catch (_) {}
+     const reason = decision ? decision.reason : null;
```

observed relevant assertion：

```text
the containment section must not perform: recovery lease acquisition (§7.5 D4.1, control C3) — observed 1 call(s) to zvec-containment-state.acquireRecoveryLease
```

```text
baseline SHA-256   9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
mutated  SHA-256   60882f43bd11e2c19439ced01633aabdb2fa5dc27a63e88950ba9be4e8a803e6
restored SHA-256   9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
restored template  9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
mirror-identical   true
```

### C4

- **guard property**：containment section must not write the archive publication lock (D4.1 #9)
- **mutation point**：before `const reason = ...` in buildContainmentDiagnostics()
- **exit code**：1（非零 = effective）　**guardHit**：yes　**捕获断言总数**：2

施加的具体变化：

```diff
-     const reason = decision ? decision.reason : null;
+     try { acquireArchiveMarkerLock(markerDir); } catch (_) {}
+     const reason = decision ? decision.reason : null;
```

observed relevant assertion：

```text
the containment section must not perform: archive publication lock write (§7.5 D4.1, control C4) — observed 1 call(s) to zvec-containment-state.acquireArchiveMarkerLock
```

```text
baseline SHA-256   9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
mutated  SHA-256   d8da8fe0d0f2123a8a3d1d2c21210ef759cebc6c36524d41593eef1848664230
restored SHA-256   9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
restored template  9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
mirror-identical   true
```

### D

- **guard property**：output must not claim the upstream defect or the collection is fixed (D6)
- **mutation point**：no-debt branch of logContainmentDiagnostics()
- **exit code**：1（非零 = effective）　**guardHit**：yes　**捕获断言总数**：2

施加的具体变化：

```diff
-         log('🧭 [Containment]: 当前没有未清偿的 containment trust debt。');
+         log('🧭 [Containment]: 上游缺陷已修复，该 collection 内容确认完整。');
```

observed relevant assertion：

```text
no-debt: verify output must not contain the banned claim "内容确认完整" — §7.5 D6 forbids it because verify cannot证实 global history, only this process's behaviour
```

```text
baseline SHA-256   9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
mutated  SHA-256   a251d8e82bf3a25df6e0888a21f11ad669e1d20deba421f32bbcd9bd08d0498d
restored SHA-256   9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
restored template  9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
mirror-identical   true
```

### E

- **guard property**：SAFE + marker present must report recovery-pending (D5 row 3)
- **mutation point**：state selection chain in buildContainmentDiagnostics()
- **exit code**：1（非零 = effective）　**guardHit**：yes　**捕获断言总数**：2

施加的具体变化：

```diff
-     } else if (reason === 'containment-recovery-pending') {
-         state = 'recovery-pending';
+     } else if (reason === 'containment-recovery-pending') {
+         state = 'no-debt';
```

observed relevant assertion：

```text
a SAFE path whose marker is still present is recovery-pending: the path stopped being dangerous, the debt did not clear — got {"state":"no-debt","engine":{"choice":"zvec","impl":"sqlite","degraded":true,"reason":"containment-recovery-pending"},"verdict":"SAFE","layer":"both","containmentReason":"sup
```

```text
baseline SHA-256   9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
mutated  SHA-256   58294e4240a6c2fcd64847d0585c47809c8445eb28f0416d48dc4038ebd95694
restored SHA-256   9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
restored template  9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
mirror-identical   true
```

### F

- **guard property**：invalid/unreadable must not be folded into present (D3 / D5 row 1)
- **mutation point**：first branch of the state selection chain
- **exit code**：1（非零 = effective）　**guardHit**：yes　**捕获断言总数**：2

施加的具体变化：

```diff
-     if (marker.status === 'invalid' || marker.status === 'unreadable') {
-         state = 'marker-damaged';
+     if (false) {
+         state = 'marker-damaged';
```

observed relevant assertion：

```text
a schema-invalid marker must surface as marker-damaged, never folded into present (§7.5 D3 / control F)
```

```text
baseline SHA-256   9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
mutated  SHA-256   06e273364f75f8f62a7a9c8763cefbd934244371e836097b6bfe21e598421a97
restored SHA-256   9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
restored template  9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
mirror-identical   true
```

### G

- **guard property**：unsafe and recovery-pending must not share remediation text (D5)
- **mutation point**：REMEDIATION table in logContainmentDiagnostics()
- **exit code**：1（非零 = effective）　**guardHit**：yes　**捕获断言总数**：2

施加的具体变化：

```diff
-             step: 'containment: 路径已 SAFE 但 marker 仍在，继续使用 SQLite；请人工执行显式 rebuild，重建并经 fresh validator 重开验证通过后 marker 才会被清除。',
+             step: 'containment: 当前路径不受支持，继续使用 SQLite；请先把项目迁移到受支持的 ASCII 路径（spec §5.1）后重新执行 verify。此状态下执行 rebuild 无效 —— 重建出的 collection 仍落在同一条不受支持的路径上。',
```

observed relevant assertion：

```text
recovery-pending must point at an explicit rebuild — that is the one action that can clear this state
```

```text
baseline SHA-256   9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
mutated  SHA-256   ec3459822aac7bc0639dfbc0a85e66e5a51c265f5782edaec2fdccea92c97198
restored SHA-256   9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
restored template  9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
mirror-identical   true
```

### H

- **guard property**：re-frozen D5: no-debt must not re-couple the engine dimension
- **mutation point**：final else of the state selection chain
- **exit code**：1（非零 = effective）　**guardHit**：yes　**捕获断言总数**：2

施加的具体变化：

```diff
-     } else {
-         // marker absent. Says nothing about the engine: impl may be zvec, or sqlite
-         // under an explicit pin, or sqlite because the binding is unavailable.
-         state = 'no-debt';
+     } else {
+         state = (decision && decision.impl === 'zvec') ? 'no-debt' : 'engine-degraded';
```

observed relevant assertion：

```text
an explicit sqlite pin with no marker carries no containment debt — the pin is an engine choice, not a debt (§7.5 D5 row 5)
```

```text
baseline SHA-256   9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
mutated  SHA-256   34706c450466953d8253881d31a711b748b958fe799508a02ff428e960d2bdcb
restored SHA-256   9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
restored template  9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
mirror-identical   true
```

### I

- **guard property**：D3: the marker record must reach the operator, not just the report
- **mutation point**：marker layer of logContainmentDiagnostics()
- **exit code**：1（非零 = effective）　**guardHit**：yes　**捕获断言总数**：2

施加的具体变化：

```diff
-     if (diag.marker.recordedCollectionPath) {
-         log(`     recordedCollectionPath=${diag.marker.recordedCollectionPath}`);
-     }
+     if (false) {
+         log(`     recordedCollectionPath=${diag.marker.recordedCollectionPath}`);
+     }
```

observed relevant assertion：

```text
the recorded collection path must actually reach the operator, not just the report object
```

```text
baseline SHA-256   9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
mutated  SHA-256   47c176b60b4bd48b4b0b4de0f1452da9629d6e109d0458bd2f9d67fb4905a9cd
restored SHA-256   9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
restored template  9d409b4eac19210d149c4401b5cf398c7535cc0301a06e4ae1ef6a14e532ca0a
mirror-identical   true
```
