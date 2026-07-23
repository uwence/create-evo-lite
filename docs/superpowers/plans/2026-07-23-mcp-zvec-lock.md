---
id: plan:mcp-zvec-lock-mvp
title: "Plan: MCP zvec lock coordination (a177)"
status: draft
---

# [a177] MCP zvec 锁协调 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **AUTHORIZATION GATE:** 本计划在外部复阅通过并由主用户明示授权前,**不得开始实施**。
> 复阅通过后先做治理切换(plan draft→active、focus 迁移、plan scan 确认 7 任务、提交),再进入 Task 1。

**Goal:** 三层最小组合(ephemeral 锁租期 / MCP stdin-EOF 生命周期 / owner sidecar + 四道闸孤儿自愈),让 zvec 写锁不再被死进程长期持有,治理写链路(`mem commit`/`context track`)恢复可用。

**Architecture:** 新增引擎无关的 `templates/cli/memory-index-lock.js`(sidecar 读写 + 进程快照 + 诊断 + 协调打开);`memory-index-zvec.js` 在 `EVO_LITE_INDEX_EPHEMERAL=1` 下把每次公开操作包为 open→op→finalize;`mcp-server.js` 监听 stdin end/close 收尾退出并声明进程身份。契约正文:`docs/superpowers/specs/2026-07-23-mcp-zvec-lock-design.md`(R2 APPROVED)。

**Tech Stack:** Node.js(无新依赖);@zvec/zvec 0.5.0(optional dep,测试沿用 `require.resolve` guard);win32 快照走 PowerShell Get-CimInstance,unix 走 ps。

## Global Constraints

设计终批附带的七条实施不变量(逐字,不得弱化):

1. 所有 owner 删除都必须携带 observed/current leaseId(`clearOwner` 是唯一删除入口)。
2. `readOwner.state !== 'valid'` 永远只能 report-only(不进四道闸、不进自愈)。
3. 自动终止必须同时通过 live process identity、`mcp` token、startedAt、父进程死亡、项目归属检查。
4. CAS 不匹配后的重新诊断最多一轮,避免协调逻辑无限循环。
5. `T-lock-orphan-refusal-matrix` 必须先于自愈实现落地(本计划:Task 3 在 Task 4 之前,不得调序)。
6. `T-mcp-stdin-exit` 必须验证新 writer 能立即打开,而不只是进程退出。
7. zvec 0.6 留在独立 `[zvec-06-upgrade]`,不得混入本计划(当前依赖 0.5.0,`ZVecOpen` 无 readOnly 选项)。

仓库级约束:

- 永不手编 `.evo-lite/cli/**`(sync-runtime 镜像);全部改动落在 `templates/cli/**`,Task 7 统一 sync(manifest 变更时需 2-3 次收敛到 `copied: 0`),sync 后镜像必须 `git add`。
- 测试命令:`node templates/cli/test.js governance`(全量:`node templates/cli/test.js all`);测试块形态沿用 governance.js 现有 `console.log('T-X. ...') { ... } console.log('✅ ...')` 顺序块 + zvec `require.resolve` guard。
- 面向用户的错误与诊断文案用中文;代码标识符与日志关键字保持英文。
- 非锁错误绝不吞、绝不包装(设计 §6)。
- Windows 为第一平台;unix 路径同样实现但以 win32 行为为验收基准。

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `templates/cli/memory-index-lock.js` | Create(Task 1-4 递进) | owner sidecar 读写 / 进程快照与身份判定 / 锁冲突诊断 / 协调打开与自愈。引擎无关,唯一 zvec 触点是 `isLockError` 懒加载 `isZVecError` |
| `templates/cli/memory-index-zvec.js` | Modify(Task 5) | ephemeral 租期(`_withCollection` 重入计数)+ owner 集成 |
| `templates/cli/mcp-server.js` | Modify(Task 6) | stdin EOF/close → shutdown;声明 `EVO_LITE_INDEX_EPHEMERAL` + `EVO_LITE_PROCESS_MODE` |
| `templates/cli/memory-index.js` | Modify(Task 6) | 新增 `peekMemoryIndex()`(不创建实例的只读访问器) |
| `templates/cli/test/governance.js` | Modify(每任务) | T-lock-* 测试块,统一插在 `✅ T-ZV ZvecMemoryIndex passed` 之后按任务顺序排列 |
| `templates/cli/test/harness.js` | Modify(Task 1) | `resetCliModuleCache` 列表加 `memory-index-lock.js` |
| `templates/cli/template-manifest.js` | Modify(Task 7) | core-cli files 加 `memory-index-lock.js`(+1 条) |

---

### Task 1: owner sidecar(writeOwner / clearOwner / readOwner)

**Files:**
- Create: `templates/cli/memory-index-lock.js`
- Modify: `templates/cli/test/harness.js:330`(resetCliModuleCache 列表)
- Test: `templates/cli/test/governance.js`(插在 `✅ T-ZV ZvecMemoryIndex passed` 行之后)

**Interfaces:**
- Consumes: 无(纯 fs + crypto)。
- Produces(后续任务与 Task 5 依赖,签名逐字):
  - `writeOwner(dir, { mode?, projectRoot? }) → leaseId: string` — 原子写 `<dir>/owner.json`。
  - `clearOwner(dir, leaseId) → boolean` — CAS 删除,唯一删除入口。
  - `readOwner(dir) → { state: 'valid'|'missing'|'corrupt'|'invalid', owner: object|null, errors: string[] }`。
  - `selfStartedAt() → string(ISO)` — 进程内缓存,`process.uptime()` 推导,零外部查询。
  - `processMode() → 'mcp'|'cli'` — 读 `EVO_LITE_PROCESS_MODE`。
  - 常量 `OWNER_FILE = 'owner.json'`、`SCHEMA_VERSION = 1`。

- [ ] **Step 1: 写失败测试**

在 `templates/cli/test/governance.js` 顶部 import 区确认存在 `const childProcess = require('child_process');`,没有则在 `const assert = require('assert');` 之后加上。然后在 `console.log('✅ T-ZV ZvecMemoryIndex passed');` 行之后插入:

```js
        console.log('T-lock-owner. Testing owner sidecar write/clear/CAS/schema states ...');
        {
            const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-lock-owner-'));
            const lock = require(path.join(CLI_DIR, 'memory-index-lock.js'));

            // 写入 → schema v1 全字段有效
            const leaseA = lock.writeOwner(lockDir, { mode: 'cli', projectRoot: WORKSPACE_ROOT });
            assert.strictEqual(typeof leaseA, 'string');
            assert.ok(leaseA.length > 0);
            const recA = lock.readOwner(lockDir);
            assert.strictEqual(recA.state, 'valid', `expected valid, errors: ${recA.errors.join('; ')}`);
            assert.strictEqual(recA.owner.schemaVersion, 1);
            assert.strictEqual(recA.owner.leaseId, leaseA);
            assert.strictEqual(recA.owner.pid, process.pid);
            assert.strictEqual(recA.owner.mode, 'cli');
            assert.strictEqual(recA.owner.access, 'write');
            assert.ok(!Number.isNaN(Date.parse(recA.owner.processStartedAt)), 'processStartedAt is a valid time');
            assert.ok(recA.owner.entrypoint.length > 0, 'entrypoint recorded');
            assert.strictEqual(recA.owner.projectRoot, WORKSPACE_ROOT);

            // 发布只经 atomic rename:目录内不残留 .tmp
            assert.ok(!fs.readdirSync(lockDir).some(f => f.endsWith('.tmp')), 'no stray tmp files after publish');

            // lease CAS:B 接管后,A 晚到的 clear 不删 B 的 owner
            const leaseB = lock.writeOwner(lockDir, { mode: 'cli', projectRoot: WORKSPACE_ROOT });
            assert.strictEqual(lock.clearOwner(lockDir, leaseA), false, 'stale lease must not clear');
            assert.strictEqual(lock.readOwner(lockDir).owner.leaseId, leaseB, 'new holder owner survives');
            assert.strictEqual(lock.clearOwner(lockDir, leaseB), true, 'current lease clears');
            assert.strictEqual(lock.readOwner(lockDir).state, 'missing');

            // clearOwner 无 leaseId / owner 缺失 → 静默 false
            assert.strictEqual(lock.clearOwner(lockDir, null), false);
            assert.strictEqual(lock.clearOwner(lockDir, 'anything'), false);

            // readOwner 状态模型:corrupt(半截 JSON)
            fs.writeFileSync(path.join(lockDir, 'owner.json'), '{ "schemaVersion": 1, "leaseId": "trunc', 'utf8');
            assert.strictEqual(lock.readOwner(lockDir).state, 'corrupt');

            // invalid:identity-critical 字段缺失 / schemaVersion 未知
            const fullOwner = () => ({
                schemaVersion: 1, leaseId: 'lease-x', pid: 1234, ppid: 1,
                processStartedAt: '2026-07-23T00:00:00.000Z',
                entrypoint: 'C:/x/memory.js', mode: 'mcp', access: 'write',
                projectRoot: 'C:/x', createdAt: '2026-07-23T00:00:00.000Z',
            });
            for (const field of ['processStartedAt', 'leaseId', 'pid', 'entrypoint', 'projectRoot']) {
                const o = fullOwner();
                delete o[field];
                fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify(o), 'utf8');
                const r = lock.readOwner(lockDir);
                assert.strictEqual(r.state, 'invalid', `missing ${field} must be invalid`);
                assert.ok(r.errors.length > 0, `errors listed for missing ${field}`);
            }
            const badVersion = fullOwner();
            badVersion.schemaVersion = 99;
            fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify(badVersion), 'utf8');
            assert.strictEqual(lock.readOwner(lockDir).state, 'invalid', 'unknown schemaVersion must be invalid');
            const badMode = fullOwner();
            badMode.mode = 'daemon';
            fs.writeFileSync(path.join(lockDir, 'owner.json'), JSON.stringify(badMode), 'utf8');
            assert.strictEqual(lock.readOwner(lockDir).state, 'invalid', 'unknown mode must be invalid');
        }
        console.log('✅ T-lock-owner owner sidecar passed');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node templates/cli/test.js governance`
