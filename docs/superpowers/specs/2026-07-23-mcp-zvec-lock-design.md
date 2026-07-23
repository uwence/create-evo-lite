# [a177] mcp-zvec-lock — 锁生命周期与单写者协调设计

- 日期:2026-07-23
- 状态:R2 待批(§1/§2/§3 逐节口头批准 → 外部测试契约复阅折入 → 设计 R1
  CHANGES REQUIRED 三项已全部折入,见文末修订记录)
- 议题来源:backlog `[a177]`(4a.x/hive 可靠性;治理链路可用性优先级)
- 事故根因:2026-07-23 收口 4b-1 时,`mem commit`/`context track` 死于
  `.evo-lite/zvec/collection/LOCK` —— 8 个跨会话遗留的
  `node .evo-lite/cli/memory.js mcp` 僵尸进程持有 zvec 写锁。
- 分发范围:母仓 + hive nurture(CodePLC、hungersnakegame4)。

## 1. 问题陈述(grounded facts)

| 事实 | 出处 |
|---|---|
| `ZVecOpen = binding.open`,独占写锁,**无 readOnly 选项**(0.5.0 实测 grep 零命中) | `node_modules/@zvec/zvec/src/index.js` |
| `ZvecMemoryIndex` 假设"CLI 一命一进程":打开后靠 `process.once('exit')` finalize,进程活多久锁持多久 | `templates/cli/memory-index-zvec.js` |
| `getMemoryIndex()` 是进程级单例(`let active`),打开即终身持有 | `templates/cli/memory-index.js:215-230` |
| MCP server 只挂 `SIGINT`/`SIGTERM`,**无 stdin end/close 处理**;Windows 宿主死亡不发信号 → 僵尸进程 | `templates/cli/mcp-server.js:209-241` |
| 锁链:`evo_recall` → `recall` → `getMemoryIndex` → `ZVecOpen` → LOCK 直到进程退出 | 调用链阅读 |
| 档案规模 ~10² 文档,open/query/close 为毫秒级 → 每请求开合成本可忽略 | `mem stats` / 实测 |

一句话:**长活 MCP 进程 × 一次性 CLI 的锁假设 = 治理写链路(commit/track/索引写入)被死进程阻断,且无持有者诊断。**

## 2. 目标 / 非目标

**目标:**

1. MCP 进程不再长期持有 zvec collection(锁租期 = 单次操作)。
2. MCP 进程在宿主死亡(stdin EOF)时自行退出,不产僵尸。
3. 锁冲突可诊断:错误信息含持有者身份与可复制的排查命令。
4. 孤儿持有者(本仓自己的死会话 MCP)可**安全**自愈;任何不确定情形绝不杀进程。
5. 三层互相独立:任一层缺席(旧版子仓、旧版持有者)其余层仍正确。

**非目标(YAGNI):**

- 不做多写者并发协议 / 锁服务器 / 队列。
- 不改 `SqliteFtsIndex`(better-sqlite3 自带 WAL 并发语义,无此问题)。
- 不升级 zvec(0.6 升级 = 独立 backlog `[zvec-06-upgrade]`,见 §8 与附录 A)。
- 不做 reader/writer 模式拆分(0.5.0 无 readOnly;随 `[zvec-06-upgrade]` 落地)。

## 3. 方案总览(已批准的 Approach A:三层最小组合)

```
Layer 1  锁租期最小化   EVO_LITE_INDEX_EPHEMERAL=1 → 每次公开操作 open→op→finalize
Layer 2  进程生命周期   mcp-server 监听 stdin end/close → 收尾并退出
Layer 3  持有者协调     owner sidecar + 四道闸孤儿判定 + 安全自愈 + backoff 重试 + 富化错误
```

三层职责正交:Layer 1 让"活着的 MCP"不持锁;Layer 2 让"该死的 MCP"真的死;
Layer 3 兜底"已经存在的死持有者"并给所有剩余冲突以可行动的诊断。

## 4. 组件设计(§1,已批准 + 复阅修订)

### 4.1 新文件 `templates/cli/memory-index-lock.js`

单一职责:owner sidecar 读写 + 锁冲突诊断 + 协调打开。对 zvec 的唯一依赖是
`isLockError` 内部懒加载 `isZVecError`(zvec 不可用时退化为纯 message 匹配),
其余逻辑与引擎无关。

