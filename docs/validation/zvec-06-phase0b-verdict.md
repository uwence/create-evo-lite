# zvec 0.6 升级 — Phase 0 / 0B 验证判决

- 议题:`[zvec-06-upgrade]`
- 阶段:**Phase 0**(隔离分支兼容性预检)+ **Phase 0B**(FTS 正确性 RED/GREEN)
- 日期:2026-07-30 ~ 2026-07-31
- 隔离分支:`codex/zvec-06-preflight`(base `7041436`)
- 生产影响:**无** —— 未改任何读写路径、MCP、锁协调、Architecture IR、FOCUS、backlog
- 环境:Node v22.22.2 / win32 x64 / npm 10.9.7;`@zvec/zvec` 精确固定 `0.6.0`(不用 `^`,避免预检期对象漂移)

## 判决

```
CONTINUE
议题重分类:功能升级 → P0 现存正确性缺陷修复

核心理由(真实路径 RED/GREEN)     2 项
次要部署收益                     1 项
未复现假设(不采信)               1 项
计划外发现(独立议题)             1 项
```

升级理由**不按数量投票**:下述两项各自足以支持升级。

---

## 一、事实修正:原立项前提被证伪

设计文档记载「0.5.0 无 readOnly;reader/writer 拆分随 `[zvec-06-upgrade]` 落地」。**不成立。**

七项跨进程并发矩阵(真实临时 collection + 真实独立 OS 进程,非函数 arity / 源码 grep / 同进程双实例):

| # | 场景 | 0.5.0 | 0.6.0 |
|---|---|---|---|
| 0 | **负控** writer × writer | BLOCKED | BLOCKED |
| 1 | readerA `{readOnly:true}` | OK | OK |
| 2 | readerB 与 A 并发 | OK | OK |
| 3 | reader 存活时 writer | BLOCKED | BLOCKED |
| 4 | 所有 reader 关闭后 writer | OK | OK |
| 5 | writer 存活时 reader | BLOCKED | BLOCKED |
| 6 | writer 关闭后 reader | OK | OK |

锁错误契约两版一致:`name=InternalError` / `code=ZVEC_INTERNAL_ERROR` / `matchesCanLock=true` / `hasCause=false` → 现行 `isLockError()` 仍然识别。

负控是承重的:若没有「两个可写打开必须冲突」这一行,第 2 行的 OK 完全可能只是夹具测不出任何冲突。负控 BLOCKED,所以共享读是真的。

> **测量方法更正(2026-07-31)**:上表首次采集时,holder 子进程写在 `os.tmpdir()`
> 里并裸 `require('@zvec/zvec')`。Node 从脚本所在目录向上解析,于是它命中的是开发机上
> 一个**游离的用户级 `node_modules`(0.5.0)**,而非本仓安装 —— 即「0.6.0」那一列实际是
> **0.5-holder × 0.6-prober 的混版测量**。该缺陷同时是 release-gate Windows 侧连红八天的
> 根因之一(见 `main@484897c`)。
>
> 修复后(holder 经 argv 接收 `require.resolve('@zvec/zvec')` 绝对路径,两端保证同一
> binding)对 0.5.0 与 0.6.0 各重测一次,**七行取值与上表逐行相同**:结论未变,但此前它
> 建立在一次无效测量上。现在的依据是同版对同版。

**结论**:0.5 RED 未出现,且不应被制造。原前提作废(已在设计文档与 W0-core 判决追加 errata,原文未抹除)。该证伪不牵连 a177 的写锁协调结论。

---

## 二、核心理由 A(P0):空 namespace 的 scalar filter 回退为「不过滤」

`ZVEC-NS-ZERO-CANDIDATE-LEAK`

0.5.0 无法区分「没有 candidate 限制」与「过滤器已执行但命中 0 条」,把空 candidate 列表当作「不过滤」。

**真实发货路径复现**(`ZvecMemoryIndex.searchText()`,经 `EVO_LITE_ROOT`/`EVO_LITE_DB_PATH` 重定向到临时根;`.evo-lite/zvec` 正式派生目录未触碰):