Expected: FAIL,`Cannot find module '...memory-index-lock.js'`。

- [ ] **Step 3: 实现 `templates/cli/memory-index-lock.js`(初版:sidecar 部分)**

```js
'use strict';

// memory-index-lock.js — zvec 锁生命周期与单写者协调([a177])。
// 引擎无关:owner sidecar 读写 / 进程快照 / 锁冲突诊断 / 协调打开与安全自愈。
// 契约:docs/superpowers/specs/2026-07-23-mcp-zvec-lock-design.md(R2 APPROVED)。
// 安全原则:sidecar 是观察记录不是锁;杀进程决策只信 live snapshot;
// 任何不确定 → report-only。

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const OWNER_FILE = 'owner.json';
const SCHEMA_VERSION = 1;

let _selfStartedAt = null;
// 自报进程启动时刻:uptime 推导 + 进程内缓存 —— ephemeral 模式每次 open 都要
// 写 owner,不能付 CIM/ps 查询代价。诊断侧比对留 ±2s 容差吸收推导误差。
function selfStartedAt() {
    if (!_selfStartedAt) {
        _selfStartedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
    }
    return _selfStartedAt;
}

function ownerPath(dir) {
    return path.join(dir, OWNER_FILE);
}

// 进程身份来源:MCP bootstrap 设 EVO_LITE_PROCESS_MODE=mcp,其余进程缺省 cli。
// 不得由 EVO_LITE_INDEX_EPHEMERAL 推导 —— ephemeral 是锁租期策略,不是身份。
function processMode() {
    return process.env.EVO_LITE_PROCESS_MODE === 'mcp' ? 'mcp' : 'cli';
}

function writeOwner(dir, info = {}) {
    const leaseId = crypto.randomUUID();
    const owner = {
        schemaVersion: SCHEMA_VERSION,
        leaseId,
        pid: process.pid,
        ppid: process.ppid,
        processStartedAt: selfStartedAt(),
        entrypoint: process.argv[1] || '',
        mode: info.mode || processMode(),
        access: 'write',
        projectRoot: info.projectRoot || process.cwd(),
        createdAt: new Date().toISOString(),
    };
    fs.mkdirSync(dir, { recursive: true });
    // owner.json 本体只经 atomic rename 发布,绝不直接 truncate/write;
    // tmp 带 pid+leaseId 后缀,异常遗留的旧 tmp 不影响下一次写入。
    const tmp = path.join(dir, `${OWNER_FILE}.${process.pid}.${leaseId}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(owner, null, 2), 'utf8');
    fs.renameSync(tmp, ownerPath(dir));
    return leaseId;
}

// CAS:唯一的 owner 删除入口。晚到的 finalize、自愈清理、死持有者清理都必须
// 携带自己观察到的 leaseId;不匹配 = 新持有者已接管 → 静默不动。
function clearOwner(dir, leaseId) {
    if (!leaseId) return false;
    const p = ownerPath(dir);
    let disk = null;
    try {
        disk = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (_) {
        return false;
    }
    if (!disk || disk.leaseId !== leaseId) return false;
    try {
        fs.unlinkSync(p);
        return true;
    } catch (_) {
        return false;
    }
}

// identity-critical schema 强制验证(R1 P0-2):任一字段缺失/非法 → invalid,
// 调用方不得据以进入四道闸或自愈。
function readOwner(dir) {
    const p = ownerPath(dir);
    if (!fs.existsSync(p)) {
        return { state: 'missing', owner: null, errors: ['owner.json missing'] };
    }
    let raw = null;
    try {
        raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (err) {
        return { state: 'corrupt', owner: null, errors: [`owner.json unparseable: ${err.message}`] };
    }
    const errors = [];
    if (raw.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion ${raw.schemaVersion} !== ${SCHEMA_VERSION}`);
    if (typeof raw.leaseId !== 'string' || raw.leaseId.length === 0) errors.push('leaseId missing');
    if (!Number.isInteger(raw.pid) || raw.pid <= 0) errors.push('pid invalid');
    if (!Number.isInteger(raw.ppid) || raw.ppid < 0) errors.push('ppid invalid');
    if (typeof raw.processStartedAt !== 'string' || Number.isNaN(Date.parse(raw.processStartedAt))) errors.push('processStartedAt invalid');
    if (typeof raw.entrypoint !== 'string' || raw.entrypoint.length === 0) errors.push('entrypoint missing');
    if (raw.mode !== 'mcp' && raw.mode !== 'cli') errors.push(`mode invalid: ${raw.mode}`);
    if (raw.access !== 'write') errors.push(`access invalid: ${raw.access}`);
    if (typeof raw.projectRoot !== 'string' || raw.projectRoot.length === 0) errors.push('projectRoot missing');
    if (typeof raw.createdAt !== 'string' || Number.isNaN(Date.parse(raw.createdAt))) errors.push('createdAt invalid');
    if (errors.length > 0) {
        return { state: 'invalid', owner: raw, errors };
    }
    return { state: 'valid', owner: raw, errors: [] };
}

module.exports = {
    OWNER_FILE,
    SCHEMA_VERSION,
    ownerPath,
    selfStartedAt,
    processMode,
    writeOwner,
    clearOwner,
    readOwner,
};
```

- [ ] **Step 4: harness 缓存列表加新模块**

`templates/cli/test/harness.js` 中 `resetCliModuleCache` 的文件数组(现为 `['runtime.js', 'db.js', 'models.js', 'memory-index-util.js', 'memory-index.js', 'memory-index-zvec.js', 'memory.service.js', 'mcp-detect.js', 'memory.js']`)在 `'memory-index-zvec.js'` 后插入 `'memory-index-lock.js'`。

- [ ] **Step 5: 跑测试确认通过**

Run: `node templates/cli/test.js governance`
Expected: PASS,输出含 `✅ T-lock-owner owner sidecar passed`。

- [ ] **Step 6: Commit**

```bash
git add templates/cli/memory-index-lock.js templates/cli/test/governance.js templates/cli/test/harness.js
git commit -m "feat(lock): owner sidecar with atomic publish, lease CAS, schema-state readOwner (a177 L1)"
```

---

### Task 2: 进程快照与身份判定(getProcessSnapshot / isExpectedMcpProcess)

**Files:**
- Modify: `templates/cli/memory-index-lock.js`(追加函数)
- Test: `templates/cli/test/governance.js`(插在 `✅ T-lock-owner owner sidecar passed` 行之后)

**Interfaces:**
- Consumes: Task 1 的 `selfStartedAt()`。
- Produces(Task 3/4 依赖,签名逐字):
  - `pidAlive(pid) → boolean`(`process.kill(pid, 0)`,EPERM 视为存活)。
  - `getProcessSnapshot(pid, seams?) → { alive, isNode, commandLine, ppid, ppidAlive, startedAt } | null` — 一次系统查询;失败/权限不足 → `null`;`seams.snapshotFn` 为测试注入点(抛错时返回 null)。
  - `isExpectedMcpProcess(snapshot, owner) → boolean` — isNode + 归一化 entrypoint 含 `memory.js` + 命令 token === `'mcp'` + `processStartedAt` **必须存在**且与 snapshot.startedAt 在 ±2s(`STARTED_AT_TOLERANCE_MS = 2000`)内吻合。
  - `normalizePath(p) → string`、`commandTokens(commandLine) → string[]`。

- [ ] **Step 1: 写失败测试**

插在 `console.log('✅ T-lock-owner owner sidecar passed');` 之后:

```js
        console.log('T-lock-ident. Testing process snapshot + isExpectedMcpProcess ...');
        {
            const lock = require(path.join(CLI_DIR, 'memory-index-lock.js'));

            // 自身快照:alive + isNode + commandLine + startedAt(win32 CIM / unix ps)
            const self = lock.getProcessSnapshot(process.pid);
            assert.ok(self && self.alive === true, 'self snapshot alive');
            assert.strictEqual(self.isNode, true, 'self is a node process');
            assert.ok(typeof self.commandLine === 'string' && self.commandLine.length > 0, 'commandLine captured');
            assert.ok(self.startedAt && !Number.isNaN(Date.parse(self.startedAt)), 'startedAt is a valid time');
            assert.ok(Number.isInteger(self.ppid), 'ppid captured');

            // 自报 startedAt(uptime 推导)与系统实测在容差内一致
            const drift = Math.abs(Date.parse(lock.selfStartedAt()) - Date.parse(self.startedAt));
            assert.ok(drift <= 5000, `selfStartedAt drift ${drift}ms exceeds 5s`);

            // 已死 pid → alive:false
            const deadChild = childProcess.spawnSync(process.execPath, ['-e', 'process.exit(0)']);
            const deadSnap = lock.getProcessSnapshot(deadChild.pid);
            assert.ok(deadSnap && deadSnap.alive === false, 'dead pid reports alive:false');

            // seam:注入失败 → null(调用方按不可确认处理)
            assert.strictEqual(lock.getProcessSnapshot(1, { snapshotFn: () => { throw new Error('denied'); } }), null);

            // isExpectedMcpProcess:命令 token 必须是 mcp,entrypoint 必须归一匹配,
            // startedAt 必须存在且吻合
            const owner = { entrypoint: 'C:/tmp/x/memory.js', processStartedAt: '2026-07-23T08:00:00.000Z' };
            const snapOf = cmd => ({ alive: true, isNode: true, commandLine: cmd, ppid: 1, ppidAlive: false, startedAt: '2026-07-23T08:00:01.000Z' });
            assert.strictEqual(lock.isExpectedMcpProcess(snapOf('node C:/tmp/x/memory.js mcp'), owner), true, 'real mcp accepted');
            assert.strictEqual(lock.isExpectedMcpProcess(snapOf('node C:\\tmp\\x\\memory.js mcp'), owner), true, 'backslash path normalized');
            assert.strictEqual(lock.isExpectedMcpProcess(snapOf('node C:/tmp/x/memory.js stats'), owner), false, 'stats must NOT pass');
            assert.strictEqual(lock.isExpectedMcpProcess(snapOf('node C:/tmp/x/memory.js rebuild'), owner), false, 'rebuild must NOT pass');
            assert.strictEqual(lock.isExpectedMcpProcess(snapOf('node C:/other/elsewhere.js mcp'), owner), false, 'wrong entrypoint rejected');
            assert.strictEqual(lock.isExpectedMcpProcess({ ...snapOf('node C:/tmp/x/memory.js mcp'), startedAt: '2026-07-23T09:00:00.000Z' }, owner), false, 'startedAt mismatch = PID reuse, rejected');
            assert.strictEqual(lock.isExpectedMcpProcess(snapOf('node C:/tmp/x/memory.js mcp'), { entrypoint: 'C:/tmp/x/memory.js' }), false, 'missing processStartedAt = gate fails, not skipped');
            assert.strictEqual(lock.isExpectedMcpProcess({ ...snapOf('node C:/tmp/x/memory.js mcp'), isNode: false }, owner), false, 'non-node rejected');
            assert.strictEqual(lock.isExpectedMcpProcess(null, owner), false);
            assert.strictEqual(lock.isExpectedMcpProcess(snapOf('node C:/tmp/x/memory.js mcp'), null), false);
        }
        console.log('✅ T-lock-ident passed');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node templates/cli/test.js governance`
Expected: FAIL,`lock.getProcessSnapshot is not a function`。

- [ ] **Step 3: 实现(在 `memory-index-lock.js` 的 `readOwner` 之后、`module.exports` 之前追加)**

```js
const { execFileSync } = require('child_process');

const STARTED_AT_TOLERANCE_MS = 2000;

function pidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return Boolean(err && err.code === 'EPERM'); // EPERM = 存在但无权限
    }
}

// 一次系统查询取回四道闸 + 时间戳所需的全部字段;失败/权限不足 → null,
// 调用方一律按"不可确认"处理(绝不因此进入自愈)。
function getProcessSnapshot(pid, seams = {}) {
    if (seams && typeof seams.snapshotFn === 'function') {
        try {
            return seams.snapshotFn(pid);
        } catch (_) {
            return null;
        }
    }
    const alive = pidAlive(pid);
    if (!alive) {
        return { alive: false, isNode: null, commandLine: null, ppid: null, ppidAlive: null, startedAt: null };
    }
    try {
        if (process.platform === 'win32') {
            const script = `Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}" | Select-Object Name,ProcessId,ParentProcessId,CommandLine,@{n='StartedAt';e={$_.CreationDate.ToUniversalTime().ToString('o')}} | ConvertTo-Json`;
            const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 10000 });
            const row = JSON.parse(out);
            if (!row || !row.ProcessId) return null;
            const ppid = Number(row.ParentProcessId);
            return {
                alive: true,
                isNode: /node(\.exe)?$/i.test(String(row.Name || '')),
                commandLine: String(row.CommandLine || ''),
                ppid: Number.isInteger(ppid) ? ppid : null,
                ppidAlive: Number.isInteger(ppid) ? pidAlive(ppid) : null,
                startedAt: row.StartedAt || null,
            };
        }
        const out = execFileSync('ps', ['-o', 'ppid=,lstart=,args=', '-p', String(Number(pid))], { encoding: 'utf8', timeout: 10000 });
        const line = out.trim();
        if (!line) return null;
        const tokens = line.split(/\s+/);
        const ppid = Number(tokens[0]);
        const startedDate = new Date(tokens.slice(1, 6).join(' ')); // lstart 固定 5 段
        const commandLine = tokens.slice(6).join(' ');
        const first = (commandLine.split(/\s+/)[0] || '');
        return {
            alive: true,
            isNode: /node/i.test(path.basename(first)),
            commandLine,
            ppid: Number.isInteger(ppid) ? ppid : null,
            ppidAlive: Number.isInteger(ppid) ? pidAlive(ppid) : null,
            startedAt: Number.isNaN(startedDate.getTime()) ? null : startedDate.toISOString(),
        };
    } catch (_) {
        return null;
    }
}

