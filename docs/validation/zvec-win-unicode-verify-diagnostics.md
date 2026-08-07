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
  mutations    承重负控 A–I 共 16 条，16/16 effective，16/16 命中各自的守护断言
               逐条 patch、三段哈希与基线校验状态见 Appendix A
  hashes       三对 live/template SHA-256 逐对一致
  command exits npm test ×2 环境、sync-runtime --check

镜像一致不是完整性证据 —— live SHA == template SHA 只证明 mirror consistency。
  runner 会把变异同步写进镜像，被污染的基线同样镜像一致（§11 是它的反例）。
  真正的还原条件是四项同时成立：live == 已知干净基线、template == 已知干净基线、
  live == template、residue scan clean。

人工结论 —— 基于审计与阅读，不由测试自动证明
  本轮未修改任何模块的导出面（memory-index.js / zvec-containment-state.js 零改动）
  本次 verify 进程未加载 Zvec native binding，也未实例化或打开该 collection
  【不宣称】该 collection 从未被读取 —— verify 无从证实全局历史（§7.5 D4）
```

---

## 2. 命令与退出码

下式中的 `<ABS-SHORT>` 指一条**绝对**短名路径，本地实跑用的是
`C:\Users\uwenc\AppData\Local\Temp\RUNNER~1`。

```text
基线（未改产品代码，Commit 1 之后）
  npm test                              EXIT 0
  TEMP=<ABS-SHORT> npm test             EXIT 0
  sync-runtime --check                  EXIT 0

实施完成后 —— node 22
  npm test                              EXIT 0
  TEMP=<ABS-SHORT> npm test             EXIT 0

实施完成后 —— node 24
  node ./.evo-lite/cli/test.js          EXIT 0
  npm test                              EXIT 0
  TEMP=<ABS-SHORT> npm test             EXIT 0
  sync-runtime --check                  EXIT 0

  T12 八条                               全过
  T-zwuc-T12-cli                         过
  mutations A–I（16 条）                  16/16 effective，16/16 guardHit
  residue scan                           clean
