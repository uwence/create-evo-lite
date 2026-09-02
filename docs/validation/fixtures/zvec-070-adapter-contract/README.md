# Evidence fixture — @zvec/zvec 0.7.0 对真实 adapter 的合同(Step 2B)

前序:`docs/validation/zvec-070-install-matrix.md`(Step 2A)。

> **只回答一个问题**:`@zvec/zvec@0.7.0` 能否满足
> `memory-index-zvec.js@d3ffe05d` **实际消费**的 Node API、返回值形状与持久化合同。
>
> Step 2A 回答的是「它能不能活着 create/open/close」。这里回答的是
> 「它能不能按 create-evo-lite 真正依赖的方式工作」。

## 这不是什么

- **不是**生产代码,不在 `templates/`,未登记 `template-manifest.js`,不随 scaffold 分发,
  不参与 `npm test`。
- **不是**放行依据。五格全绿也**不能**推出升 pin / 进 `RUNTIME_DEPENDENCIES` /
  optional→mandatory / 默认翻转 / 放松 containment / 任何发布决定。

## 执行的是真 adapter,不是仿写

```
handwritten reproduction of production calls
    !=
production adapter compatibility
```

仿写只能证明「我写的脚本能跑」。所以装置直接 `require` 树里的
`memory-index-zvec.js`,并**在运行时重算它的 git blob hash**写进工件——记录里说的是
哪一份源码真的跑过,不是哪一份我以为跑过。

## seam 在 adapter 外部

adapter 第 23 行是惰性的 `require('@zvec/zvec')`。**不得**为了可测性去改它加 override:
那样被测对象就不再是我们准备升级的那份代码。

装置在 harness 里拦截 `Module._load`,只重定向 `@zvec/zvec` 这一个 specifier,并记录:

```
request        被请求的 specifier
requestedBy    请求者文件(应为 adapter 本身)
redirectedTo   重定向到的绝对入口
```

seam **非空转**是可证的:`.evo-lite/node_modules` 内没有 `@zvec`,没有 seam 时 adapter 的
require 会直接抛。

## 三个进程,不是三次函数调用

adapter 的持久化合同是「写入 → close 时 finalize(optimizeSync)→ **下一个** one-shot CLI
进程能召回」。在同一进程里写完立刻查,会跳过产品真正依赖的那一段。

```
PROCESS A   initialize · upsert A · upsert B · close(触发 optimizeSync)
PROCESS B   reopen · fts · colon fallback · scope 双向 · list · stats · delete · close
PROCESS C   reopen · 删除仍生效 · 幸存者仍可查 · close
```

## 判定看行为,不看「没崩」

```
所有函数都存在   →  兼容        ✗
进程退出 0      →  兼容        ✗
```

`SATISFIED` 要求:三相全过 **且** 19 项行为检查全过 **且** seam 每相都命中且指向同一入口
**且** adapter blob 与期望一致 **且** `installedVersion === 0.7.0`。

其中两条身份闸门带突变控制:

```
期望 blob 不符    19 项行为全过,verdict 仍翻 NOT_SATISFIED
指向 0.6.0        三相行为全过,verdict 仍翻 NOT_SATISFIED
```

第二条尤其要记住:**行为检查本身分辨不出 0.6.0 与 0.7.0**(0.6.0 在 ASCII 路径上本就正常)。
是版本闸门让这份记录成为**关于 0.7.0**的记录。

## scope 检查为什么是双向的

`every(...)` 对空数组恒真,而空结果**也是查询坏掉时的样子**。所以排除方向之外必须有正控:

```
域外词 + scope=code   →  必须为空
域内词 + scope=code   →  必须非空,且命中预期行
```

## 运行

CI:推送到 `measure/zvec-070-adapter-contract` 或手动 `workflow_dispatch`。

本地单格(需先备好 better-sqlite3 与 0.7.0):

```bash
node docs/validation/fixtures/zvec-070-adapter-contract/txn-runner.js \
  --cell local --runtime-root /abs/txn-root \
  --zvec-entry /abs/probe/node_modules/@zvec/zvec/src/index.js \
  --adapter /abs/.evo-lite/cli/memory-index-zvec.js \
  --expect-blob d3ffe05d3609879f414d1621fdf8fe81434e3c4c \
  --out /abs/adapter-cell.json
```

所有路径参数必须绝对,传相对值直接 `exit 2` —— 被测对象的身份不得依赖调用者的 cwd。