function normalizePath(p) {
    return String(p || '').replace(/\\/g, '/').toLowerCase();
}

function commandTokens(commandLine) {
    return String(commandLine || '').replace(/"/g, '').split(/\s+/).filter(Boolean);
}

// R1 P1:live snapshot 独立确认身份 —— sidecar 自报的 mode 不构成杀进程依据。
// 仅含 memory.js 不够(stats/rebuild 同样命中):entrypoint 后的 token 必须是 mcp。
// R1 P0-2:processStartedAt 必须存在并吻合;缺失 = 闸不过,不是跳过。
function isExpectedMcpProcess(snapshot, owner) {
    if (!snapshot || !owner) return false;
    if (snapshot.isNode !== true) return false;
    if (!snapshot.commandLine || !snapshot.startedAt) return false;
    const entry = normalizePath(owner.entrypoint);
    if (!entry || !entry.endsWith('memory.js')) return false;
    const tokens = commandTokens(snapshot.commandLine).map(normalizePath);
    const entryIdx = tokens.findIndex(tok =>
        tok.endsWith('memory.js') && (tok === entry || tok.endsWith(entry) || entry.endsWith(tok)));
    if (entryIdx === -1) return false;
    if (tokens[entryIdx + 1] !== 'mcp') return false;
    const ownerT = Date.parse(owner.processStartedAt || '');
    const snapT = Date.parse(snapshot.startedAt || '');
    if (Number.isNaN(ownerT) || Number.isNaN(snapT)) return false;
    return Math.abs(ownerT - snapT) <= STARTED_AT_TOLERANCE_MS;
}
```

`module.exports` 更新为:

```js
module.exports = {
    OWNER_FILE,
    SCHEMA_VERSION,
    STARTED_AT_TOLERANCE_MS,
    ownerPath,
    selfStartedAt,
    processMode,
    writeOwner,
    clearOwner,
    readOwner,
    pidAlive,
    getProcessSnapshot,
    normalizePath,
    commandTokens,
    isExpectedMcpProcess,
};
```

(`const { execFileSync } = require('child_process');` 移到文件顶部 require 区。)

- [ ] **Step 4: 跑测试确认通过**

Run: `node templates/cli/test.js governance`
Expected: PASS,输出含 `✅ T-lock-ident passed`。

- [ ] **Step 5: Commit**

```bash
git add templates/cli/memory-index-lock.js templates/cli/test/governance.js
git commit -m "feat(lock): process snapshot (CIM/ps) + isExpectedMcpProcess with mcp-token gate (a177 L2)"
```

---

### Task 3: 锁冲突诊断 + 拒杀矩阵(diagnoseLockConflict,先于自愈落地)

> Global Constraints 不变量 5:本任务必须在 Task 4(自愈)之前完成,不得调序。

**Files:**
- Modify: `templates/cli/memory-index-lock.js`(追加函数)
- Test: `templates/cli/test/governance.js`(插在 `✅ T-lock-ident passed` 行之后)

**Interfaces:**
- Consumes: Task 1 `readOwner`;Task 2 `getProcessSnapshot`/`isExpectedMcpProcess`/`pidAlive`/`normalizePath`。
- Produces(Task 4 依赖,签名逐字):
  - `diagnoseLockConflict(dir, ctx?) → { verdict, owner, snapshot, observedLeaseId?, report }`
    - `ctx = { projectRoot?: string, seams?: { snapshotFn?, killFn? } }`(projectRoot 缺省 `process.cwd()`)。
    - `verdict ∈ 'orphaned-own-mcp' | 'live-foreign' | 'unknown' | 'dead-holder'`(dead-holder 是设计 §4.3 闸① ESRCH 分支的显式编码;只有 `orphaned-own-mcp` 允许自愈)。
    - `report = { lockPath, reason, enumerate }`;`observedLeaseId` 仅在 dead-holder / orphaned-own-mcp 时给出(供 CAS 清理)。
  - `enumerationCommand() → string`(可复制的持有者枚举命令)。

- [ ] **Step 1: 写失败测试(11 例拒杀矩阵,含设计 R1 增补)**

插在 `console.log('✅ T-lock-ident passed');` 之后:

```js
        console.log('T-lock-orphan-refusal-matrix. Testing four-gate refusal — 11 cases, never killable ...');
        {
            const lock = require(path.join(CLI_DIR, 'memory-index-lock.js'));
            const HERE = WORKSPACE_ROOT;
            const mkLockDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'evo-lock-refuse-'));
            const writeRaw = (dir, obj) => fs.writeFileSync(
                path.join(dir, 'owner.json'),
                typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2), 'utf8');
            const baseOwner = (over = {}) => ({
                schemaVersion: 1, leaseId: 'lease-refuse', pid: 999999, ppid: 1,
                processStartedAt: '2026-07-23T00:00:00.000Z',
                entrypoint: path.join(os.tmpdir(), 'fake-entry', 'memory.js'),
                mode: 'mcp', access: 'write', projectRoot: HERE,
                createdAt: '2026-07-23T00:00:00.000Z', ...over,
            });
            // 拒杀三件套:verdict 绝非 orphaned / 诊断信息在场 / owner 未被删改 / 目标进程存活
            const ownerBytes = dir => fs.readFileSync(path.join(dir, 'owner.json'), 'utf8');
            const assertRefusal = (dir, before, diag, holderPid) => {
                assert.notStrictEqual(diag.verdict, 'orphaned-own-mcp', 'must never be killable');
                assert.notStrictEqual(diag.verdict, 'dead-holder', 'must not treat as cleanable stale owner');
                assert.ok(diag.report && diag.report.reason, 'report carries a reason');
                assert.ok(diag.report.lockPath.includes('LOCK'), 'report names the LOCK path');
                assert.ok(diag.report.enumerate.includes('memory'), 'report carries enumeration command');
                assert.strictEqual(ownerBytes(dir), before, 'owner.json untouched');
                if (holderPid) assert.ok(lock.pidAlive(holderPid), 'target process must survive');
            };
            // 长驻 holder:脚本文件名与 argv 可控(伪装 memory.js mcp / stats 等形态)
            const spawnHolder = (scriptName, args) => {
                const hd = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-lock-holder-'));
                const scriptPath = path.join(hd, scriptName);
                fs.writeFileSync(scriptPath, 'setInterval(() => {}, 1000);\n', 'utf8');
                const child = childProcess.spawn(process.execPath, [scriptPath, ...args], { stdio: 'ignore' });
                return { child, scriptPath };
            };
            const holders = [];
            try {
                // 1. pid 存活但非 memory.js 进程(闸②:entrypoint 不匹配)
                {
                    const dir = mkLockDir();
                    const { child, scriptPath } = spawnHolder('plain.js', []);
                    holders.push(child);
                    writeRaw(dir, baseOwner({ pid: child.pid, entrypoint: scriptPath }));
                    const before = ownerBytes(dir);
                    const diag = lock.diagnoseLockConflict(dir, { projectRoot: HERE });
                    assert.strictEqual(diag.verdict, 'unknown', 'case 1: non-memory.js holder');
                    assertRefusal(dir, before, diag, child.pid);
                }
                // 2. projectRoot 不一致(闸④)—— holder 是 memory.js mcp 形态,身份闸通过
                {
                    const dir = mkLockDir();
                    const { child, scriptPath } = spawnHolder('memory.js', ['mcp']);
                    holders.push(child);
                    const snap = lock.getProcessSnapshot(child.pid);
                    assert.ok(snap && snap.startedAt, 'live snapshot available for holder');
                    writeRaw(dir, baseOwner({
                        pid: child.pid, entrypoint: scriptPath,
                        processStartedAt: snap.startedAt,
                        projectRoot: path.join(os.tmpdir(), 'some-other-repo'),
                    }));
                    const before = ownerBytes(dir);
                    const diag = lock.diagnoseLockConflict(dir, { projectRoot: HERE });
                    assert.strictEqual(diag.verdict, 'live-foreign', 'case 2: foreign project');
                    assertRefusal(dir, before, diag, child.pid);
                }
                // 3. ppid 仍存活(闸③)—— holder 由测试进程直接 spawn
                {
                    const dir = mkLockDir();
                    const { child, scriptPath } = spawnHolder('memory.js', ['mcp']);
                    holders.push(child);
                    const snap = lock.getProcessSnapshot(child.pid);
                    writeRaw(dir, baseOwner({ pid: child.pid, entrypoint: scriptPath, processStartedAt: snap.startedAt }));
                    const before = ownerBytes(dir);
                    const diag = lock.diagnoseLockConflict(dir, { projectRoot: HERE });
                    assert.strictEqual(diag.verdict, 'live-foreign', 'case 3: parent still alive');
                    assert.ok(String(diag.report.reason).includes('不会自动终止'), 'live-foreign states no auto-kill');
                    assertRefusal(dir, before, diag, child.pid);
                }
                // 4. 快照不可得(seam 返回 null)
                {
                    const dir = mkLockDir();
                    writeRaw(dir, baseOwner());
                    const before = ownerBytes(dir);
                    const diag = lock.diagnoseLockConflict(dir, { projectRoot: HERE, seams: { snapshotFn: () => null } });
                    assert.strictEqual(diag.verdict, 'unknown', 'case 4: snapshot unavailable');
                    assertRefusal(dir, before, diag, null);
                }
                // 5. owner 损坏(半截 JSON)
                {
                    const dir = mkLockDir();
                    writeRaw(dir, '{ "schemaVersion": 1, "leaseId": "trunc');
                    const before = ownerBytes(dir);
                    const diag = lock.diagnoseLockConflict(dir, { projectRoot: HERE });
                    assert.strictEqual(diag.verdict, 'unknown', 'case 5: corrupt owner');
                    assert.ok(String(diag.report.reason).includes('持有者未登记'), 'corrupt reads as unregistered holder');
                    assertRefusal(dir, before, diag, null);
                }
                // 6. PID 复用(闸②:startedAt 与快照不符)
                {
                    const dir = mkLockDir();
                    const { child, scriptPath } = spawnHolder('memory.js', ['mcp']);
                    holders.push(child);
                    writeRaw(dir, baseOwner({ pid: child.pid, entrypoint: scriptPath, processStartedAt: '2020-01-01T00:00:00.000Z' }));
                    const before = ownerBytes(dir);
                    const diag = lock.diagnoseLockConflict(dir, { projectRoot: HERE });
                    assert.strictEqual(diag.verdict, 'unknown', 'case 6: startedAt mismatch = PID reuse');
                    assertRefusal(dir, before, diag, child.pid);
                }
                // 7. 权限不足(seam 抛 access-denied)
                {
                    const dir = mkLockDir();
                    writeRaw(dir, baseOwner());
                    const before = ownerBytes(dir);
                    const diag = lock.diagnoseLockConflict(dir, { projectRoot: HERE, seams: { snapshotFn: () => { throw new Error('access denied'); } } });
                    assert.strictEqual(diag.verdict, 'unknown', 'case 7: access denied');
                    assertRefusal(dir, before, diag, null);
                }
                // 8/9/10. identity-critical 缺失或 schemaVersion 未知(R1 P0-2)
                {
                    const mutations = [
                        ['missing processStartedAt', o => { delete o.processStartedAt; }],
                        ['missing leaseId', o => { delete o.leaseId; }],
                        ['schemaVersion 99', o => { o.schemaVersion = 99; }],
                    ];
                    for (const [label, mutate] of mutations) {
                        const dir = mkLockDir();
                        const o = baseOwner();
                        mutate(o);
                        writeRaw(dir, o);
                        const before = ownerBytes(dir);
                        const diag = lock.diagnoseLockConflict(dir, { projectRoot: HERE });
                        assert.strictEqual(diag.verdict, 'unknown', `case 8-10 (${label}): invalid owner is report-only`);
                        assertRefusal(dir, before, diag, null);
                    }
                }
                // 11. 实际命令非 mcp + owner.mode 伪造 'mcp'(R1 P1)
                {
                    const dir = mkLockDir();
                    const { child, scriptPath } = spawnHolder('memory.js', ['stats']);
                    holders.push(child);
                    const snap = lock.getProcessSnapshot(child.pid);
                    writeRaw(dir, baseOwner({ pid: child.pid, entrypoint: scriptPath, processStartedAt: snap.startedAt, mode: 'mcp' }));
                    const before = ownerBytes(dir);
                    const diag = lock.diagnoseLockConflict(dir, { projectRoot: HERE });
                    assert.strictEqual(diag.verdict, 'unknown', 'case 11: stats holder with forged mode must never be killable');
                    assertRefusal(dir, before, diag, child.pid);
                }
                // 正向对照:闸① ESRCH → dead-holder + observedLeaseId(清理走 CAS,Task 4 使用)
                {
                    const dir = mkLockDir();
                    const dead = childProcess.spawnSync(process.execPath, ['-e', 'process.exit(0)']);
                    writeRaw(dir, baseOwner({ pid: dead.pid }));
                    const diag = lock.diagnoseLockConflict(dir, { projectRoot: HERE });
                    assert.strictEqual(diag.verdict, 'dead-holder');
                    assert.strictEqual(diag.observedLeaseId, 'lease-refuse', 'observed leaseId captured for CAS cleanup');
                }
            } finally {
                for (const h of holders) { try { h.kill(); } catch (_) {} }
            }
        }
        console.log('✅ T-lock-orphan-refusal-matrix passed (11/11 refusals + dead-holder probe)');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node templates/cli/test.js governance`
Expected: FAIL,`lock.diagnoseLockConflict is not a function`。

- [ ] **Step 3: 实现(在 `isExpectedMcpProcess` 之后追加)**

```js
function enumerationCommand() {
    if (process.platform === 'win32') {
        return 'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | Where-Object { $_.CommandLine -match \'memory\\.js mcp\' } | Select-Object ProcessId,ParentProcessId,CreationDate,CommandLine';
    }
    return 'ps -eo pid,ppid,lstart,args | grep "memory\\.js mcp"';
}