导出:

```js
// owner sidecar ---------------------------------------------------------
// ownerPath(dir) = path.join(dir, 'owner.json')  (dir = zvecRoot,与 collection 同级)
writeOwner(dir, { mode, projectRoot })
//   生成 leaseId(crypto.randomUUID)+ 采集 pid/ppid/entrypoint(process.argv[1])
//   /processStartedAt(自报:new Date(Date.now() - process.uptime()*1000),
//   进程内缓存一次 —— 零外部查询成本,ephemeral 每操作 open 不付 CIM 代价;
//   诊断侧与 CIM CreationDate 的 ±2s 容差正是为此)/access:'write'/createdAt(ISO);
//   写 owner.json.tmp → fsync/close → fs.renameSync 原子替换;返回 leaseId。
clearOwner(dir, leaseId)
//   CAS:读盘 owner.json,仅当 disk.leaseId === leaseId 才 unlink;
//   不匹配 / 不存在 / 损坏 → 静默不动(旧实例晚到的 finalize 不得删新实例的 owner)。
//   这是**唯一**的 owner 删除入口 —— 自愈路径与死持有者清理同样必须经此 CAS(R1 P0-1)。
readOwner(dir)
//   → { state: 'valid'|'missing'|'corrupt'|'invalid', owner, errors }
//   state === 'valid' 要求 identity-critical schema 全字段通过(R1 P0-2):
//     schemaVersion === 1;leaseId 非空字符串;pid 正整数;ppid 非负整数;
//     processStartedAt / createdAt 可解析为有效时间;entrypoint 非空字符串;
//     mode ∈ {'mcp','cli'};access === 'write';projectRoot 非空规范化路径。
//   missing/corrupt/invalid 一律不得进入四道闸(→ unknown),更不得进入自愈。

// 进程信息快照 -----------------------------------------------------------
getProcessSnapshot(pid, seams?)
//   一次查询取回 { alive, isNode, commandLine, ppid, ppidAlive, startedAt }:
//   win32: Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"
//          (CommandLine/ParentProcessId/CreationDate 一次取回;ppidAlive 用
//           process.kill(ppid, 0) 判,EPERM 视为存活)
//   unix:  ps -o pid=,ppid=,lstart=,command= -p <pid>
//   查询失败 / 权限不足 / 字段缺失 → 对应字段为 null(调用方按"不可确认"处理)。
//   seams:{ snapshotFn, killFn } 测试注入点(先例:EVO_WIKI_BROWSER seam)。

// 诊断与协调 -------------------------------------------------------------
isLockError(err)      // zvec.isZVecError(err) && /Can't lock/.test(err.message)
diagnoseLockConflict(dir, ctx) // → { verdict, owner, snapshot, report }
openWithCoordination(openFn, dir, ctx) // → collection 或 throw 富化错误
```

### 4.2 `diagnoseLockConflict` 判定表(§2 语义,含复阅 P0-2 修订)

verdict ∈ `'orphaned-own-mcp' | 'live-foreign' | 'unknown'`。
**只有 `orphaned-own-mcp` 允许自愈;其余一律 report-only。**

四道闸(全过才判孤儿;任何一道不过或信息不可得 → 降级):

| 闸 | 判定 | 不过时降级为 |
|---|---|---|
| ① 存活 | `process.kill(pid, 0)` 成功或 EPERM → 存活;ESRCH → 已死 | 已死 → 走"死持有者清理"(仅清 stale owner,无进程可杀) |
| ② 身份 | `isExpectedMcpProcess(snapshot, owner)`(R1 P0-2/P1):snapshot.isNode **且** commandLine 归一化后含 owner.entrypoint 对应的 `memory.js` 路径 **且** 命令 token === `mcp`(仅含 `memory.js` 不够 —— `stats`/`rebuild` 同样命中)**且** owner.processStartedAt **必须存在**并与 snapshot.startedAt 吻合(±2s 容差,格式归一后比对;缺失 = 闸不过,不是跳过) | 任一不符 → `unknown`(PID 已被复用或非本系进程,绝不杀) |
| ③ 父进程 | snapshot.ppid 已死(kill(ppid,0) ESRCH) | ppid 存活 → `live-foreign`(有人还管着它,绝不杀) |
| ④ 归属 | owner.projectRoot === 当前仓根 **且** owner.mode === 'mcp' | 不符 → `live-foreign`(别的仓/别的角色,绝不杀) |

