# Evidence fixture — @zvec/zvec 0.7.0 五格安装矩阵(Step 2A)

服务于 `[zvec-win-unicode-containment]` 上游复核的**第二步**,前序证据见
`docs/validation/zvec-070-win-unicode-recheck.md`。

> **只回答一个问题**:`@zvec/zvec@0.7.0` 能否在本项目声称支持的五个 runtime cell 上完成
> **install → binding load → 最小 native create/open/close**。

## 这不是什么

- **不是** release-gate,不 gate 任何东西。
- **不是**生产代码。不在 `templates/`,**未**登记进 `template-manifest.js`,不随 scaffold 分发,
  不参与 `npm test`。
- **不是**放行依据。五格全绿也**不能**推出:升 pin · 进 `RUNTIME_DEPENDENCIES` ·
  optional→mandatory · 默认翻转 · 放松 containment · 任何发布决定。

## 为什么分三层而不是一个勾

失败边界本身就是结论。这四件事必须可区分:

```
装不上
    != 装上了但 native binding 加载不了
    != binding 加载了但基本 native 操作失败
    != 基本 native 操作可用,但 create-evo-lite 的实际 API 用法不兼容
```

**第四层刻意不在本轮范围内。** 它是下一关。

## 五格

```
ubuntu-latest    node 20 / 22 / 24
windows-latest   node 22 / 24
```

windows + node 20 的排除沿用 release-gate 既有理由(better-sqlite3 无 win-x64 node-20
预构建、runner 无可探测的 MSVC),因此本项目的支持格是五个而非六个。

## 记录什么

每格产出一份 `cell-result.json`,含:

```
env       node / platform / arch / osRelease / probeDir
install   ok | failed（由 workflow step 的 outcome 传入）
load      resolvedBinding 绝对路径 · installedVersion · versionMatchesRequested
smoke     completed | js-error | process-death | timeout | skipped
          stages · lastStage · exitCode · signal · loadedBinding
verdict   SATISFIED | NOT_SATISFIED
```

**不是最后只留五个绿勾。** 每格的实际 binding 路径与到达阶段都落盘,可核对。

## 三条不得放宽的约束

**1. binding 由父进程解析并绝对注入。** `cell-runner.js` 从 `--probe-dir` 解析,子进程
**从不**裸 `require('@zvec/zvec')` —— 裸 require 会从子进程文件位置向上解析,可能命中无关的
`node_modules`,`zvec-06` 那轮就是这样变成混版测量的。子进程把实际加载路径写进 `child_start`。

**2. native 冒烟必须在子进程里。** 已知失效模式是不可捕获的 `0xC0000409`;跑在 runner 内会
把整格连同它要产出的记录一起带走。

**3. fail closed。** 任一层失败 → `NOT_SATISFIED`,runner 退出码非零。
**不做自动 workaround,不改平台支持范围,不 exclude 某一格来把矩阵做绿。**
`--probe-dir` / `--out` 传相对路径直接 `exit 2`,不 `path.resolve()` 修好后继续跑。

## 运行

CI:推送到 `measure/zvec-070-install-matrix` 分支,或手动 `workflow_dispatch`。

本地单格:

```bash
mkdir -p /abs/probe && cd /abs/probe
printf '{"name":"zvec070-cell","private":true,"version":"1.0.0"}\n' > package.json
npm install @zvec/zvec@0.7.0

node docs/validation/fixtures/zvec-070-install-matrix/cell-runner.js \
  --probe-dir /abs/probe --install-status success \
  --cell local --version 0.7.0 --out /abs/cell-result.json
```