// 四道闸判定(设计 §4.2,R2):只有全部通过才判 orphaned-own-mcp(可自愈);
// 任何一道不过或信息不可得 → live-foreign / unknown(report-only)。
// verdict 'dead-holder' 是闸① ESRCH 分支的显式编码(清理仍走 CAS)。
function diagnoseLockConflict(dir, ctx = {}) {
    const lockPath = path.join(dir, 'collection', 'LOCK');
    const base = { lockPath, enumerate: enumerationCommand() };
    const rec = readOwner(dir);
    // 前置:readOwner.state !== 'valid' → unknown,不进闸不进自愈(R1 P0-2)
    if (rec.state !== 'valid') {
        return {
            verdict: 'unknown', owner: rec.owner, snapshot: null,
            report: { ...base, reason: `owner sidecar ${rec.state}(${rec.errors.join('; ')});持有者未登记(可能为旧版 evo-lite MCP),绝不自动终止` },
        };
    }
    const owner = rec.owner;
    const snapshot = getProcessSnapshot(owner.pid, ctx.seams);
    // 闸①:已死 → 死持有者(无进程可杀,仅允许 CAS 清 stale owner)
    if (snapshot && snapshot.alive === false) {
        return {
            verdict: 'dead-holder', owner, snapshot, observedLeaseId: owner.leaseId,
            report: { ...base, reason: `holder pid ${owner.pid} 已退出,残留 stale owner,可安全清理后重试` },
        };
    }
    // 快照不可得(查询失败/权限不足)→ unknown
    if (!snapshot || snapshot.isNode == null || !snapshot.commandLine || !snapshot.startedAt) {
        return {
            verdict: 'unknown', owner, snapshot,
            report: { ...base, reason: `无法确认 pid ${owner.pid} 的进程身份(查询失败或权限不足),绝不自动终止` },
        };
    }
    // 闸②:live 身份复验(isNode + memory.js 归一路径 + mcp token + startedAt 吻合)
    if (!isExpectedMcpProcess(snapshot, owner)) {
        return {
            verdict: 'unknown', owner, snapshot,
            report: { ...base, reason: `pid ${owner.pid} 不是预期的 memory.js mcp 进程(可能 PID 复用或身份伪报),绝不自动终止` },
        };
    }
    // 闸④:项目归属 + 角色声明
    const projectRoot = ctx.projectRoot || process.cwd();
    if (normalizePath(owner.projectRoot) !== normalizePath(projectRoot) || owner.mode !== 'mcp') {
        return {
            verdict: 'live-foreign', owner, snapshot,
            report: { ...base, reason: `pid ${owner.pid} 属于其他项目或非 MCP 角色,不会自动终止该进程` },
        };
    }
    // 闸③:父进程仍活着 = 有人管着它
    if (snapshot.ppidAlive !== false) {
        return {
            verdict: 'live-foreign', owner, snapshot,
            report: { ...base, reason: `pid ${owner.pid} 的父进程 ${snapshot.ppid} 仍存活,不会自动终止该进程` },
        };
    }
    return {
        verdict: 'orphaned-own-mcp', owner, snapshot, observedLeaseId: owner.leaseId,
        report: { ...base, reason: `pid ${owner.pid} 为本仓孤儿 MCP(四道闸全部通过),允许安全自愈` },
    };
}
```

`module.exports` 追加 `enumerationCommand,`、`diagnoseLockConflict,` 两项。

- [ ] **Step 4: 跑测试确认通过**

Run: `node templates/cli/test.js governance`
Expected: PASS,输出含 `✅ T-lock-orphan-refusal-matrix passed (11/11 refusals + dead-holder probe)`。

- [ ] **Step 5: Commit**

```bash
git add templates/cli/memory-index-lock.js templates/cli/test/governance.js
git commit -m "feat(lock): four-gate diagnoseLockConflict + 11-case refusal matrix, before any self-heal (a177 L3)"
```

---

### Task 4: 协调打开与安全自愈(openWithCoordination / attemptSelfHeal / isLockError)

**Files:**
- Modify: `templates/cli/memory-index-lock.js`(追加函数)
- Test: `templates/cli/test/governance.js`(插在 `✅ T-lock-orphan-refusal-matrix …` 行之后)

**Interfaces:**
- Consumes: Task 1-3 全部导出。
- Produces(Task 5 依赖,签名逐字):
  - `isLockError(err) → boolean`(懒加载 `@zvec/zvec` 的 `isZVecError`,不可用时退化为 err.name 含 zvec 的 message 匹配;message 须命中 `/can't lock/i`)。
  - `openWithCoordination(openFn, dir, ctx?) → { result, leaseId }`(成功即 `writeOwner`;失败 throw 富化错误 `{ code: 'EVO_ZVEC_LOCKED', verdict, report, cause }`;非锁错误原样 rethrow)。
  - `attemptSelfHeal(dir, diag, ctx?) → { healed: boolean, reason?: string }`(身份复核 → SIGTERM → 有界等待 → SIGKILL → 等消失 → `clearOwner(dir, diag.observedLeaseId)` CAS)。
  - `sleepSync(ms)`、`waitForExit(pid, timeoutMs) → boolean`。
  - 常量 `BACKOFF_RETRIES = 3`、`BACKOFF_MS = 100`、`TERM_WAIT_MS = 1500`、`KILL_WAIT_MS = 1000`、`POLL_MS = 100`。