```

`TEMP` 之所以必须一并跑：短名路径是 Windows runner 的真实形状，该路径本身会被
containment 判为非 SAFE，是最容易暴露诊断段副作用的环境。

> **⚠️ 记法更正。** 本文件早先版本把这一项写成 `TEMP=RUNNER~1 npm test`，那是
> **historical notation，不是可照抄的命令**。裸 `RUNNER~1` 是相对路径，会让
> `os.tmpdir()` 落在项目内部，`non-project dir throws` 那条断言随之不再成立 ——
> 表现为一次与产品无关的红。必须用绝对路径。
>
> **node 24 的前置条件**：`better-sqlite3` 的原生模块按 ABI 编译（node 22 = 127，
> node 24 = 137），换版本跑之前需 `npm rebuild better-sqlite3`，跑完再编译回去。
> `.evo-lite/node_modules` 是 gitignored，不进提交。

---

## 3. 最终文件哈希（SHA-256，live 与 template 逐对一致）

```text
memory.service.js    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
test/governance.js   d430b18ac0657e91251c1e3fe883776ac9babfd1a4eb7ba87d998a034d23f1b9
test/integration.js  44f79c622d5b5376c55a8c467bc6200a29487a9fdc617a571fe959f4f56a48bf
```

三对镜像均为 `MIRROR-IDENTICAL`。`memory.service.js` 的 `2f6d1b5c…` 同时是本轮
16 条负控共同的 known-clean baseline（§11）。

> **哈希演进**：`memory.service.js` 在 §8 的 teardown 调查全程逐字节未变
> （`e7a0f107…`），这是「§8 是测试夹具修正、不是产品改动」的可复核依据；
> 它在 §9 的复审返工中才首次改变（`e7a0f107…` → `9d409b4e…`），
> 因为那一轮才动了产品的状态模型与输出；`§10` 的第 2 轮返工再改一次
> （`9d409b4e…` → `2f6d1b5c…`），那次只做了一件事 —— 移除为测试而加的导出。

---

## 4. 承重负控 A–G（第 1 轮记录 —— 已被 §9 与 Appendix A 取代）

> ⚠️ **本节是第 1 轮的历史记录，不再是当前证据。** 2026-08-07 的复审判定本轮
> 负控存在可证伪性缺口（详见 §9.3）：九项零副作用里只有四项有 guard，且
> `marker write count = 0` 用「文件存在性未变」替代 —— **覆写检测不到**。
> 当前有效的负控是 A–I 共 16 条，逐条 durable 记录见 **Appendix A**。
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

修正：对**该段单独**测量 —— 用 `Module._load` 钩 `@zvec/zvec` 计数，并断言
`peekMemoryIndex()` 调用前后均为 `null`。跨整个 `verify()` 测量没有意义：实体库段
合法地打开活动索引，任何在那里取的计数都被本合同不管辖的行为淹没。

> **⚠️ 本节的第一版方案已被 §10.1 取代。** 当时是**导出**
> `buildContainmentDiagnostics()` 来取得单独测量的入口 —— 那是一个只为测试存在的
> 产品导出，第 2 轮复审判为越界并已撤销。现在的入口是测试侧 `Module.prototype._compile`
> 桥接，产品导出面零新增。本节保留原文以记录当时真实发生过什么。

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

**本分支零新增导出。** `memory.service.js` 的 `module.exports` 块与 `bc3ee2f`
（Task 7 开始前）**逐字节相同**，可由下式复核：

```bash
git show bc3ee2f:.evo-lite/cli/memory.service.js   # 取其 module.exports = { … };
git show HEAD:.evo-lite/cli/memory.service.js      # 同上，diff 应为空
```

D4.1 的零副作用计数需要对诊断段**单独**测量，其入口不是产品导出，而是测试侧桥接 ——
`test/governance.js` 以 `Module.prototype._compile` 按源码加载服务模块，并在编译文本
尾部追加一行 `module.exports.__testBuildContainmentDiagnostics = buildContainmentDiagnostics;`。
该 bridge 只存在于测试自己构造的那个 module 实例上；测试另外断言正式加载的
`loaded.service.buildContainmentDiagnostics === undefined`，使「产品导出面未被扩大」
本身成为一条会红的断言，而不是一句人工结论。

> 第 1 轮曾**导出**该函数以取得测量入口，第 2 轮复审判为越界（允许修改某个文件
> ≠ 允许扩大它的产品接口）并撤销。经过见 §5.2 与 §10.1。

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

## 10. 第 2 轮全量复审返工（2026-08-07，CHANGES REQUIRED）

第 2 轮范围明显收敛：§9 的 BLOCKER 1/2 与 IMPORTANT 4 判为实质闭环，剩余问题集中在
**D4.1 的证明机制**、由此产生的**一次接口越界**，以及 plan 的 re-freeze 同步不完整。

### 10.1 BLOCKER 1 —— 为了测试而扩大了产品接口

为了单独测量诊断段的零副作用计数，实现把 `buildContainmentDiagnostics` 加进了
`memory.service.js` 的 `module.exports`。裁定：**允许修改某个文件 ≠ 允许扩大它的产品接口**。
Task 7 的边界写明「不新增生产测试 API、不扩大产品导出面」，而这正是一个只为测试存在的导出。

**修正**：从 `module.exports` 移除该函数，改由测试侧桥接 —— `test/governance.js` 用
`Module.prototype._compile` 以源码加载服务模块，并在编译文本尾部追加一行
`module.exports.__testBuildContainmentDiagnostics = buildContainmentDiagnostics;`。
产品导出面因此逐字节回到改动前，而诊断段仍可被单独测量。

### 10.2 BLOCKER 2 —— D4.1 九项零副作用的三处证明缺口

裁定接受「用调用级计数取代末态反推」的方向，但指出末态反推本身有三处不可证伪：

```text
2.1  marker 直写可被绕过        以 fs 直接覆写 marker、字节相同，末态无差异
2.2  B 未分别证明 构造 / 打开 / 读查询   三者被折叠成一条断言
2.3  C2 测的是决策而非真实 rebuild      测了决策 helper，没测产品 rebuild 入口
```

**修正**：改用 `Module._load` 拦截做调用级计数（在目标模块加载前安装，因此解构出来的
绑定也被包住），并把负控拆细 —— `C1b` 直写 marker、`B2`/`B3`/`B4` 分别对应构造 /
`initialize()` / `stats()`、`C2` 改为调用真实的 `rebuildLocalIndex()`。负控总数由 12 增至 16。

### 10.3 IMPORTANT 3 —— plan 未同步 re-freeze 后的合同

plan 仍写着四态、T12 六条、负控 A–G，而合同已改为五态、T12 八条、A–I。已机械同步。

### 10.4 本轮结果

```text
T12                  八条 case 全过
mutations A–I        16 条，16/16 effective，16/16 guardHit（见 Appendix A）
产品改动             memory.service.js 9d409b4e… → 2f6d1b5c…（移除该导出）
未触碰               memory-index.js / zvec-containment-state.js
产品导出面           逐字节回到 Task 7 开始前的状态
```

---

## 11. mutation 装置事故：被污染的基线（2026-08-07）

本节记录的是**验证装置的事务性缺陷**，不是产品逻辑缺陷。它必须留档，因为它证明了
一件比它本身更重要的事：**在没有 baseline-integrity guard 的前提下，
「12/12 effective、12/12 guardHit」这个数字不能独立作为可信证据。**

### 11.1 发生了什么

一次 `C4 → D → E` 的批处理在 D 施加变异后、还原之前被中断。旧 runner 只在正常路径还原，
进程被杀就没有兜底，于是 `memory.service.js` 停在 D 的变异态。随后 E、F 在这个被污染的
文件上跑完并被记为 effective。

### 11.2 为什么当时没被发现

事故后的排查用了一组**手写**的残留模式（`acquireArchiveMarkerLock`、
`rebuildLocalIndex().catch`、`new M.ZvecMemoryIndex` 等），而 D 不新增语句、只替换一行
字符串文案，恰好不在这组模式里，于是被判为「无残留」。

同时被误当作证据的还有一条：

```text
live SHA == template SHA
```

这只证明 **mirror consistency**，不证明 **baseline integrity** —— runner 本来就把变异
同步写进镜像，被污染的基线同样是镜像一致的。这次事故正是它的反例。

### 11.3 事后如何被坐实

`mutations-task7-results.json` 里本来就带着证明：A–C4 记录的 `baselineSha` 是
`2f6d1b5c…`（干净基线），而 E、F 记录的是 `5509ea6c…`。重跑 D 时 runner 打印的
`MUT D applied: 5509ea6c…` 与之逐字节相同 —— 污染链条由此闭环。

### 11.4 旧 E/F 的处置

不静默覆盖。两条旧记录在结果文件中标为：

```text
evidenceStatus       inadmissible
inadmissibleReason   contaminated baseline: inherited mutation D residue from an
                     interrupted run; baselineSha 5509ea6c… is the D-mutated file,
                     not the clean baseline.
