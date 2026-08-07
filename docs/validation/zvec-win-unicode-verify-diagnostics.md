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
  tests        T12 六条（governance）+ T-zwuc-T12-cli（integration）
  mutations    承重负控 A–G，7/7 effective，7/7 命中各自的守护断言
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
  T12 六条                           全过
  T-zwuc-T12-cli                     过
  mutations A–G                      7/7 effective
```

`TEMP=RUNNER~1` 是 Windows runner 的真实短名形状，必须一并跑 —— 该路径本身会被
containment 判为非 SAFE，是最容易暴露诊断段副作用的环境。

---

## 3. 最终文件哈希（SHA-256，live 与 template 逐对一致）

```text
memory.service.js    e7a0f1075012d407e37c14b148a824ec91ae90c35708390304a229700a488c22
test/governance.js   66a1873b2a3703f2ef6019f96be2a6f6cc4f2b29a20f177ae840aa389bb0bbb4
test/integration.js  530b5471bdf72bb8070f60e48c08fe040572cf2eadc0a339dceb078a401929c2
```

三对镜像均为 `MIRROR-IDENTICAL`。

> `test/governance.js` 的哈希在 §8 的 teardown 修正中变化过一次
> （`96ac89df…` → `66a1873b…`）。`memory.service.js` 与 `test/integration.js`
> 自 `57979db` 起逐字节未变 —— 这是「§8 是测试夹具修正、不是产品改动」的可复核依据。

---

## 4. 承重负控 A–G

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