- [ ] **Step 1: 写失败测试**

插在 `console.log('✅ T-lock-orphan-refusal-matrix passed (11/11 refusals + dead-holder probe)');` 之后:

```js
        console.log('T-lock-coordination. Testing passthrough / live-foreign / orphan self-heal (zvec cases skip if absent) ...');
        {
            const lock = require(path.join(CLI_DIR, 'memory-index-lock.js'));
            const HERE = WORKSPACE_ROOT;

            // 非锁错误零干预:原样 rethrow,不 backoff、不诊断、不产 owner
            {
                const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-lock-passthru-'));
                const boom = new Error('schema mismatch: not a lock problem');
                let threw = null;
                try {
                    lock.openWithCoordination(() => { throw boom; }, dir, { projectRoot: HERE });
                } catch (err) {
                    threw = err;
                }
                assert.strictEqual(threw, boom, 'non-lock error rethrown untouched (same object)');
                assert.ok(!fs.existsSync(path.join(dir, 'owner.json')), 'no owner written on failure');
            }

            // 自愈后 CAS(R1 P0-1):死者清理不得删除新接管者的 owner
            {
                const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-lock-healcas-'));
                const dead = childProcess.spawnSync(process.execPath, ['-e', 'process.exit(0)']);
                const staleDiag = {
                    owner: { pid: dead.pid },
                    observedLeaseId: 'stale-lease-of-dead-holder',
                    report: { lockPath: path.join(dir, 'collection', 'LOCK'), reason: 't', enumerate: 't' },
                };
                const leaseB = lock.writeOwner(dir, { mode: 'cli', projectRoot: HERE }); // B 已接管
                const heal = lock.attemptSelfHeal(dir, staleDiag, { projectRoot: HERE });
                assert.strictEqual(heal.healed, true, 'dead pid heals without kill');
                assert.strictEqual(lock.readOwner(dir).owner.leaseId, leaseB, 'new holder owner survives self-heal CAS');
            }

            let zvecAvailable = true;
            try { require.resolve('@zvec/zvec'); } catch (_) { zvecAvailable = false; }
            if (!zvecAvailable) {
                console.log('   ⏭️ zvec-dependent coordination cases skipped — @zvec/zvec not installed');
            } else {
                const zvec = require('@zvec/zvec');
                const lockModulePath = path.join(CLI_DIR, 'memory-index-lock.js');
                const mkCollection = () => {
                    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-lock-coord-'));
                    const colPath = path.join(dir, 'collection');
                    const schema = new zvec.ZVecCollectionSchema({
                        name: 'locktest',
                        fields: [{ name: 'content', dataType: zvec.ZVecDataType.STRING }],
                    });
                    const col = zvec.ZVecCreateAndOpen(colPath, schema);
                    col.closeSync();
                    return { dir, colPath };
                };
                // holder:真实持锁 + 以 memory.js mcp 形态运行 + 写真 owner
                const HOLDER_SRC = [
                    "'use strict';",
                    "const fs = require('fs');",
                    "const path = require('path');",
                    "const zvec = require('@zvec/zvec');",
                    "const lock = require(process.argv[4]);",
                    "const dir = process.argv[3];",
                    "const col = zvec.ZVecOpen(path.join(dir, 'collection'));",
                    "lock.writeOwner(dir, { mode: 'mcp', projectRoot: process.argv[5] });",
                    "fs.writeFileSync(path.join(dir, 'holder-ready.txt'), String(process.pid), 'utf8');",
                    "setInterval(() => {}, 1000);",
                ].join('\n');
                const writeHolderScript = () => {
                    const hd = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-lock-hscript-'));
                    const scriptPath = path.join(hd, 'memory.js'); // 文件名必须是 memory.js(闸②)
                    fs.writeFileSync(scriptPath, HOLDER_SRC, 'utf8');
                    return scriptPath;
                };
                const waitForFile = (file, timeoutMs) => {
                    const deadline = Date.now() + timeoutMs;
                    while (Date.now() < deadline) {
                        if (fs.existsSync(file)) return true;
                        lock.sleepSync(50);
                    }
                    return fs.existsSync(file);
                };

                // live-foreign:holder 由本测试进程 spawn(ppid 活)→ 富化错误,不杀
                {
                    const { dir, colPath } = mkCollection();
                    const scriptPath = writeHolderScript();
                    const holder = childProcess.spawn(process.execPath, [scriptPath, 'mcp', dir, lockModulePath, HERE], {
                        stdio: 'ignore', cwd: WORKSPACE_ROOT, env: { ...process.env },
                    });
                    try {
                        assert.ok(waitForFile(path.join(dir, 'holder-ready.txt'), 8000), 'holder acquired the lock');
                        const holderOwnerBytes = fs.readFileSync(path.join(dir, 'owner.json'), 'utf8');
                        const killSpy = [];
                        let threw = null;
                        try {
                            lock.openWithCoordination(() => zvec.ZVecOpen(colPath), dir, {
                                projectRoot: HERE,
                                seams: { killFn: (pid, sig) => { killSpy.push([pid, sig]); } },
                            });
                        } catch (err) {
                            threw = err;
                        }
                        assert.ok(threw, 'conflict must throw');
                        assert.strictEqual(threw.code, 'EVO_ZVEC_LOCKED');
                        assert.strictEqual(threw.verdict, 'live-foreign');
                        assert.ok(threw.message.includes(String(holder.pid)), 'error names holder pid');
                        assert.ok(threw.message.includes('不会自动终止'), 'error states no auto-kill');
                        assert.ok(threw.message.includes('Get-CimInstance') || threw.message.includes('ps -eo'), 'error carries enumeration command');
                        assert.ok(threw.cause, 'original zvec error preserved as cause');
                        assert.strictEqual(killSpy.length, 0, 'killFn never invoked on live-foreign');
                        assert.ok(lock.pidAlive(holder.pid), 'holder survives');
                        assert.strictEqual(fs.readFileSync(path.join(dir, 'owner.json'), 'utf8'), holderOwnerBytes, 'holder owner not overwritten');
                    } finally {
                        try { holder.kill(); } catch (_) {}
                    }
                }

                // orphan self-heal(原事故最小复刻):中间 spawner detached 拉起孙子后退出
                {
                    const { dir, colPath } = mkCollection();
                    const scriptPath = writeHolderScript();
                    const SPAWNER_SRC = [
                        "'use strict';",
                        "const { spawn } = require('child_process');",
                        "const fs = require('fs');",
                        "const path = require('path');",
                        "const [holderScript, dir, lockPath, projectRoot] = process.argv.slice(2);",
                        "const child = spawn(process.execPath, [holderScript, 'mcp', dir, lockPath, projectRoot], { detached: true, stdio: 'ignore', env: process.env, cwd: process.cwd() });",
                        "child.unref();",
                        "const ready = path.join(dir, 'holder-ready.txt');",
                        "(function wait() { if (fs.existsSync(ready)) process.exit(0); setTimeout(wait, 50); })();",
                    ].join('\n');
                    const spawnerPath = path.join(path.dirname(scriptPath), 'spawner.js');
                    fs.writeFileSync(spawnerPath, SPAWNER_SRC, 'utf8');
                    childProcess.execFileSync(process.execPath, [spawnerPath, scriptPath, dir, lockModulePath, HERE], {
                        cwd: WORKSPACE_ROOT, env: { ...process.env }, timeout: 15000,
                    });
                    const orphanPid = Number(fs.readFileSync(path.join(dir, 'holder-ready.txt'), 'utf8'));
                    assert.ok(lock.pidAlive(orphanPid), 'orphan holder alive before coordination');
                    let opened = null;
                    try {
                        opened = lock.openWithCoordination(() => zvec.ZVecOpen(colPath), dir, { projectRoot: HERE });
                        assert.ok(opened && opened.result, 'self-heal recovered the lock');
                        assert.ok(typeof opened.leaseId === 'string' && opened.leaseId.length > 0);
                        assert.strictEqual(lock.pidAlive(orphanPid), false, 'orphan terminated');
                        const rec = lock.readOwner(dir);
                        assert.strictEqual(rec.state, 'valid');
                        assert.strictEqual(rec.owner.pid, process.pid, 'owner now belongs to us');
                    } finally {
                        if (opened && opened.result) { try { opened.result.closeSync(); } catch (_) {} }
                        if (opened) lock.clearOwner(dir, opened.leaseId);
                        try { process.kill(orphanPid); } catch (_) {} // 自愈失败时兜底,不留僵尸
                    }
                }
            }
        }
        console.log('✅ T-lock-coordination passed');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node templates/cli/test.js governance`
