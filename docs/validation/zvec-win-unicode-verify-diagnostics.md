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
test/governance.js   96ac89dff0933f42c54fe48823531e342bd76142c48e3860b88464f3c7e4c5e0
test/integration.js  530b5471bdf72bb8070f60e48c08fe040572cf2eadc0a339dceb078a401929c2
```

三对镜像均为 `MIRROR-IDENTICAL`。

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