```

重跑后的记录带 `supersedes` 字段引用它。**旧 E/F 不是失败的负控，而是证据不可采信**
—— 这个区别必须保留，删除历史会丢掉它。

### 11.5 装置加固

**A. 还原不再依赖上一次进程的收尾。** `try/finally` 覆盖普通异常，`SIGINT` 可以处理，
但 `SIGKILL` 与宿主进程死亡下不存在任何进程内兜底。因此 crash recovery 放在
**下一次启动的 preflight**：

```text
run-mutations-task7.js <ID>
  PRE      从 task7-baseline/ 快照 recover-if-dirty
           再证明 live == template == known-clean SHA 且 residue scan clean
           任何一项不成立 -> 拒绝施加变异，exit 2
  MUTATE   施加恰好一条；证明 mutated SHA != baseline SHA
  TEST     整套；期望非零；期望红点落在专属断言（guardHit）
  RESTORE  立即还原，再做同样的四重校验；不成立 -> exit 3
  CLEANUP  清掉本次留下的 temp runtime root
```

快照只能由 `--adopt-baseline` **显式**采纳，且采纳时校验 16 条锚点各出现恰好一次 ——
隐式采纳磁盘上的现状，正是变异文件变成「基线」的路径。

**B. 手写 residue pattern 已废弃。** 检测改为按**出现次数**比对，逐 mutation、
锚点（`from`）与替换（`to`）各一条不变量，期望值从干净基线字节**派生**而非手写：

```text
mutation id + 变异点 + from 片段 + to 片段 + 干净基线下的期望出现次数
```

这同时解决了 G 的假阳性 —— G 的替换文本本就合法地存在于 `unsafe` 那条 remediation 里，
它在干净基线下的期望次数就是 1，残留表现为 2，不需要任何特判。v1 里为 G 加的特判已删除。

**C. 检测器本身做了负控。** 它上一轮漏掉了 D，所以不能只靠「这次写对了」：

```text
D  （上次漏掉的）  caught: residue D/anchor + D/replacement
G  （上次假阳性）  caught: residue G/anchor + G/replacement，无特判
B  （插入型）      caught: residue B/replacement（锚点仍在，符合设计）
干净态             clean
```

**D. temp root 累积。** `createTempRuntimeRoot()` 从不清理，约 30 轮全量跑累计出
112,054 个目录，使后续每次 `mkdtempSync` 逐步变慢，最终表现为「套件卡住」。
runner 现在每条变异跑完即清理。**这仍是夹具的既有缺陷，不在 Task 7 授权范围内修改，
留作已知债。**

### 11.6 本轮重跑

D、E、F、G、H、I 六条，逐条 **1 mutation / 1 full suite / 1 restore verification**，
不再批处理；每条 PRE 与 RESTORE 均打印四重校验结果，见 Appendix A 的 `txn` 列。

```text
D  effective  guardHit  mutated 5509ea6c…  restored 2f6d1b5c…
E  effective  guardHit  mutated 59c90665…  restored 2f6d1b5c…
F  effective  guardHit  mutated ed3723a9…  restored 2f6d1b5c…
G  effective  guardHit  mutated 496988bd…  restored 2f6d1b5c…
H  effective  guardHit  mutated c6b899e2…  restored 2f6d1b5c…
I  effective  guardHit  mutated d1c2201f…  restored 2f6d1b5c…
```

A–C4 的 `baselineSha` 与本轮干净基线逐字节相同，按裁定保留、不要求重跑；
但它们跑在事务化 runner 之前，Appendix A 的 `txn` 列如实记为 `no`。

`C2` 是例外：§12 的 closeout 修正了它那条附加 guard 的监视根，因此又单跑了一次，
`txn` 转为 `yes`（`mutated 8f4353e2… / restored 2f6d1b5c…`，仍 effective + guardHit）。

---

## 12. Closeout（2026-08-07，第 3 轮复审后）

第 3 轮复审判定 **Task 7 产品实现与 AC6 合同 ACCEPTED，无新 functional BLOCKER**，
但要求先做一次 evidence hygiene closeout —— 证据文档与测试注释里留有几处与最终实现
**自相矛盾**的旧表述。授权范围严格限于以下四项，不含产品重新设计、不改 spec、
不碰 `memory-index` / `zvec-containment-state` / runtime / harness。

| 项 | 处置 |
|---|---|
| §5.2 / §6 | §5.2 标明其第一版方案已被 §10.1 supersede；§6 由「唯一新增的导出是…」改为「零新增导出 + `_compile` test bridge」，并给出可复核命令 |
| §2 | 当前门改为 `TEMP=<ABS-SHORT>`；旧的 `TEMP=RUNNER~1` 明确标为 historical notation |
| T12 注释 / banner | `Six cases` → `Eight cases`；banner `four states` → `five states` |
| `fs.indexWrite` 监视根 | `runtimeRoot/index_memory` → `anchor.paths.rootPath`，同步 template，修正注释 |

### 12.1 `fs.indexWrite` 监视根为什么是错的

`zvecPaths(dbPath).rootPath === dirname(dbPath)/zvec`，即 case 6 下应为
`anchor.base/zvec`。原先监视 `runtimeRoot/index_memory` —— **那是 Zvec 引擎根本不会
写入的目录**，因此 `fs.indexWrite` 永远不可能开火，等于一条静默失效的 guard，
而注释还声称 Zvec 路径也由 runtime root 决定。

这不推翻 C2：C2 的承重负控走的是真实 `rebuildLocalIndex()` 入口，
guardHit 命中 `memory-index.resolveRecoveryRebuildDecision`。修正后重跑确认仍
effective + guardHit。

> **⚠️ 仍未证明的部分，不得写成已闭环。** `fs.indexWrite` 现在监视的是 Zvec 引擎
> 确实会写入的目录，但它在 forbidden 列表中排在
> `memory-index.resolveRecoveryRebuildDecision` **之后**，而任何进入 rebuild 的突变
> 都会先触发后者。因此本轮**没有**任何一条负控能让 `fs.indexWrite` 单独变红 ——
> 它比修正前更有针对性，但**仍是一条未被独立证伪的附加 guard**。
> 要证伪它需要一条「绕开 `resolveRecoveryRebuildDecision` 直接写 Zvec 树」的新突变，
> 那超出 closeout 授权范围。

### 12.2 本轮未做的事

```text
产品源码            零改动（memory.service.js 仍为 2f6d1b5c…）
spec                未改
16 条 mutation      未要求重跑；仅 C2 因监视根修正单跑一次确认
createTempRuntimeRoot cleanup debt   VALID FOLLOW-UP，本次明确不修
```

---

## Appendix A — 承重负控 A–I 逐条 durable 记录

每条记录由 `.evo-lite/generated/run-mutations-task7.js` 直接转写，未经手工编辑。
字段含义见 spec §7.5 D7。`txn` 表示该条是在事务化 runner 下跑的 ——
即 PRE 阶段以快照证明基线干净、RESTORE 阶段四重校验回到基线（见 §10）。

```text
id    effective  guardHit  baseline==clean  txn  evidence
A     yes        yes       yes              no   admissible
B     yes        yes       yes              no   admissible
B2    yes        yes       yes              no   admissible
B3    yes        yes       yes              no   admissible
B4    yes        yes       yes              no   admissible
C1    yes        yes       yes              no   admissible
C1b   yes        yes       yes              no   admissible
C2    yes        yes       yes              yes  admissible
C3    yes        yes       yes              no   admissible
C4    yes        yes       yes              no   admissible
D     yes        yes       yes              yes  admissible
E     yes        yes       yes              yes  admissible
F     yes        yes       yes              yes  admissible
G     yes        yes       yes              yes  admissible
H     yes        yes       yes              yes  admissible
I     yes        yes       yes              yes  admissible
```

共 16 条，16/16 effective，16/16 命中各自的守护断言。

### A

- 守护性质：containment section must not load @zvec/zvec (D4.1 #1)
- 变异点：`.evo-lite/cli/memory.service.js` — buildContainmentDiagnostics() first statement
- 镜像：`templates/cli/memory.service.js`（逐字节同步施加与还原）

原文：

    function buildContainmentDiagnostics() {
        const decision = peekEngineDecision();

改为：

    function buildContainmentDiagnostics() {
        try { require('@zvec/zvec'); } catch (_) {}
        const decision = peekEngineDecision();

结果：

```text
exit                1  (expected non-zero)
guardHit            true
assertions captured 2
baseline  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
mutated   sha256    4caa9fd0408c16ae0fe5ed01d0cbcbe17ff450e55e5ff0f0dd0dde7ebe2b8501
restored  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
restored mirror     2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e  MIRROR-IDENTICAL
baseline verified   no (pre-transactional runner; baselineSha 与干净基线逐字节相同)
evidence            admissible
```

观察到的守护断言：

```text
the containment section must not perform: Zvec native require (§7.5 D4.1, control A) — observed 1 call(s) to zvec.require
```

### B

- 守护性质：containment section must not construct an index / open the collection (D4.1 #2-4)
- 变异点：`.evo-lite/cli/memory.service.js` — before `const reason = ...` in buildContainmentDiagnostics()
- 镜像：`templates/cli/memory.service.js`（逐字节同步施加与还原）

原文：

        const reason = decision ? decision.reason : null;

改为：

        try { getMemoryIndex(); } catch (_) {}
        const reason = decision ? decision.reason : null;

结果：

```text
exit                1  (expected non-zero)
guardHit            true
assertions captured 2
baseline  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
mutated   sha256    f37e8d101db39e74b89dd6b3c3c0930b941de672e7fb73afb7400faf4c3cdd11
restored  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
restored mirror     2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e  MIRROR-IDENTICAL
baseline verified   no (pre-transactional runner; baselineSha 与干净基线逐字节相同)
evidence            admissible
```

观察到的守护断言：

```text
the containment section must not perform: index acquisition (upstream entry) (§7.5 D4.1, control B) — observed 1 call(s) to memory-index.getMemoryIndex
```

### B2

- 守护性质：containment section must not construct a Zvec index (D4.1 #2)
- 变异点：`.evo-lite/cli/memory.service.js` — before `const reason = ...` in buildContainmentDiagnostics()
- 镜像：`templates/cli/memory.service.js`（逐字节同步施加与还原）

原文：

        const reason = decision ? decision.reason : null;

改为：

        if (marker.status === 'present') { try { const M = require('./memory-index-zvec'); new M.ZvecMemoryIndex({}); } catch (_) {} }
        const reason = decision ? decision.reason : null;

结果：

```text
exit                1  (expected non-zero)
guardHit            true
assertions captured 2
baseline  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
mutated   sha256    7a79c577be0cac632410efac61535d00424531eaa010bc481ffc1e5bc17283d1
restored  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
restored mirror     2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e  MIRROR-IDENTICAL
baseline verified   no (pre-transactional runner; baselineSha 与干净基线逐字节相同)
evidence            admissible
```

观察到的守护断言：

```text
the containment section must not perform: Zvec index construction (§7.5 D4.1, control B2) — observed 1 call(s) to zvec.construct
```

### B3

- 守护性质：containment section must not open the collection (D4.1 #3)
- 变异点：`.evo-lite/cli/memory.service.js` — before `const reason = ...` in buildContainmentDiagnostics()
- 镜像：`templates/cli/memory.service.js`（逐字节同步施加与还原）

原文：

        const reason = decision ? decision.reason : null;

改为：

        if (marker.status === 'present') { try { const M = require('./memory-index-zvec'); new M.ZvecMemoryIndex({}).initialize(); } catch (_) {} }
        const reason = decision ? decision.reason : null;

结果：

```text
exit                1  (expected non-zero)
guardHit            true
assertions captured 2
baseline  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
mutated   sha256    aa56f06dea95abb5229f7e252c598e6c9467455bb22aa01ca5fe7468536286be
restored  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
restored mirror     2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e  MIRROR-IDENTICAL
baseline verified   no (pre-transactional runner; baselineSha 与干净基线逐字节相同)
evidence            admissible
```

观察到的守护断言：

```text
the containment section must not perform: collection open (§7.5 D4.1, control B3) — observed 1 call(s) to zvec.open
```

### B4

- 守护性质：containment section must not read/query the collection (D4.1 #4)
- 变异点：`.evo-lite/cli/memory.service.js` — before `const reason = ...` in buildContainmentDiagnostics()
- 镜像：`templates/cli/memory.service.js`（逐字节同步施加与还原）

原文：

        const reason = decision ? decision.reason : null;

改为：

        if (marker.status === 'present') { try { const M = require('./memory-index-zvec'); new M.ZvecMemoryIndex({}).stats(); } catch (_) {} }
        const reason = decision ? decision.reason : null;

结果：

```text
exit                1  (expected non-zero)
guardHit            true
assertions captured 2
baseline  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
mutated   sha256    33073341fb9746030da671f64a2578a26e55dee0f6740d2dfba5eadebf1ba4d3
restored  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
restored mirror     2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e  MIRROR-IDENTICAL
baseline verified   no (pre-transactional runner; baselineSha 与干净基线逐字节相同)
evidence            admissible
```

观察到的守护断言：

```text
the containment section must not perform: collection read / query (§7.5 D4.1, control B4) — observed 1 call(s) to zvec.query
```

### C1

- 守护性质：containment section must not clear the marker (D4.1 #6)
- 变异点：`.evo-lite/cli/memory.service.js` — before `const reason = ...` in buildContainmentDiagnostics()
- 镜像：`templates/cli/memory.service.js`（逐字节同步施加与还原）

原文：

        const reason = decision ? decision.reason : null;

改为：

        try { clearContainmentState(markerDir); } catch (_) {}
        const reason = decision ? decision.reason : null;

结果：

```text
exit                1  (expected non-zero)
guardHit            true
assertions captured 2
baseline  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
mutated   sha256    054995b705cc34cf498f4880aa6b7d2701a4326c796ffc3aa63f39503b4a3e46
restored  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
restored mirror     2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e  MIRROR-IDENTICAL
baseline verified   no (pre-transactional runner; baselineSha 与干净基线逐字节相同)
evidence            admissible
```

观察到的守护断言：

```text
the containment section must not perform: marker clear (§7.5 D4.1, control C1) — observed 1 call(s) to memory-index.clearContainmentState
```

### C1b

- 守护性质：containment section must not write the marker directly via fs, even with identical bytes (D4.1 #5)
- 变异点：`.evo-lite/cli/memory.service.js` — before `const reason = ...` in buildContainmentDiagnostics()
- 镜像：`templates/cli/memory.service.js`（逐字节同步施加与还原）

原文：

        const reason = decision ? decision.reason : null;

改为：

        try { fs.writeFileSync(marker.markerPath, fs.readFileSync(marker.markerPath)); } catch (_) {}
        const reason = decision ? decision.reason : null;

结果：

```text
exit                1  (expected non-zero)
guardHit            true
assertions captured 2
baseline  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
mutated   sha256    80a17f98f7755a4f211feffea6ecd12c4253a82f6db7ce8f57918e583a054d36
restored  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
restored mirror     2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e  MIRROR-IDENTICAL
baseline verified   no (pre-transactional runner; baselineSha 与干净基线逐字节相同)
evidence            admissible
```

观察到的守护断言：

```text
the containment section must not perform: direct filesystem write to the marker (§7.5 D4.1, control C1b) — observed 1 call(s) to fs.markerWrite
```

### C2

- 守护性质：containment section must not enter the real rebuild path (D4.1 #7)
- 变异点：`.evo-lite/cli/memory.service.js` — before `const reason = ...` in buildContainmentDiagnostics()
- 镜像：`templates/cli/memory.service.js`（逐字节同步施加与还原）

原文：

        const reason = decision ? decision.reason : null;

改为：

        if (marker.status === 'present') { try { rebuildLocalIndex().catch(() => {}); } catch (_) {} }
        const reason = decision ? decision.reason : null;

结果：

```text
exit                1  (expected non-zero)
guardHit            true
assertions captured 2
baseline  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
mutated   sha256    8f4353e2b7bd4f81785b869dd804c15c70f67a7bf85c8a2288130633aa18c74e
restored  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
restored mirror     2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e  MIRROR-IDENTICAL
baseline verified   yes (transactional runner: PRE + RESTORE 四重校验)
evidence            admissible
```

观察到的守护断言：

```text
the containment section must not perform: entering the rebuild path (§7.5 D4.1, control C2) — observed 2 call(s) to memory-index.resolveRecoveryRebuildDecision
```

### C3

- 守护性质：containment section must not acquire recovery ownership / lease (D4.1 #8)
- 变异点：`.evo-lite/cli/memory.service.js` — before `const reason = ...` in buildContainmentDiagnostics()
- 镜像：`templates/cli/memory.service.js`（逐字节同步施加与还原）

原文：

        const reason = decision ? decision.reason : null;

改为：

        if (marker.status === 'present') { try { acquireRecoveryLease(markerDir, { generation: 1 }); } catch (_) {} }
        const reason = decision ? decision.reason : null;

结果：

```text
exit                1  (expected non-zero)
guardHit            true
assertions captured 2
baseline  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
mutated   sha256    0e50671b403ad4ba11dad5c256e47e4d219c08d8bd874fc0e531e32acfd590f3
restored  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
restored mirror     2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e  MIRROR-IDENTICAL
baseline verified   no (pre-transactional runner; baselineSha 与干净基线逐字节相同)
evidence            admissible
```

观察到的守护断言：

```text
the containment section must not perform: recovery lease acquisition (§7.5 D4.1, control C3) — observed 1 call(s) to zvec-containment-state.acquireRecoveryLease
```

### C4

- 守护性质：containment section must not write the archive publication lock (D4.1 #9)
- 变异点：`.evo-lite/cli/memory.service.js` — before `const reason = ...` in buildContainmentDiagnostics()
- 镜像：`templates/cli/memory.service.js`（逐字节同步施加与还原）

原文：

        const reason = decision ? decision.reason : null;

改为：

        if (marker.status === 'present') { try { acquireArchiveMarkerLock(markerDir); } catch (_) {} }
        const reason = decision ? decision.reason : null;

结果：

```text
exit                1  (expected non-zero)
guardHit            true
assertions captured 2
baseline  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
mutated   sha256    c76dc75aca5ba80020e514464256bec65c74a93c667538ba219ef35e71e9b1ee
restored  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
restored mirror     2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e  MIRROR-IDENTICAL
baseline verified   no (pre-transactional runner; baselineSha 与干净基线逐字节相同)
evidence            admissible
```

观察到的守护断言：

```text
the containment section must not perform: archive publication lock write (§7.5 D4.1, control C4) — observed 1 call(s) to zvec-containment-state.acquireArchiveMarkerLock
```

### D

- 守护性质：output must not claim the upstream defect or the collection is fixed (D6)
- 变异点：`.evo-lite/cli/memory.service.js` — no-debt branch of logContainmentDiagnostics()
- 镜像：`templates/cli/memory.service.js`（逐字节同步施加与还原）

原文：

            log('🧭 [Containment]: 当前没有未清偿的 containment trust debt。');

改为：

            log('🧭 [Containment]: 上游缺陷已修复，该 collection 内容确认完整。');

结果：

```text
exit                1  (expected non-zero)
guardHit            true
assertions captured 2
baseline  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
mutated   sha256    5509ea6c96b562db4ec7177dd00fed25edf05201eb521ec93d41049dab82691d
restored  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
restored mirror     2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e  MIRROR-IDENTICAL
baseline verified   yes (transactional runner: PRE + RESTORE 四重校验)
evidence            admissible
```

观察到的守护断言：

```text
no-debt: verify output must not contain the banned claim "内容确认完整" — §7.5 D6 forbids it because verify cannot证实 global history, only this process's behaviour
```

### E

- 守护性质：SAFE + marker present must report recovery-pending (D5 row 3)
- 变异点：`.evo-lite/cli/memory.service.js` — state selection chain in buildContainmentDiagnostics()
- 镜像：`templates/cli/memory.service.js`（逐字节同步施加与还原）

原文：

        } else if (reason === 'containment-recovery-pending') {
            state = 'recovery-pending';

改为：

        } else if (reason === 'containment-recovery-pending') {
            state = 'no-debt';

结果：

```text
exit                1  (expected non-zero)
guardHit            true
assertions captured 2
baseline  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
mutated   sha256    59c906656b7844c4e2e1bafb0523f9f46281fe3b3e731c6fa4b74d24d95adad9
restored  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
restored mirror     2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e  MIRROR-IDENTICAL
baseline verified   yes (transactional runner: PRE + RESTORE 四重校验)
evidence            admissible
```

观察到的守护断言：

```text
a SAFE path whose marker is still present is recovery-pending: the path stopped being dangerous, the debt did not clear — got {"state":"no-debt","engine":{"choice":"zvec","impl":"sqlite","degraded":true,"reason":"containment-recovery-pending"},"verdict":"SAFE","layer":"both","containmentReason":"sup
```

取代的旧记录（provenance，不静默覆盖）：

```text
evidenceStatus  inadmissible
baselineSha     5509ea6c96b562db4ec7177dd00fed25edf05201eb521ec93d41049dab82691d
reason          contaminated baseline: inherited mutation D residue from an interrupted run; baselineSha 5509ea6c96b562db is the D-mutated file, not the clean baseline. Not a failed control — evidence inadmissible, rerun required.
```

### F

- 守护性质：invalid/unreadable must not be folded into present (D3 / D5 row 1)
- 变异点：`.evo-lite/cli/memory.service.js` — first branch of the state selection chain
- 镜像：`templates/cli/memory.service.js`（逐字节同步施加与还原）

原文：

        if (marker.status === 'invalid' || marker.status === 'unreadable') {
            state = 'marker-damaged';

改为：

        if (false) {
            state = 'marker-damaged';

结果：

```text
exit                1  (expected non-zero)
guardHit            true
assertions captured 2
baseline  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
mutated   sha256    ed3723a94f759901f16c91ee734e1457537e5d467e56bf0585d14c331321c5f9
restored  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
restored mirror     2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e  MIRROR-IDENTICAL
baseline verified   yes (transactional runner: PRE + RESTORE 四重校验)
evidence            admissible
```

观察到的守护断言：

```text
a schema-invalid marker must surface as marker-damaged, never folded into present (§7.5 D3 / control F)
```

取代的旧记录（provenance，不静默覆盖）：

```text
evidenceStatus  inadmissible
baselineSha     5509ea6c96b562db4ec7177dd00fed25edf05201eb521ec93d41049dab82691d
reason          contaminated baseline: inherited mutation D residue from an interrupted run; baselineSha 5509ea6c96b562db is the D-mutated file, not the clean baseline. Not a failed control — evidence inadmissible, rerun required.
```

### G

- 守护性质：unsafe and recovery-pending must not share remediation text (D5)
- 变异点：`.evo-lite/cli/memory.service.js` — REMEDIATION table in logContainmentDiagnostics()
- 镜像：`templates/cli/memory.service.js`（逐字节同步施加与还原）

原文：

                step: 'containment: 路径已 SAFE 但 marker 仍在，继续使用 SQLite；请人工执行显式 rebuild，重建并经 fresh validator 重开验证通过后 marker 才会被清除。',

改为：

                step: 'containment: 当前路径不受支持，继续使用 SQLite；请先把项目迁移到受支持的 ASCII 路径（spec §5.1）后重新执行 verify。此状态下执行 rebuild 无效 —— 重建出的 collection 仍落在同一条不受支持的路径上。',

结果：

```text
exit                1  (expected non-zero)
guardHit            true
assertions captured 2
baseline  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
mutated   sha256    496988bdb244548cf10703731ce7fb2852ab4ffdd206577956982ce5966ccc23
restored  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
restored mirror     2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e  MIRROR-IDENTICAL
baseline verified   yes (transactional runner: PRE + RESTORE 四重校验)
evidence            admissible
```

观察到的守护断言：

```text
recovery-pending must point at an explicit rebuild — that is the one action that can clear this state
```

### H

- 守护性质：re-frozen D5: no-debt must not re-couple the engine dimension
- 变异点：`.evo-lite/cli/memory.service.js` — final else of the state selection chain
- 镜像：`templates/cli/memory.service.js`（逐字节同步施加与还原）

原文：

        } else {
            // marker absent. Says nothing about the engine: impl may be zvec, or sqlite
            // under an explicit pin, or sqlite because the binding is unavailable.
            state = 'no-debt';

改为：

        } else {
            state = (decision && decision.impl === 'zvec') ? 'no-debt' : 'engine-degraded';

结果：

```text
exit                1  (expected non-zero)
guardHit            true
assertions captured 2
baseline  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
mutated   sha256    c6b899e2ba773bb5910cc64f4dfad11c3922e467aaba095dcd098e4dff750cfb
restored  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
restored mirror     2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e  MIRROR-IDENTICAL
baseline verified   yes (transactional runner: PRE + RESTORE 四重校验)
evidence            admissible
```

观察到的守护断言：

```text
an explicit sqlite pin with no marker carries no containment debt — the pin is an engine choice, not a debt (§7.5 D5 row 5)
```

### I

- 守护性质：D3: the marker record must reach the operator, not just the report
- 变异点：`.evo-lite/cli/memory.service.js` — marker layer of logContainmentDiagnostics()
- 镜像：`templates/cli/memory.service.js`（逐字节同步施加与还原）

原文：

        if (diag.marker.recordedCollectionPath) {
            log(`     recordedCollectionPath=${diag.marker.recordedCollectionPath}`);
        }

改为：

        if (false) {
            log(`     recordedCollectionPath=${diag.marker.recordedCollectionPath}`);
        }

结果：

```text
exit                1  (expected non-zero)
guardHit            true
assertions captured 2
baseline  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
mutated   sha256    d1c2201fdbce7ec42a9622c2446f71ab6a592b17833e9f629ad4f2cf0a0b44e1
restored  sha256    2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e
restored mirror     2f6d1b5c3f72722154f499ec24b9c606d06f4e9d37f53daa66e32f9ade0a009e  MIRROR-IDENTICAL
baseline verified   yes (transactional runner: PRE + RESTORE 四重校验)
evidence            admissible
```

观察到的守护断言：

```text
the recorded collection path must actually reach the operator, not just the report object
```