Expected: FAIL,`lock.openWithCoordination is not a function`。

- [ ] **Step 3: 实现(在 `diagnoseLockConflict` 之后追加)**

```js
const BACKOFF_RETRIES = 3;
const BACKOFF_MS = 100;
const TERM_WAIT_MS = 1500;
const KILL_WAIT_MS = 1000;
const POLL_MS = 100;

// 同步睡眠:Atomics.wait 在 Node 主线程可用,避免为等待拉子进程。
function sleepSync(ms) {
    const sab = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

function waitForExit(pid, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!pidAlive(pid)) return true;
        sleepSync(POLL_MS);
    }
    return !pidAlive(pid);
}

// 锁错误识别:zvec.isZVecError + "Can't lock" message。识别失败宁可当非锁
// 错误 rethrow(设计 §6:非锁错误零干预)。
function isLockError(err) {
    if (!err) return false;
    let isZ = false;
    try {
        isZ = require('@zvec/zvec').isZVecError(err);
    } catch (_) {
        isZ = /zvec/i.test(String(err.name || ''));
    }
    return isZ && /can't lock/i.test(String(err.message || ''));
}

// 自愈阶梯(设计 §4.4,仅 orphaned-own-mcp 或 dead-holder 语义进入):
// 身份复核 → SIGTERM → 有界等待 → SIGKILL → 等消失 → CAS 清 stale owner。
// win32 说明:SIGTERM/SIGKILL 底层同为 TerminateProcess,阶梯在 unix 生效,
// win32 退化为单级;等待与复核两步在所有平台保留(防 native handle 未释放即重开)。
function attemptSelfHeal(dir, diag, ctx = {}) {
    const owner = diag.owner;
    const kill = (ctx.seams && typeof ctx.seams.killFn === 'function')
        ? ctx.seams.killFn
        : (pid, sig) => process.kill(pid, sig);
    const recheck = getProcessSnapshot(owner.pid, ctx.seams);
    if (recheck && recheck.alive === false) {
        // 诊断与自愈之间已自行退出 → 无进程可杀,仅清 stale owner
    } else if (!recheck || !isExpectedMcpProcess(recheck, owner)) {
        // 窗口期内 PID 被复用或身份不再可确认 → 中止,绝不杀
        return { healed: false, reason: `自愈中止:pid ${owner.pid} 的身份在复核时不再成立(可能 PID 复用),绝不自动终止` };
    } else {
        try { kill(owner.pid, 'SIGTERM'); } catch (_) {}
        if (!waitForExit(owner.pid, TERM_WAIT_MS)) {
            try { kill(owner.pid, 'SIGKILL'); } catch (_) {}
            if (!waitForExit(owner.pid, KILL_WAIT_MS)) {
                return { healed: false, reason: `自愈失败:pid ${owner.pid} 未在限时内退出` };
            }
        }
    }
    // R1 P0-1:清理必须走 CAS(observedLeaseId)。不匹配 = 新持有者已接管,
    // 不删除;调用方直接重试 open。
    clearOwner(dir, diag.observedLeaseId);
    return { healed: true };
}

function buildLockError(diag, cause) {
    const ownerLine = diag.owner
        ? `holder: pid=${diag.owner.pid} mode=${diag.owner.mode} started=${diag.owner.processStartedAt}\n`
        : '';
    const err = new Error(
        `zvec collection 被锁定:${diag.report.reason}\n`
        + `LOCK: ${diag.report.lockPath}\n`
        + ownerLine
        + `排查(可复制执行):${diag.report.enumerate}`);
    err.code = 'EVO_ZVEC_LOCKED';
    err.verdict = diag.verdict;
    err.report = diag.report;
    err.cause = cause;
    return err;
}

// 协调打开(设计 §4.3):backoff 吸收瞬时交错 → 诊断 → dead-holder CAS 清理
// / orphan 自愈 → 各自最终重试一次;重试仍冲突则重新诊断一轮后抛富化错误。
// 非锁错误在任何阶段都原样 rethrow。
function openWithCoordination(openFn, dir, ctx = {}) {
    const succeed = result => ({ result, leaseId: writeOwner(dir, { projectRoot: ctx.projectRoot }) });
    let lastErr = null;
    for (let attempt = 0; attempt <= BACKOFF_RETRIES; attempt++) {
        if (attempt > 0) sleepSync(BACKOFF_MS);
        try {
            return succeed(openFn());
        } catch (err) {
            if (!isLockError(err)) throw err;
            lastErr = err;
        }
    }
    let diag = diagnoseLockConflict(dir, ctx);
    if (diag.verdict === 'dead-holder') {
        clearOwner(dir, diag.observedLeaseId);
        try {
            return succeed(openFn());
        } catch (err) {
            if (!isLockError(err)) throw err;
            lastErr = err;
            diag = diagnoseLockConflict(dir, ctx); // 重新诊断,最多一轮(不变量 4)
        }
    }
    if (diag.verdict === 'orphaned-own-mcp') {
        const heal = attemptSelfHeal(dir, diag, ctx);
        if (heal.healed) {
            try {
                return succeed(openFn());
            } catch (err) {
                if (!isLockError(err)) throw err;
                lastErr = err;
                diag = diagnoseLockConflict(dir, ctx); // 新持有者可能已接管;最多一轮
            }
        } else {
            diag = { ...diag, verdict: 'unknown', report: { ...diag.report, reason: heal.reason } };
        }
    }
    throw buildLockError(diag, lastErr);
}
```

`module.exports` 追加:`BACKOFF_RETRIES, BACKOFF_MS, TERM_WAIT_MS, KILL_WAIT_MS, POLL_MS, sleepSync, waitForExit, isLockError, attemptSelfHeal, openWithCoordination,`。

- [ ] **Step 4: 跑测试确认通过**

Run: `node templates/cli/test.js governance`
Expected: PASS,输出含 `✅ T-lock-coordination passed`(zvec 在场时 live-foreign + orphan 两例都执行)。

- [ ] **Step 5: Commit**

```bash
git add templates/cli/memory-index-lock.js templates/cli/test/governance.js
git commit -m "feat(lock): openWithCoordination with backoff, CAS dead-holder cleanup, gated self-heal ladder (a177 L4)"
```

---

### Task 5: ZvecMemoryIndex ephemeral 租期 + owner 集成

**Files:**
- Modify: `templates/cli/memory-index-zvec.js`
- Test: `templates/cli/test/governance.js`(插在 `✅ T-lock-coordination passed` 行之后)

**Interfaces:**
- Consumes: Task 4 `openWithCoordination`;Task 1 `clearOwner`;`./runtime` 的 `getWorkspaceRoot`。
- Produces: `EVO_LITE_INDEX_EPHEMERAL=1` 下所有公开操作(upsert/searchText/delete/stats/list)open→op→finalize;`_withCollection(fn)` 重入计数;`_finalizeSync` 末尾 CAS 清 owner。环境变量未设 → 现行为完全不变。`SqliteFtsIndex` 不改。

- [ ] **Step 1: 写失败测试**

插在 `console.log('✅ T-lock-coordination passed');` 之后:

