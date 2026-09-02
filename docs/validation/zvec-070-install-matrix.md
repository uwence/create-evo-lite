# @zvec/zvec 0.7.0 — 五格 install / load / 最小 native 冒烟矩阵(Step 2A)

- 议题:`[zvec-win-unicode-containment]` 上游复核的**第二步**
- 阶段:**Step 2A · 只测不改**;生产代码变更:**零**
- 日期:2026-09-02
- baseline:`main@a2d7eb0`
- apparatus:`f437cd7`
- workflow run:`33602950366` — `completed / success`,head 精确 `f437cd7`
- 前序证据:`docs/validation/zvec-070-win-unicode-recheck.md`

> **只回答一个问题**:`@zvec/zvec@0.7.0` 能否在本项目声称支持的五个 runtime cell 上完成
> **install → binding load → 最小 native create/open/close**。
>
> 它**不**回答项目实际 API surface 是否兼容,也**不**构成任何 pin / 依赖 / 默认值 /
> containment / 发布决定的授权。

## 1. 结果

```
Step 2A    SATISFIED(有界)
5 / 5 cells SATISFIED,5 / 5 artifact 实际存在
```

| cell | Node 实测 | os | install | version | identity | load | smoke | verdict |
|---|---|---|---|---|---|---|---|---|
| ubuntu-latest / node 20 | v20.20.2 | 6.17.0-1022-azure | ok | 0.7.0 | MATCH | ok | completed | SATISFIED |
| ubuntu-latest / node 22 | v22.23.2 | 6.17.0-1022-azure | ok | 0.7.0 | MATCH | ok | completed | SATISFIED |
| ubuntu-latest / node 24 | v24.19.0 | 6.17.0-1022-azure | ok | 0.7.0 | MATCH | ok | completed | SATISFIED |
| windows-latest / node 22 | v22.23.2 | 10.0.26100 | ok | 0.7.0 | MATCH | ok | completed | SATISFIED |
| windows-latest / node 24 | v24.19.0 | 10.0.26100 | ok | 0.7.0 | MATCH | ok | completed | SATISFIED |

五格的子进程阶段链完全一致:

```
child_start > binding_loaded > schema_built > create_or_open > close > child_done
```

且每格 **父进程解析的 binding 与子进程实际加载的 binding 逐字节相同**——这是工件里可核的字段,
不是推断。

windows + node 20 不在矩阵内,沿用 release-gate 既有理由(better-sqlite3 无 win-x64 node-20
预构建、runner 无可探测的 MSVC),因此支持格是**五个而非六个**;这不是为了做绿而收窄。

## 2. 为什么分三层

失败边界本身就是结论。装置把这四件事分开记录:

```
装不上
    != 装上了但 native binding 加载不了
    != binding 加载了但基本 native 操作失败
    != 基本 native 操作可用,但项目实际 API 用法不兼容   ← 本轮【不在范围内】
```

第四层是 Step 2B,尚未开始。

## 3. 装置的三条约束(第一版曾违反其中两条)

**① recorder 必须在 native 执行边界之外。** 第一版在 recorder 进程里 `require(bindingPath)`,
而注释里已经写着「a native crash at require time would kill this process」——散文识别了危险,
装置没有兑现。若某格真在 LOAD 期猝死,记录会在写出前消失,而 LOAD 失败**恰恰是本矩阵最需要
区分的那条边界**。

现在 recorder 只做:解析绝对路径 → 读 `package.json` → spawn child → 解释阶段 → 写工件。
**native `require` 只发生在子进程。** LOAD/SMOKE 由阶段标记切分:

```
到过 binding_loaded ? LOAD ok    : LOAD failed / dead
到过 child_done     ? SMOKE done : SMOKE failed / dead
```

**② 记录一个事实 != 让它参与判定。** `versionMatchesRequested` 第一版只写进 JSON,verdict 不看
它 —— 于是装了别的版本也能 `SATISFIED`。现在它是 verdict 的必要条件。

**③ fail closed。** 任一层失败 → `NOT_SATISFIED` + 非零退出;`--probe-dir` / `--out` 传相对
路径直接 `exit 2`,不 `path.resolve()` 修好后继续跑;`if-no-files-found: error`,因为
**没有产出记录本身就是测量失败**,不能与「这一格从未被调度」长得一样。

两条修正各配一个突变控制,不靠断言:

```
请求 0.7.1 / 实际装 0.7.0
    smoke 仍 completed,verdict 翻成 NOT_SATISFIED
    → 版本身份是唯一改变判定的因素

binding 一 require 就抛
    记录仍然存在 ← recorder 存活
    load: js-error · smoke: skipped · lastStage: child_start
    → 边界被保留在它该在的位置
```

## 4. 两次运行的地位

```
run 33587704612 @ 706f9af   首轮,5/5 通过
                            装置存在上述两个洞 → 保留为【有效正向观察】
                            NOT authoritative apparatus

run 33602950366 @ f437cd7   修正后重跑,5/5 SATISFIED
                            → Step 2A authority
```

首轮没有踩中那两个缺陷,但「装置恰好没踩中」不等于「装置正确」,所以它不被冻结为权威。

## 5. 仍然**不能**推出

```
Step 2A SATISFIED
    != 项目 API 兼容(Step 2B,未开始)
    != 升 pin
    != 进 RUNTIME_DEPENDENCIES
    != optional → mandatory
    != 默认翻转
    != 放松 containment
    != 任何发布决定
```

**containment 不因本轮全绿而变弱。** 前序证据(`zvec-070-win-unicode-recheck.md` §2.4)测到
0.6.0 的 66 次崩溃里 57 次死在 create/open 之内、9 次死在 insert 之内,推翻了旧文档
「崩溃恒在 insertSync」的机制断言。**已知触发集在 0.7.0 上未复现,不等于我们已经理解了这个
native failure class。** 一个位置都预测不了的故障,不是可以停止防守的故障。

本轮的冒烟也**刻意最小**(schema → create/open → close)。它证明 binding 能活着完成基本操作,
不证明项目真正调用的那些操作可用。

## 6. 复现与工件

```
workflow   .github/workflows/zvec-070-install-matrix.yml
apparatus  docs/validation/fixtures/zvec-070-install-matrix/
           README.md · cell-runner.js · smoke-child.js
```

推送到 `measure/zvec-070-install-matrix` 分支或手动 `workflow_dispatch` 即触发。

五份原始 `cell-result.json` **已入库**(Actions artifact 会过期;只留「五个 job success」会
退化回本项目刻意避免的状态):

```
fixtures/zvec-070-install-matrix/results/
  ubuntu-node20.json    2b59209c69d5874e62330466d9d78776f8724b36d238ae573e850d66f9785f04
  ubuntu-node22.json    1ab72ad3373b68a307f5d2c8b5666283e88c2bd0da5f7cd86c67402b4330910a
  ubuntu-node24.json    611bf87dce18b63ea131add43aa4c82f2f61a520619c4e2999317a1f82b4898b
  windows-node22.json   4225c128b3cdaca6a128ebf595449cb3cedc15a45dcb83123bf3b9c37bf7b6f7
  windows-node24.json   efb2acd6024479527c65cbc54e4515df5d7a9e26a19fefc96a4244a1744c5ed7
```

每份含 `env`(node / platform / arch / osRelease)、`install`、`load`(resolvedBinding /
installedVersion / versionMatchesRequested)、`smoke`(stages / lastStage / exitCode /
signal / loadedBinding)与 `verdict`,因此 §1 的每一格都可由工件独立重建。