```
数据:prose 2 条 + symbol 1 条;code namespace 【留空】

                                  0.5.0        0.6.0
控制 scope=all   "zqxjkvbrw"      1 [prose]    1 [prose]
控制 scope=prose "zqxjkvbrw"      1 [prose]    1 [prose]
契约 scope=code  "zqxjkvbrw"      1 [prose]    0 []
契约 scope=code  "searchText"     1 [symbol]   0 []
契约 scope=code  "ATTP"           1 [prose]    0 []
```

引擎层七个子用例同向:空 namespace、不存在的 namespace、`queryString` 与 `matchString` 两条路径、单/双引号两种 filter 写法 —— 0.5.0 全部泄漏。

**边界(精确)**:泄漏只在**标量过滤器本身命中 0 条**时发生。目标 namespace 有文档但未命中该词时,两版均正确返回 `[]`。`scope=all` 不生成 filter,不受影响。

**性质定位**:Evo-Lite 的 namespace 治理隔离缺陷 —— agent 会收到调用者用 `--scope` 明确排除的记忆类型。这是确定性的边界错误,不是相关度偏差。**没有**证据表明它构成跨用户/跨租户机密性漏洞,不按 security vulnerability 表述;作为 `--scope` 的显式合同,定为产品 P0。

**时间性质**:这是 `main` 上 2.3.0 **今天就存在**的行为,不是升级引入的风险。

---

## 三、核心理由 B(P0):未 optimize 的写入在 reopen 后静默不可检索

`ZVEC-REOPEN-WRITING-SEGMENT-INVISIBLE`

```
写 3 条 → optimize → 再写 3 条 → 未 optimize 关闭 → 重开
                       0.5.0        0.6.0
关闭前可见              6/6          6/6
重开后可见              3/6          6/6
```

**为什么该状态可达**:`ZvecMemoryIndex._finalizeSync()` 里 `try { this._col.optimizeSync(); } catch (_) {}` 把异常吞掉;进程被 kill、断电或崩溃时更是根本走不到 finalize。因此「成功写入但未 optimize」是正常可达的落盘状态。

在 0.5.0 上落到该状态的 archive **静默检索不到,任何地方都不报错**。属记忆可用性与持久性合同缺陷。

---

## 四、次要部署收益:只读 collection 的 LOCK 文件权限

将 LOCK 置为 Windows 只读属性后:

| | 0.5.0 | 0.6.0 |
|---|---|---|
| `{readOnly:true}` 打开 | THREW `Can't open lock file` | OK,查询正常 |
| 可写打开(对照) | THREW | THREW |

0.5 的 readOnly 是「锁语义只读」而非「文件权限只读」。**列为已确认的次要部署可靠性收益,不作为当前部署形态的核心升级理由。**

---

## 五、不采信:delete + optimize 的 doc-id 空洞

3 段 segment、两轮删除、三次 optimize —— 0.5.0 与 0.6.0 **21 个字段逐一相同**,两版 optimize 均未抛异常。

**未在 Evo-Lite 复现。从升级理由与验收声明中移除。** 可作为上游已知修复备注保留,但本项目**不得声称验证过**。

---

## 六、旧 collection 兼容(0.5 生成 → 0.6 打开)

干净临时副本,正式派生目录未触碰:

```
read-only 打开 OK 530ms / 133 docs    writable 打开 OK 265ms / 133 docs
插入 OK    optimize OK    close OK    重开 134 docs,probe 命中 1
```

**原地兼容,无需 rebuild。** 无 schema / FTS / LOCK 错误。

## 七、Windows native 包门

`require('@zvec/zvec')` OK;`npm ls` → `@zvec/zvec@0.6.0`;临时 collection create/open/query/close 全通过。

附带观测:新导出 `ZVecGetIOBackendType()` 返回 `0`(「No async I/O backend available … DiskAnn will fall back to synchronous pread()」)。这是 libaio 相关的 Linux 提示,Windows 上属预期,**不影响 FTS 路径**。

---

## 八、计划外发现:非 ASCII collection 路径硬崩溃(独立议题)