```js
        console.log('T-lock-ephemeral. Testing ephemeral lock tenure matrix (skips if @zvec/zvec absent) ...');
        {
            let zvecAvailable = true;
            try { require.resolve('@zvec/zvec'); } catch (_) { zvecAvailable = false; }
            if (!zvecAvailable) {
                console.log('   ⏭️ skipped — @zvec/zvec not installed (optional dependency)');
            } else {
                const prevEphemeral = process.env.EVO_LITE_INDEX_EPHEMERAL;
                const runtime = createTempRuntimeRoot('lock-ephemeral');
                await bootstrapRuntime(runtime.runtimeRoot);
                const lock = require(path.join(CLI_DIR, 'memory-index-lock.js'));
                try {
                    process.env.EVO_LITE_INDEX_EPHEMERAL = '1';
                    resetCliModuleCache();
                    const { ZvecMemoryIndex } = require(path.join(CLI_DIR, 'memory-index-zvec.js'));
                    const a = new ZvecMemoryIndex();

                    // success → close:公共契约是"第二实例可立即打开"
                    a.upsert({ content: 'ephemeral tenure probe recall', namespace: 'prose', timestamp: '2026-07-23T00:00:00Z' });
                    assert.strictEqual(a._col, null, 'aux white-box: collection released after op');
                    const b = new ZvecMemoryIndex();
                    b.initialize(); // a 若仍持锁,这里会 Can't lock
                    b.close();
                    assert.strictEqual(lock.readOwner(a._dir).state, 'missing', 'owner cleared after finalize');

                    // throw → close:异常路径 finally 释放
                    let threw = false;
                    try {
                        a._withCollection(() => { throw new Error('op failure'); });
                    } catch (_) { threw = true; }
                    assert.ok(threw, 'op error propagates');
                    assert.strictEqual(a._col, null, 'released after throwing op');
                    const c = new ZvecMemoryIndex();
                    c.initialize();
                    c.close();

                    // nested success:inner 不提前 close,outer 归零才 finalize
                    a._withCollection(() => {
                        const hits = a.searchText('ephemeral', { topK: 3 });
                        assert.ok(Array.isArray(hits), 'inner op works');
                        assert.ok(a._col !== null, 'inner op must not close while outer active');
                    });
                    assert.strictEqual(a._col, null, 'outer exit finalizes');

                    // nested throw:不破坏 depth,outer finally 正常释放
                    try {
                        a._withCollection(() => {
                            a._withCollection(() => { throw new Error('inner failure'); });
                        });
                    } catch (_) {}
                    assert.strictEqual(a._depth, 0, 'depth restored after nested throw');
                    assert.strictEqual(a._col, null, 'released after nested throw');

                    // default mode:未设环境变量 → op 后集合仍开(现行为不变)
                    delete process.env.EVO_LITE_INDEX_EPHEMERAL;
                    resetCliModuleCache();
                    const { ZvecMemoryIndex: DefaultZvec } = require(path.join(CLI_DIR, 'memory-index-zvec.js'));
                    const d = new DefaultZvec();
                    d.upsert({ content: 'default tenure probe', namespace: 'prose', timestamp: '2026-07-23T00:01:00Z' });
                    assert.ok(d._col !== null, 'default mode keeps collection open after op');
                    d.close();
                    assert.strictEqual(lock.readOwner(d._dir).state, 'missing', 'close clears owner in default mode too');
                } finally {
                    if (prevEphemeral === undefined) delete process.env.EVO_LITE_INDEX_EPHEMERAL;
                    else process.env.EVO_LITE_INDEX_EPHEMERAL = prevEphemeral;
                    resetCliModuleCache();
                }
            }
        }
        console.log('✅ T-lock-ephemeral passed');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node templates/cli/test.js governance`
Expected: FAIL(`a._col` 在 upsert 后非 null,或 `_withCollection` 不存在)。

- [ ] **Step 3: 修改 `templates/cli/memory-index-zvec.js`**

require 区(第 5-7 行附近)改为:

```js
const { getNamespaces } = require('./db');
const { getDbPath, getWorkspaceRoot } = require('./runtime');
const { generateSnippet, rerankByExact } = require('./memory-index-util');
const { openWithCoordination, clearOwner } = require('./memory-index-lock');
```

constructor 改为:

```js
    constructor() {
        this._col = null;
        this._dirty = false;      // writes pending an FTS optimize
        this._exitHooked = false;
        this._dir = zvecRoot();
        this._colPath = path.join(this._dir, 'collection');
        this._idFile = path.join(this._dir, 'nextid.json');
        // Ephemeral tenure ([a177]): open→op→finalize per public op, so the
        // zvec write lock is held for milliseconds instead of process lifetime.
        this._ephemeral = process.env.EVO_LITE_INDEX_EPHEMERAL === '1';
        this._depth = 0;
        this._leaseId = null;
    }
```

initialize 的打开语句改为(exit hook 与 idFile 逻辑不动):

```js
    initialize() {
        const z = loadZvec();
        fs.mkdirSync(this._dir, { recursive: true });
        const { result, leaseId } = openWithCoordination(
            () => (fs.existsSync(this._colPath)
                ? z.ZVecOpen(this._colPath)
                : z.ZVecCreateAndOpen(this._colPath, this._schema())),
            this._dir,
            { projectRoot: getWorkspaceRoot() },
        );
        this._col = result;
        this._leaseId = leaseId;
        if (!this._exitHooked) {
            // Zvec FTS segments only become queryable after optimizeSync(); the
            // evo-lite CLI is one-shot per command, so without finalizing on exit
            // a write is invisible to the next `recall` process. Finalize once at
            // process exit (optimize only if we actually wrote). In ephemeral
            // mode this is an idempotent no-op (already finalized per op).
            process.once('exit', () => { try { this._finalizeSync(); } catch (_) {} });
            this._exitHooked = true;
        }
        if (!fs.existsSync(this._idFile)) {
            fs.writeFileSync(this._idFile, JSON.stringify({ next: this._maxId() + 1 }), 'utf8');
        }
    }
```

`_finalizeSync` 改为(末尾 CAS 清 owner):

```js
    _finalizeSync() {
        if (!this._col) return;
        if (this._dirty) {
            try { this._col.optimizeSync(); } catch (_) {}
            this._dirty = false;
        }
        try { this._col.closeSync(); } catch (_) {}
        this._col = null;
        if (this._leaseId) {
            try { clearOwner(this._dir, this._leaseId); } catch (_) {}
            this._leaseId = null;
        }
    }
```

`_col_()` 之后新增 `_withCollection`:

```js
    // 重入计数的租期包装:所有公开操作必经。ephemeral 下 depth 归零即 finalize
    // (异常路径也在 finally 释放);默认模式仅计数,不改变现行为。
    _withCollection(fn) {
        this._depth++;
        try {
            return fn(this._col_());
        } finally {
            this._depth--;
            if (this._ephemeral && this._depth === 0) {
                this._finalizeSync();
            }
        }
    }
```

五个公开操作包裹(方法体逐字,仅把 `const col = this._col_();` 换成包装):

```js
    upsert(doc = {}) {
        return this._withCollection(col => {
            const id = this._nextId();
            col.insertSync([{ id: String(id), fields: {
                content: doc.content,
                namespace: doc.namespace,
                timestamp: doc.timestamp,
            } }]);
            this._dirty = true;
            return { id };
        });
    }
```

```js
    searchText(query, options = {}) {
        return this._withCollection(col => {
            const topK = options.topK || 5;
            // Over-fetch a wider candidate pool so an exact-phrase doc that jieba-OR
            // BM25 ranked below topK is still available to rerankByExact to promote.
            // Capped at MAX_ENUM (Zvec's querySync ceiling); at archive scale (~10^2
            // docs) this is effectively the full set.
            const poolK = Math.min(Math.max(topK * 10, 50), MAX_ENUM);
            const base = { fieldName: 'content', topk: poolK };
            const filter = this._scopeFilter(options.scope);
            if (filter) base.filter = filter;

            let rows;
            let src;
            try {
                rows = col.querySync({ ...base, fts: { queryString: query } });
                src = 'zvec-fts';
            } catch (_) {
                // queryString parser rejects ':'-bearing tokens (task:/spec:/plan:);
                // matchString is the literal, unparsed fallback.
                rows = col.querySync({ ...base, fts: { matchString: query } });
                src = 'zvec-match';
            }

            rows = rerankByExact(rows || [], query, d => d.fields.content).slice(0, topK);

            return (rows || []).map(d => ({
                id: Number(d.id),
                content: d.fields.content,
                namespace: d.fields.namespace,
                timestamp: d.fields.timestamp,
                score: d.score,
                snippet: generateSnippet(d.fields.content, query),
                match_source: src,
            }));
        });
    }
```

```js
    delete(id) {
        return this._withCollection(col => {
            const st = col.deleteSync(String(id));
            const changed = st && st.ok ? 1 : 0;
            if (changed) this._dirty = true;
            return { changes: changed };
        });
    }
```

`stats()` 与 `list()` 完整替换为(`_allDocs` 内部经 `_col_()` 取集合,包装作用域内始终打开):

```js
    stats() {
        return this._withCollection(() => {
            const all = this._allDocs();
            const nsCounts = {};
            let first = null;
            let last = null;
            for (const d of all) {
                const ns = d.fields.namespace;
                nsCounts[ns] = (nsCounts[ns] || 0) + 1;
                const ts = d.fields.timestamp;
                if (ts) {
                    if (!first || ts < first) first = ts;
                    if (!last || ts > last) last = ts;
                }
            }
            const namespaces = {};
            for (const ns of getNamespaces()) {
                const count = nsCounts[ns] || 0;
                namespaces[ns] = { chunks: count, present: count > 0, model: ENGINE, dims: '1' };
            }
            return { chunks: all.length, count: all.length, namespaces, first, last };
        });
    }
```

```js
    list() {
        return this._withCollection(() => this._allDocs()
            .map(d => ({
                id: Number(d.id),
                content: d.fields.content,
                namespace: d.fields.namespace,
                timestamp: d.fields.timestamp,
            }))
            .sort((a, b) => a.id - b.id));
    }
```

- [ ] **Step 4: 跑测试确认通过(含既有 T-ZV 回归)**

Run: `node templates/cli/test.js governance`
Expected: PASS,`✅ T-lock-ephemeral passed` 与 `✅ T-ZV ZvecMemoryIndex passed` 同时在场(默认模式行为未变)。

- [ ] **Step 5: Commit**