前置条件:`readOwner().state !== 'valid'`(缺失/损坏/**缺任一 identity-critical 字段**)或 snapshot 关键字段为 null(查询失败/权限不足)→ 直接 `unknown`,不进闸、不进自愈。

`unknown` 的 report 必含:LOCK 路径、"持有者未登记(可能为旧版 evo-lite MCP)"、
可复制的 PowerShell 枚举命令(argv 数组形式给出,非拼接字符串):

```
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'memory\.js mcp' } |
  Select-Object ProcessId,ParentProcessId,CreationDate,CommandLine
```

`live-foreign` 的 report 必含:持有者 pid、verdict、**明示"不会自动终止该进程"**、同上枚举命令。

### 4.3 `openWithCoordination` 流程

```
尝试 openFn()
├─ 成功 → writeOwner → 返回
├─ 非锁错误 → 原样 rethrow(绝不吞、绝不包装成锁诊断)
└─ 锁错误 → backoff 重试 3×100ms(吸收 CLI/MCP 瞬时交错)
    ├─ 期间成功 → writeOwner → 返回
    └─ 仍失败 → diagnoseLockConflict
        ├─ orphaned-own-mcp → 自愈阶梯(4.4)→ 成功则 writeOwner 返回
        ├─ 死持有者(闸① ESRCH)→ clearOwner(dir, observedLeaseId)(CAS,
        │   基于诊断时读到的 leaseId,绝非无条件 unlink)→ 最终重试一次
        └─ live-foreign / unknown / 自愈失败 → throw 富化错误(含 report)
```

### 4.4 自愈阶梯(复阅"graceful → 确认 → hard → 等消失"修订)

仅 verdict === 'orphaned-own-mcp' 进入:

1. **身份复核**:重取 snapshot,pid/startedAt/commandLine 与诊断时一致才继续
   (窗口期内 PID 被复用 → 中止,降级 `unknown`)。
2. `process.kill(pid, 'SIGTERM')`。
3. 有界轮询(100ms 间隔,≤1.5s)等 `kill(pid,0)` 变 ESRCH。
4. 仍存活 → `process.kill(pid, 'SIGKILL')` → 再轮询 ≤1s。
   (win32 说明:两级底层同为 TerminateProcess,阶梯语义在 unix 生效,
   win32 退化为单级;**等待与复核两步在所有平台保留** —— 防 kill 返回后
   native handle 尚未释放就重开导致偶发失败。)
5. 仍存活 → 放弃自愈,throw `unknown` 富化错误(report 注明"自愈失败,进程未退出")。
6. 已消失 → `clearOwner(dir, observedLeaseId)`(R1 P0-1:observedLeaseId
   为**诊断时**读到的死者 leaseId,走 CAS —— 死者进程无法自清,但锁释放到
   删除之间存在竞态窗口:新持有者 B 可能已抢开集合并 writeOwner(leaseB),
   无条件 unlink 会误删 B 的合法 owner)。
   - CAS 命中 → 删除成功 → 最终重试 openFn 一次。
   - CAS 不匹配 → owner 已被新持有者接管,**不删除**,直接重试 openFn;
     仍锁冲突 → 重新 readOwner + 重新诊断当前持有者(最多一轮,防循环),
     按新 verdict 处置。

### 4.5 修改 `templates/cli/memory-index-zvec.js`(Layer 1)

- 构造时读 `EVO_LITE_INDEX_EPHEMERAL`(=1 → ephemeral 模式)。
- 新增私有 `_withCollection(fn)`:重入计数 `_depth`;
  `_depth++ → 确保打开(经 openWithCoordination)→ try fn() finally { _depth--;
  _depth === 0 && ephemeral && _finalizeSync() }`。
  **所有公开操作**(upsert/searchText/delete/stats/list)走此包装 ——
  异常路径也在 finally 释放(复阅"ephemeral 异常矩阵"要求)。
- `_finalizeSync` 末尾追加 `clearOwner(dir, this._leaseId)`。
- 环境变量未设 → 现行一次性行为完全不变(exit-hook finalize 保留,
  且成为 ephemeral 模式下的幂等空转)。
- `SqliteFtsIndex` 不改。

### 4.6 修改 `templates/cli/mcp-server.js`(Layer 2)

- 启动即设 `process.env.EVO_LITE_INDEX_EPHEMERAL = '1'` 与
  `process.env.EVO_LITE_PROCESS_MODE = 'mcp'`(MCP 进程内生效;两变量职责
  正交 —— 前者定锁租期,后者定进程身份)。
- `process.stdin.on('end', shutdown)` + `process.stdin.on('close', shutdown)` +
  transport/server `onclose → shutdown`。
- `shutdown()`:幂等(一次性标志)→ 停止接收新请求 → await transport/server
  close → 关闭 memory index(`close()` → finalize + clearOwner)→ 设
  `exitCode = 0` → 有界兜底定时器后才 `process.exit`(避免强制中断进行中的
  recall;具体时序细化留给实施计划)。
- 现有 `SIGINT`/`SIGTERM` 处理保留,收敛到同一 `shutdown()`。

### 4.7 Owner sidecar schema(复阅 P0 修订版)

```json
{
  "schemaVersion": 1,
  "leaseId": "<uuid>",
  "pid": 12345,
  "ppid": 100,
  "processStartedAt": "2026-07-23T08:00:00.000Z",
  "entrypoint": "D:/…/.evo-lite/cli/memory.js",
  "mode": "mcp",
  "access": "write",
  "projectRoot": "D:/Data/ProjectAgent/create-evo-lite",
  "createdAt": "2026-07-23T08:00:01.000Z"
}
```

- `leaseId`:同 pid 竞态防御,finalize 清理走 CAS。
- `processStartedAt`:PID 复用防御(闸②)。
- `entrypoint`:确认是 Evo-Lite memory 进程(闸②)。
- `mode: 'mcp' | 'cli'`(进程角色)。**可信来源(R1 P1):MCP bootstrap 设
  `EVO_LITE_PROCESS_MODE=mcp`,其余进程缺省 `cli`;不得由
  `EVO_LITE_INDEX_EPHEMERAL` 推导 —— ephemeral 是锁租期策略,不是进程身份。**
  且 `owner.mode` 只用于闸④的归属声明;角色的最终判定以 live snapshot 的
  命令 token(`isExpectedMcpProcess`)为准,sidecar 自报不构成杀进程依据。
- `access: 'write'`(0.5.0 全部为写;`'read'` 预留给 `[zvec-06-upgrade]`)。
- sidecar 是**观察记录不是锁**:永远以 live snapshot 复验,缺失/损坏只降级
  诊断质量,绝不成为杀进程依据。
- 向后兼容:旧子仓无 sidecar → 冲突诊断降级 `unknown`(report-only),
  其余行为不变;CLI 退出码契约不变。

## 5. 测试契约(§3,已批准 + 复阅修订;载体 `templates/cli/test/governance.js`,沿用既有 zvec 可用性 guard)

### T-lock-ephemeral(行为矩阵)

| 场景 | 断言 |
|---|---|
| success → close | op 返回后**第二个实例可立即 initialize 成功**(公共契约);`_col === null`(辅助白盒) |
| throw → close | op 内部抛错(注入坏参/损坏输入)后,finally 已释放,第二实例仍能打开 |
| nested success | 嵌套调用期间 inner 不 close,outer 归零才 finalize |
| nested throw | inner 抛错不破坏 `_depth`,outer finally 正常释放 |
| default mode | 未设环境变量 → op 后集合仍打开(现行为不变) |

### T-lock-owner

- open 后 `owner.json` 存在且含 schema v1 全字段(pid === process.pid)。
- finalize 后文件被清除。
- **lease CAS**:实例 A open→记 leaseA→模拟 A 晚到的 finalize 前,实例 B 已
  writeOwner(leaseB)→ A 的 `clearOwner(dir, leaseA)` 不删 B 的 owner.json。
- **自愈后 CAS**(R1 P0-1):模拟"诊断记 observedLeaseId → 死者消失 → 新
  持有者 writeOwner(leaseB)"时序 → `clearOwner(dir, observedLeaseId)` 不删
  leaseB 的 owner.json。
- 原子写契约(收窄为可观察断言):**目标路径只经 atomic rename 发布,
  绝不直接 truncate/write**(实现断言:writeOwner 对 owner.json 本体仅调用
  renameSync);临时文件名带 `owner.json.<pid>.<leaseId>.tmp` 后缀,
  异常遗留的旧 tmp 不影响下一次写入。
- schema 验证:8/9/10 号拒杀场景对应的 readOwner state === 'invalid'。

### T-lock-conflict-live-foreign

spawn 子进程 holder(NODE_PATH 加载真模块,打开临时 workspace 集合后驻留;
其 ppid = 测试进程,存活 → 闸③不过):

- 父进程 open → 富化错误:含 holder pid、含 `live-foreign`、
  **明示不自动终止**、含 argv 形式诊断命令。
- holder 进程仍存活(kill(pid,0) 成功)。
- holder 的 owner.json 未被父进程覆盖或删除。
- 清理只在测试 finally 执行(杀 holder + 删临时目录)。

### T-lock-orphan-selfheal(原始事故最小复刻)

中间 spawner detached 拉起孙子 holder 后退出 → 孙子 ppid 死 → 四道闸全过:

- 父进程 `openWithCoordination` → 自愈阶梯执行 → **open 成功**。
- 孙子 pid 已不存活;stale owner.json 已清;新 owner.json 属于父进程。

### T-lock-orphan-refusal-matrix(测试契约复阅 P0 + 设计 R1 增补;安全否决面)

每例断言三件套:**open 失败且错误含诊断 / 目标进程(如有)仍存活 /
owner.json 与 LOCK 未被删改**。

| # | 场景 | 模拟方式 | 预期 verdict |
|---|---|---|---|
| 1 | pid 存活但非 memory.js 进程 | owner.pid 指向测试 spawn 的 `node -e "setInterval(()=>{},1e3)"` | unknown(闸②) |
| 2 | projectRoot 不一致 | 篡改 owner.projectRoot 为他仓路径 | live-foreign(闸④) |
| 3 | ppid 仍存活 | holder 由测试进程直接 spawn | live-foreign(闸③) |
| 4 | 快照不可得 | seam 注入 snapshotFn 返回 null | unknown |
| 5 | owner 损坏 | 写半截 JSON | unknown(readOwner null) |
| 6 | PID 已复用 | owner.processStartedAt 写与快照不符的旧时间 | unknown(闸② 时间戳) |
| 7 | 权限不足 | seam 注入 snapshotFn 抛 access-denied | unknown |
| 8 | 合法 JSON 缺 processStartedAt | owner.json 删去该字段(其余全合法) | unknown(readOwner invalid) |
| 9 | 合法 JSON 缺 leaseId | owner.json 删去该字段 | unknown(readOwner invalid) |
| 10 | schemaVersion 未知 | schemaVersion: 99 | unknown(readOwner invalid) |
| 11 | 实际命令非 mcp | holder 真实运行 `memory.js stats` 驻留,owner.mode 伪造为 'mcp' | unknown(闸② 命令 token) |

### T-lock-nonlock-error-passthrough

openFn 抛非锁错误(如 schema 错误/损坏集合)→ 原样 rethrow,
不包装、不 backoff、不触发诊断、owner.json 不产生。

### T-mcp-stdin-exit

spawn `memory.js mcp` → 先经一次 evo_recall 类请求确保索引曾打开 →
`stdin.end()` → 断言(超时清理进 finally,失败不产僵尸):

1. 进程 ≤5s 内 exit code 0;
2. owner.json 已清除;
3. **新 writer 实例立即 initialize 成功**(native 锁确实释放)。

### 回归

- `memory-index-lock.js` 登记 template-manifest(+1)。
- 双侧 `node templates/cli/test.js all` 与镜像侧 all EXIT 0。
- `mem sync-runtime` 二次运行 `copied: 0`,模板/镜像 byte-identical。

## 6. 错误处理原则

- **非锁错误零干预**:识别失败宁可当非锁错误 rethrow,不误入诊断路径。
- **杀进程默认否**:四道闸任何不确定 → report-only;误报的代价(用户手动
  kill 一次)远小于误杀的代价。
- 反向冲突(MCP recall 撞 CLI 写):backoff 3×100ms 吸收;仍冲突 →
  live-foreign report(CLI 进程 ppid 是活的 shell),绝不杀。
- 所有富化错误保留原始 zvec 错误为 `cause`。

## 7. 终局门(实景验收)

1. 双侧 all 套件全绿 + 镜像二次 sync `copied: 0`。
2. 一次性存量清点:按 CreationDate 甄别并清掉现存旧版僵尸 MCP
   (此后由 Layer 2/3 接管,不再需要手动清)。
3. 真实 `mem commit` 走通 —— 闭环提交本身即 Layer 1-3 实景验证
   (MCP 常驻会话中执行 CLI 写,不再撞锁)。
4. hive nurture CodePLC + hungersnakegame4,子仓套件绿、镜像 byte-identical。
5. 治理收口:R008 证据 + plan/spec 状态 + focus 迁移。

## 8. Dependency strategy(复阅采纳)

- 锁协调**不依赖** zvec 0.6 内部行为;baseline 在当前 0.5.0 上完整正确。
- 0.6 升级(readOnly 读路径拆分、FTS 变化、native 包、索引重建、hive 分发)
  = 独立 backlog **`[zvec-06-upgrade]`**(已注册),前置为本议题收口。
- 升级失败恢复路径:raw_memory 为 canonical → 删 zvec 派生 collection →
  降级依赖 → `mem rebuild`;不依赖旧格式原地回滚。
- 升级后:纯读走 `open(path, {readOnly:true})`,写走 coordinated writable;
  ephemeral 仍是默认锁租期边界。

## 附录 A:T-zvec06-readonly-matrix(供 [zvec-06-upgrade] 承接,本议题不实现)

在隔离分支 bump 至 0.6 后实测(不信文档推测):

1. reader A 打开成功;2. reader B 并发打开成功;3. reader 存活时 writer 是否失败;
4. reader close 后 writer 是否立即成功;5. writer 存活时 reader 是否失败;
6. writer close 后 reader 是否恢复;7. Windows + Node binding 的错误形状
   (isZVecError / message 是否仍匹配 `isLockError`)。

实测结论决定:MCP 可否长活持有 read-only handle,还是维持每请求开合;
coordinator 是否需要同时管理 reader 与 writer。

## 修订记录

**R1(2026-07-23,外部设计复阅 CHANGES REQUIRED → 三项全部折入):**

1. **P0-1 自愈后 CAS 删除**:自愈阶梯第 6 步与死持有者清理分支均改为
   `clearOwner(dir, observedLeaseId)`(诊断时读到的 leaseId);CAS 不匹配 =
   owner 已被新持有者接管 → 不删、直接重试,仍冲突则重新诊断(最多一轮)。
   clearOwner 成为唯一 owner 删除入口。测试新增"自愈后 CAS"时序用例。
2. **P0-2 identity-critical schema 强制验证**:`readOwner` 返回
   `{state, owner, errors}`,任一关键字段缺失/非法 → `invalid`,不进闸不进
   自愈;闸② 的 `processStartedAt` 从"存在时比较"改为"必须存在且吻合"。
   refusal matrix 新增 8/9/10(缺 processStartedAt / 缺 leaseId /
   schemaVersion 未知)。
3. **P1 命令 token 独立复验 + mode 可信来源**:新增
   `isExpectedMcpProcess(snapshot, owner)`(isNode + 归一化 entrypoint +
   命令 token === 'mcp' + startedAt 吻合);`owner.mode` 来源定为
   `EVO_LITE_PROCESS_MODE=mcp`(MCP bootstrap 设置,缺省 cli),不由
   ephemeral 变量推导;sidecar 自报 mode 不构成杀进程依据。refusal matrix
   新增 11(真实 `memory.js stats` 驻留 + 伪造 mode:'mcp' → unknown 不杀)。

非阻断建议同步落实:原子写契约收窄为"目标路径只经 atomic rename 发布" +
tmp 文件带 pid/leaseId 后缀;stdin shutdown 固定为"标志 → 停新请求 →
await close → 关索引 → exitCode → 有界兜底 exit"(细化归实施计划)。
