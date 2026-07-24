# zvec 0.6 升级 — W0-core 兼容性技术闸判决

- 议题:`[zvec-06-upgrade]`(a177 遗留后续)
- 阶段:**W0-core**(零生产变更调查闸;仅验 native 可用性 + 锁错误契约)
- 日期:2026-07-24
- 隔离工作区:`$CLAUDE_JOB_DIR/tmp/w0core`(v05 控制组 / v06 实验组各自独立 `npm install`)
- 生产影响:**无** —— 未改默认依赖、未改运行时代码、未做 hive nurture

## 判决

```
CORE-PASS
→ 授权进入 W0-ext(readOnly 矩阵 / 旧 collection 兼容 / 与四道闸组合 / 回滚)
```

`isLockError` 现行契约在 0.6.0 下**完好**:无需在升级前修改锁识别逻辑即可安全进入 ext 评估阶段。锁冲突不会被静默降级为裸 rethrow —— a177 遗留的头号风险在 0.6.0 上**未兑现**。

## 环境

| 项 | 值 |
|---|---|
| OS | Windows 11(release 10.0.26200) |
| 架构 | x64 |
| Node | v22.22.2 |
| npm | 10.9.7 |
| 控制组 | `@zvec/zvec@0.5.0`(当前生产基线) |
| 实验组 | `@zvec/zvec@0.6.0`(npm `latest`,唯一 0.6.x) |

### ① Windows x64 可用性 — PASS(两版)

- 两版均 `npm install` 成功(各 4 包),native 模块 `require()` 加载成功。
- 均可 `ZVecCreateAndOpen` 建集合 → `closeSync` → `ZVecOpen` 重开。
- API 表面:核心 `ZVecOpen` / `ZVecCreateAndOpen` / `isZVecError` / `ZVecCollectionSchema` / `ZVecDataType` 在两版**签名一致**。
- 0.6.0 新增导出:`ZVecGetIOBackendType`、`ZVecIOBackendType`、`ZVecGetIOBackendDescription`
  (IO backend 抽象,疑为 readOnly / 后端选择能力 —— 归 **W0-ext** 评估,W0-core 不触碰)。

## ② 锁错误契约 — PASS(两版)

方法:每轮 建集合 → 起 **独立 OS 进程 A**(`holder.js`,`ZVecOpen` 取写锁并持有,ready 文件落地=锁到手)
→ 起 **独立 OS 进程 B**(`probe.js`,`ZVecOpen` 尝试同一集合,捕获完整异常)。
**真实跨进程 writer-writer 冲突,非同进程双实例。** 每版 3 轮。probe 内复刻现行未修改 `isLockError`
(`templates/cli/memory-index-lock.js:326-335`),`isZVecError` 取被测版本的实现。

### 原始错误对象摘要(两版 6 次运行全部一致)

| 字段 | 值 |
|---|---|
| `constructor.name` | `Error` |
| `err.name` | `InternalError` |
| `err.code` | `ZVEC_INTERNAL_ERROR` |
| `err.message` | `Can't lock read-write collection: <path>\collection\LOCK` |
| 自有属性 | `{ message, name, code }`(除 stack 外无其他) |
| `isZVecError(err)` | `true` |
| `/can't lock/i` 命中 | `true` |
| **现行 `isLockError(err)`** | **`true`** |

### 控制组 0.5.0(3/3)

三轮全部:`InternalError` / `ZVEC_INTERNAL_ERROR` / `Can't lock read-write collection: ...\LOCK`;
`isZVecError=true`、`isLockError_current=true`、`messageMatchesCanUnlock=true`。夹具已验真(能稳定复现真实冲突)。

### 实验组 0.6.0(3/3)

三轮全部与 0.5.0 **逐字节一致**:`InternalError` / `ZVEC_INTERNAL_ERROR` /
`Can't lock read-write collection: ...\LOCK`;`isZVecError=true`、`isLockError_current=true`、`messageMatchesCanUnlock=true`。

## 重复次数与一致性

- 每版 3 轮,共 6 次独立跨进程冲突;**6/6 结果字段完全一致**,无偶发/抖动。
- 0.5 → 0.6 的 `name` / `code` / `message` 形态、`isZVecError`、`/can't lock/i` 匹配**全部不变**。

## 门条件核对

| 条件 | 结果 |
|---|---|
| Windows x64 安装 + native load 稳定 | ✅ 两版 |
| 真实跨进程 writer-writer 冲突稳定复现 | ✅ 6/6 |
| `isZVecError(err) === true` | ✅ 6/6 |
| 现行 `isLockError(err) === true` | ✅ 6/6 |
| 异常契约重复运行保持一致 | ✅ 6/6 逐字节一致 |

全部成立 → **CORE-PASS,授权 W0-ext**。

## 结论中记录的结构化判据(供 ext / 正式设计参考,W0-core 不据此改码)

- 0.6.0 提供比 message 正则更稳的结构化判据:`err.code === 'ZVEC_INTERNAL_ERROR'` +
  `err.name === 'InternalError'`。但注意 `ZVEC_INTERNAL_ERROR` 是通用内部错误码,**不是锁专用**;
  若未来想从脆弱的 `/can't lock/i` 文案匹配迁移到 code 判据,需先确认锁冲突是否有更专用的码,
  否则会把无关内部错误误判为锁冲突。此项属 ext / 正式设计范畴,W0-core 不改 `isLockError`。
- readOnly 收益与 IO backend 新导出的实际行为未在 W0-core 评估 —— 交 W0-ext。

## 产物与边界

- harness:`$CLAUDE_JOB_DIR/tmp/w0core/{holder,probe,run}.js`(独立进程编排,留在隔离区)。
- 未改 `templates/cli/**`、未改根 `package.json`/`node_modules`、未跑 nurture。
- 本文件为调查记录,不含任何依赖升级或运行时代码变化。