```bash
git add templates/cli/memory-index-zvec.js templates/cli/test/governance.js
git commit -m "feat(lock): ephemeral lock tenure in ZvecMemoryIndex via reentrant _withCollection (a177 L5)"
```

---

### Task 6: MCP stdin-EOF 生命周期 + 进程身份声明

**Files:**
- Modify: `templates/cli/mcp-server.js:209-241`(runMcpServer)
- Modify: `templates/cli/memory-index.js`(新增 `peekMemoryIndex`)
- Test: `templates/cli/test/governance.js`(插在 `✅ T-lock-ephemeral passed` 行之后)

**Interfaces:**
- Consumes: Task 5 的 ephemeral 行为;Task 1 `readOwner`。
- Produces: `runMcpServer` 启动即设 `EVO_LITE_INDEX_EPHEMERAL=1` + `EVO_LITE_PROCESS_MODE='mcp'`;stdin `end`/`close`、`server.onclose`、SIGINT/SIGTERM 全部收敛到幂等 `shutdown()`;`memory-index.js` 导出 `peekMemoryIndex() → MemoryIndex|null`(只读,不创建实例)。

- [ ] **Step 1: 写失败测试**

插在 `console.log('✅ T-lock-ephemeral passed');` 之后:

```js
        console.log('T-mcp-stdin-exit. Testing MCP exits on stdin EOF, clears owner, releases lock (skips if @zvec/zvec absent) ...');
        {
            let zvecAvailable = true;
            try { require.resolve('@zvec/zvec'); } catch (_) { zvecAvailable = false; }
            if (!zvecAvailable) {
                console.log('   ⏭️ skipped — @zvec/zvec not installed (optional dependency)');
            } else {
                const runtime = createTempRuntimeRoot('mcp-stdin-exit');
                await bootstrapRuntime(runtime.runtimeRoot);
                const lock = require(path.join(CLI_DIR, 'memory-index-lock.js'));
                const memJs = path.join(CLI_DIR, 'memory.js');
                const child = childProcess.spawn(process.execPath, [memJs, 'mcp'], {
                    cwd: runtime.workspaceRoot,
                    env: {
                        ...process.env,
                        EVO_LITE_ROOT: runtime.runtimeRoot,
                        EVO_LITE_SKIP_GIT_GUARD: '1',
                        EVO_LITE_MEMORY_ENGINE: 'zvec', // 显式固定,防前序测试遗留 env 干扰
                    },
                    stdio: ['pipe', 'pipe', 'pipe'],
                });
                const exited = new Promise(resolve => child.on('exit', code => resolve(code)));
                let killedByTimeout = false;
                const failsafe = setTimeout(() => { killedByTimeout = true; try { child.kill(); } catch (_) {} }, 20000);
                try {
                    const msg = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
                    child.stdin.write(msg(0, 'initialize', {
                        protocolVersion: '2024-11-05', capabilities: {},
                        clientInfo: { name: 't-lock-stdin', version: '1' },
                    }));
                    await new Promise(r => setTimeout(r, 800));
                    // 让索引真实打开过一次(ephemeral:op 后立即释放)
                    child.stdin.write(msg(1, 'tools/call', { name: 'evo_recall', arguments: { query: 'lock probe', k: 2 } }));
                    await new Promise(r => setTimeout(r, 2000));
                    child.stdin.end(); // 宿主死亡的最小模拟:stdin EOF
                    const code = await exited;
                    clearTimeout(failsafe);
                    assert.ok(!killedByTimeout, 'server must exit on its own after stdin EOF (no zombie)');
                    assert.strictEqual(code, 0, `exit code 0 expected, got ${code}`);
                    // owner 已清
                    const zvecDir = path.join(runtime.runtimeRoot, 'zvec');
                    assert.strictEqual(lock.readOwner(zvecDir).state, 'missing', 'owner cleared after shutdown');
                    // 不变量 6:native 锁确实释放 —— 新 writer 立即 initialize 成功
                    resetCliModuleCache();
                    const { ZvecMemoryIndex } = require(path.join(CLI_DIR, 'memory-index-zvec.js'));
                    const writer = new ZvecMemoryIndex();
                    writer.initialize(); // 若死服务器仍持锁,这里 Can't lock
                    writer.close();
                } finally {
                    clearTimeout(failsafe);
                    try { child.kill(); } catch (_) {}
                }
            }
        }
        console.log('✅ T-mcp-stdin-exit passed');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node templates/cli/test.js governance`
Expected: FAIL —— 现版 MCP 无 stdin 处理,stdin EOF 后进程不退出,failsafe 触发 `killedByTimeout = true` 断言失败。

- [ ] **Step 3: `templates/cli/memory-index.js` 新增只读访问器**

在 `getMemoryIndex` / `resetMemoryIndex`(约 215-230 行)旁新增并导出:

```js
// 只读访问当前活动索引(不创建实例)。MCP shutdown 用它收尾:实例从未创建时
// 不应因收尾反而去打开一次索引。
function peekMemoryIndex() {
    return active;
}
```

`module.exports` 追加 `peekMemoryIndex`。

- [ ] **Step 4: 改写 `runMcpServer`(templates/cli/mcp-server.js)**

整个函数替换为:

```js
async function runMcpServer() {
    // [a177] 长活 MCP 的锁治理:ephemeral 租期(每请求 open→op→finalize)
    // + 进程身份声明(owner sidecar 的 mode 可信来源)。两变量职责正交:
    // 前者定锁租期,后者定进程身份,不得互相推导。
    process.env.EVO_LITE_INDEX_EPHEMERAL = '1';
    process.env.EVO_LITE_PROCESS_MODE = 'mcp';

    try { require('./db').getDb(); } catch (_) {}

    const server = new Server(
        { name: 'evo-lite', version: require('./runtime').getRuntimeVersion() },
        { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        try {
            const result = await dispatch(name, args || {});
            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${err.message}` }],
                isError: true,
            };
        }
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);

    // [a177] 生命周期收敛:宿主死亡(stdin EOF/close)、transport 关闭、信号,
    // 全部走同一个幂等 shutdown —— 停止接入 → 关 server → 收尾索引(经
    // peekMemoryIndex,从未打开则不为收尾反而去打开)→ exitCode → 有界兜底。
    let shuttingDown = false;
    async function shutdown() {
        if (shuttingDown) return;
        shuttingDown = true;
        try { await server.close(); } catch (_) {}
        try {
            const idx = require('./memory-index').peekMemoryIndex();
            if (idx && typeof idx.close === 'function') idx.close();
        } catch (_) {}
        process.exitCode = 0;
        // stdio 句柄可能仍挂在事件循环上;兜底定时器保证进程一定退出,
        // unref 使其不反过来拖住本可自然退出的进程。
        const failsafe = setTimeout(() => process.exit(0), 1500);
        failsafe.unref();
    }

    process.stdin.once('end', shutdown);
    process.stdin.once('close', shutdown);
    server.onclose = () => { shutdown(); };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node templates/cli/test.js governance`
Expected: PASS,输出含 `✅ T-mcp-stdin-exit passed`。

- [ ] **Step 6: Commit**

```bash
git add templates/cli/mcp-server.js templates/cli/memory-index.js templates/cli/test/governance.js
git commit -m "feat(lock): MCP stdin-EOF lifecycle + process-mode declaration + peekMemoryIndex (a177 L6)"
```

---

### Task 7: manifest 注册 + 镜像同步 + 双侧回归闭环

**Files:**
- Modify: `templates/cli/template-manifest.js:16`(core-cli files 数组)
- Modify: `.evo-lite/cli/**`(仅经 sync-runtime,严禁手编)

**Interfaces:**
- Consumes: Task 1-6 全部产出。
- Produces: 模板/镜像 byte-identical;双侧 all 套件绿;manifest +1 条。

- [ ] **Step 1: manifest 注册**

`templates/cli/template-manifest.js` core-cli `files` 数组中,`'memory-index-zvec.js',` 之后插入一行:

```js
            'memory-index-lock.js',
```

- [ ] **Step 2: 模板侧全量回归**

Run: `node templates/cli/test.js all`
Expected: EXIT 0(governance + integration 全绿;若有 manifest 一致性断言,按其报错把断言集合更新为含 `memory-index-lock.js` 的新集合 —— 用集合相等,不硬编码计数)。

- [ ] **Step 3: 同步镜像至收敛**

Run(重复直到输出 `copied: 0`,manifest 变更时预期 2-3 次):

```powershell
.\.evo-lite\mem.cmd sync-runtime
.\.evo-lite\mem.cmd sync-runtime
```

Expected: 最后一次 `copied: 0`,无 divergence 警告。

- [ ] **Step 4: 镜像侧全量回归**

Run: `node .evo-lite/cli/test.js all`
Expected: EXIT 0。

- [ ] **Step 5: 母仓实景 smoke**

```powershell
.\.evo-lite\mem.cmd verify
```

Expected: EXIT 0,verify 输出健康(不引入新 findings)。

- [ ] **Step 6: Commit(模板 + 镜像一起)**

```bash
git add templates/cli/template-manifest.js .evo-lite/cli/
git commit -m "feat(lock): register memory-index-lock in template manifest + mirror sync (a177 L7)"
```

---

## 计划外(终局门,复阅通过后由控制器随收口执行,不属于任务复审范围)

1. 一次性存量清点:`Get-CimInstance Win32_Process -Filter "Name='node.exe'"` 按 CommandLine 含 `memory.js mcp` + CreationDate 甄别,清掉现存旧版僵尸(此后由 Layer 2/3 接管)。
2. 真实 `mem commit` 走通(闭环提交本身即 Layer 1-3 实景验证)。
3. hive nurture CodePLC + hungersnakegame4:子仓镜像 byte-identical、子仓套件绿。
4. 治理收口:R008 证据(完整 task id `task:mcp-zvec-lock-mvp-tN`)+ plan/spec 状态 + focus 迁移 + `mem plan scan` → `mem plan gaps` → `mem dashboard build` → `mem verify`。