```
路径                       0.5.0        0.6.0
中文-日本語-한국어          0xC0000409   0xC0000409
日本語-한국어               0xC0000409   0xC0000409
中文語-中文語               0xC0000409   0xC0000409
日本語 한국어               0xC0000409   0xC0000409
日本語.한국어               0xC0000409   0xC0000409
日本語_한국어               OK           OK
中文中文-中文中文            OK           OK
中文目录 / 中文 mixed 目录   OK           OK
纯 ASCII(含 106 字节长路径) OK           OK
```

- `0xC0000409` = `STATUS_STACK_BUFFER_OVERRUN`,**原生 fail-fast,进程被 OS 终止**。不是 JS 异常,`try/catch` 拿不到,**无法降级**。
- 崩在 `insertSync`;`create` 与 index 均成功。
- 确定性:同一路径 3/3 复现;ASCII 与纯中文 3/3 通过。
- 触发规则**未能收敛**:19 字节的 `-`/空格/`.` 崩,同样 19 字节的 `_` 不崩,25 字节的 `-` 反而通过。既非长度也非单纯字符集。
- **两版逐行相同** → 不是 0.6 引入的回归,0.6 也没有修它。

**阻断关系(三道门必须分开)**:

```
0.6 依赖合并门          不阻断  —— 两版行为相同,升级未新增该风险
下一次正式发布门        阻断    —— 已知合法用户路径可能硬崩溃
Windows 非 ASCII 子仓 rollout 门  必须阻断
```

转独立议题 `[zvec-win-unicode-path-containment]`(P0 / affected Windows topology)。**不得**基于字符黑名单、字节长度、`try/catch insertSync`、或「纯中文实测通过即放行」来处置 —— 本矩阵已证明这些规则都不可靠。

---

## 九、固化的常驻合同测试

| 测试 | 0.5.0 | 0.6.0 |
|---|---|---|
| `T-zvec-namespace-isolation` | RED | GREEN |
| `T-zvec-reopen-visibility` | RED | GREEN |
| `T-zvec06-readonly-matrix` | GREEN | GREEN(跨版本行为合同,非升级判据) |

前两条均验证过**失败在目标断言上**,不是控制项误伤;两条都带前置控制项(无过滤器必须查得到、命中的过滤器必须返回自身 namespace),所以空结果不可能空过。

`T-zvec-reopen-visibility` 用 `second._dirty = false` 作为**白盒 fault injection seam**,精确复刻「optimize 未发生」的落盘路径,已在注释中显式标注,防止后续维护者误读为业务用法或改名后静默失效。

## 十、门

```
全量测试(0.6.0)   EVO_LITE_TEST_SCOPE=all  exit=0,0 条 AssertionError
template/runtime   governance.js / integration.js / harness.js SHA256 一致
sync-runtime       copied: 0;--check in-sync
git                clean;main 未动,未合并
backlog / FOCUS    未改
临时产物           探针脚本与全部临时 collection 已删除
```

**CI 事实**:`release-gate.yml` 仅在 `push:main` / `pull_request:main` 触发,本分支至今未跑过 CI。CI 的 runtime 步骤用 `templates/runtime/package-lock.json`,该 lockfile **不声明** `@zvec/zvec`,因此测试解析到仓库根 `node_modules`,跑的正是根 `package.json` 固定的版本。合并前需经 PR 让 CI 实际执行。

## 十一、方法约束(本轮遵守)

- 真实临时 collection + 真实独立 OS 进程;禁用函数 arity、源码 grep、同进程对象模拟并发。
- RED 必须来自可观察行为,不得只断言版本号不是 0.6。
- 不预设 reader 与 writer 必然共存,只验证并报告真实合同。
- 旧 collection 只在复制出的临时副本上操作,不碰正式派生目录;不提交真实 collection 或二进制 fixture。
- 自身错误公开更正:第 8 项旧 collection 探针曾因**探针 filter 语法写错**(引擎要单引号、相等运算符是 `=` 非 `==`)误报一次,修正后另取干净快照复测,非 0.6 不兼容。
