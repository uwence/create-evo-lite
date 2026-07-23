'use strict';

// memory-index-lock.js — zvec 锁生命周期与单写者协调([a177])。
// 引擎无关:owner sidecar 读写 / 进程快照 / 锁冲突诊断 / 协调打开与安全自愈。
// 契约:docs/superpowers/specs/2026-07-23-mcp-zvec-lock-design.md(R2 APPROVED)。
// 安全原则:sidecar 是观察记录不是锁;杀进程决策只信 live snapshot;
// 任何不确定 → report-only。

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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

// CAS:唯一的 owner 删除入口,仅由 finalize 在**仍持有 zvec 独占锁期间**调用
// (plan R1 P0-1:read→unlink 非跨进程原子,锁才是互斥边界;接管路径不删
// owner,由接管成功后的 writeOwner 原子覆盖)。lease 比对是锁内的二重保险:
// 不匹配 = 记录不属于自己 → 静默不动。
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
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return { state: 'corrupt', owner: null, errors: [`owner.json is not an object: ${raw === null ? 'null' : Array.isArray(raw) ? 'array' : typeof raw}`] };
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

// quote-aware argv tokenizer(plan R1 P0-3):支持双/单引号包裹的含空格路径。
// 未闭合引号按"读到串尾"处理 —— 解析失败宁可产生不匹配的 token(→ unknown,
// 拒杀),也不做任何宽松猜测。
function commandTokens(commandLine) {
    const s = String(commandLine || '');
    const tokens = [];
    let cur = '';
    let quote = null;
    for (const ch of s) {
        if (quote) {
            if (ch === quote) quote = null;
            else cur += ch;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
        } else if (/\s/.test(ch)) {
            if (cur) { tokens.push(cur); cur = ''; }
        } else {
            cur += ch;
        }
    }
    if (cur) tokens.push(cur);
    return tokens;
}

// R1 P1:live snapshot 独立确认身份 —— sidecar 自报的 mode 不构成杀进程依据。
// 仅含 memory.js 不够(stats/rebuild 同样命中):entrypoint 后的 token 必须是 mcp。
// R1 P0-2:processStartedAt 必须存在并吻合;缺失 = 闸不过,不是跳过。
// plan R1 P0-3:entrypoint 匹配必须是归一化后的**精确等值** —— 杀进程闸不做
// 任意 suffix 匹配;路径别名/short-name 未来如需支持须走显式 realpath。
function isExpectedMcpProcess(snapshot, owner) {
    if (!snapshot || !owner) return false;
    if (snapshot.isNode !== true) return false;
    if (!snapshot.commandLine || !snapshot.startedAt) return false;
    const entry = normalizePath(owner.entrypoint);
    if (!entry || !entry.endsWith('memory.js')) return false;
    const tokens = commandTokens(snapshot.commandLine).map(normalizePath);
    const entryIdx = tokens.findIndex(tok => tok === entry);
    if (entryIdx === -1) return false;
    if (tokens[entryIdx + 1] !== 'mcp') return false;
    const ownerT = Date.parse(owner.processStartedAt || '');
    const snapT = Date.parse(snapshot.startedAt || '');
    if (Number.isNaN(ownerT) || Number.isNaN(snapT)) return false;
    return Math.abs(ownerT - snapT) <= STARTED_AT_TOLERANCE_MS;
}

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
            report: { ...base, reason: `holder pid ${owner.pid} 已退出,残留 stale owner(接管成功时将被原子覆盖,无需手动清理),可重试` },
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
    // 平台策略(plan R1 P1-2):孤儿自愈仅 win32 —— unix detached 孤儿会被
    // init/systemd 接管(ppid→1 且存活),闸③在 unix 上不可靠,一律 report-only。
    if (process.platform !== 'win32') {
        return {
            verdict: 'live-foreign', owner, snapshot,
            report: { ...base, reason: `pid ${owner.pid}:unix 平台孤儿自愈默认关闭(孤儿被 init 接管,父进程判定不可靠),仅诊断不终止` },
        };
    }
    // 闸③:父进程仍活着 = 有人管着它
    if (snapshot.ppidAlive !== false) {
        const ppidState = snapshot.ppidAlive === true
            ? `父进程 ${snapshot.ppid} 仍存活`
            : `父进程状态无法确认(ppid ${snapshot.ppid})`;
        return {
            verdict: 'live-foreign', owner, snapshot,
            report: { ...base, reason: `pid ${owner.pid} 的${ppidState},不会自动终止该进程` },
        };
    }
    return {
        verdict: 'orphaned-own-mcp', owner, snapshot, observedLeaseId: owner.leaseId,
        report: { ...base, reason: `pid ${owner.pid} 为本仓孤儿 MCP(四道闸全部通过),允许安全自愈` },
    };
}

const BACKOFF_RETRIES = 3;
const BACKOFF_MS = 100;
const TERM_WAIT_MS = 1500;
const KILL_WAIT_MS = 1000;
const POLL_MS = 100;
const POST_KILL_SETTLE_MS = 250;

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

// 自愈阶梯(设计 §4.4,仅 orphaned-own-mcp 验判进入):
// 身份复核 → 首击(win32=SIGKILL / unix=SIGTERM)→ 有界等待 → SIGKILL →
// 等消失 → settle。只杀进程与确认死亡,不动 owner(P0-1)。
function attemptSelfHeal(dir, diag, ctx = {}) {
    // 防御性平台闸(plan R2 执行提示):生产路径已由 diagnoseLockConflict 阻断
    // unix 自愈,这里再守一次,防未来被直接调用时绕过平台策略。
    if (process.platform !== 'win32') {
        return { healed: false, reason: 'unix 平台孤儿自愈默认关闭(仅诊断不终止)' };
    }
    const owner = diag.owner;
    const kill = (ctx.seams && typeof ctx.seams.killFn === 'function')
        ? ctx.seams.killFn
        : (pid, sig) => process.kill(pid, sig);
    const recheck = getProcessSnapshot(owner.pid, ctx.seams);
    if (recheck && recheck.alive === false) {
        // 诊断与自愈之间已自行退出 → 无进程可杀;owner 留给接管覆盖(P0-1)
    } else if (!recheck || !isExpectedMcpProcess(recheck, owner)) {
        // 窗口期内 PID 被复用或身份不再可确认 → 中止,绝不杀
        return { healed: false, reason: `自愈中止:pid ${owner.pid} 的身份在复核时不再成立(可能 PID 复用),绝不自动终止` };
    } else {
        // win32 实测:SIGTERM 对 detached 孤儿进程为 no-op,而设计语义本就是
        // "win32 退化为单级" —— 首击直接 SIGKILL;unix 保留 SIGTERM→SIGKILL 阶梯。
        const firstSignal = process.platform === 'win32' ? 'SIGKILL' : 'SIGTERM';
        try { kill(owner.pid, firstSignal); } catch (_) {}
        if (!waitForExit(owner.pid, TERM_WAIT_MS)) {
            try { kill(owner.pid, 'SIGKILL'); } catch (_) {}
            if (!waitForExit(owner.pid, KILL_WAIT_MS)) {
                return { healed: false, reason: `自愈失败:pid ${owner.pid} 未在限时内退出` };
            }
        }
    }
    // plan R1 P0-1:自愈阶梯到此为止,**不动 owner** —— read→unlink 即便带
    // CAS 也非跨进程原子;zvec 独占锁才是 owner 变更的互斥边界。stale owner
    // 留给接管成功后的 writeOwner 原子覆盖;接管失败则绝不删除。
    // 进程已消失,但 zvec native LOCK 的清理在进程死亡后仍有 ~100ms 级尾巴
    // (实测);设计 §4.4 的"等待"步骤 —— 防止立即重开偶发失败。
    sleepSync(POST_KILL_SETTLE_MS);
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

// 成功发布(plan R1 P0-2):openFn 成功后 writeOwner 若抛错(权限/rename/
// 磁盘),立即 closeSync 回收 collection 再原样抛出 —— 绝不留下"持锁但无
// sidecar"的进程,那正是本议题要消灭的最差状态。
function publishOpened(result, dir, ctx = {}) {
    const write = (ctx.seams && typeof ctx.seams.writeOwnerFn === 'function')
        ? ctx.seams.writeOwnerFn
        : writeOwner;
    try {
        const leaseId = write(dir, { projectRoot: ctx.projectRoot });
        return { result, leaseId };
    } catch (err) {
        try {
            if (result && typeof result.closeSync === 'function') result.closeSync();
        } catch (_) {}
        throw err;
    }
}

// 协调打开(设计 §4.3):backoff 吸收瞬时交错 → 诊断 → dead-holder / orphan
// 自愈 → 各自最终重试一次;重试仍冲突则重新诊断一轮后抛富化错误。
// plan R1 P0-1:接管路径**不预删** stale owner —— zvec 独占锁本身是 owner
// 变更的互斥边界;打开成功即持锁,writeOwner 原子覆盖 stale;失败绝不删除。
// 非锁错误在任何阶段都原样 rethrow。
function openWithCoordination(openFn, dir, ctx = {}) {
    const isLock = (ctx.seams && typeof ctx.seams.isLockErrorFn === 'function')
        ? ctx.seams.isLockErrorFn
        : isLockError;
    let lastErr = null;
    for (let attempt = 0; attempt <= BACKOFF_RETRIES; attempt++) {
        if (attempt > 0) sleepSync(BACKOFF_MS);
        try {
            return publishOpened(openFn(), dir, ctx);
        } catch (err) {
            if (!isLock(err)) throw err;
            lastErr = err;
        }
    }
    let diag = diagnoseLockConflict(dir, ctx);
    if (diag.verdict === 'dead-holder') {
        try {
            return publishOpened(openFn(), dir, ctx); // 成功 = 持锁,writeOwner 覆盖 stale
        } catch (err) {
            if (!isLock(err)) throw err;
            lastErr = err;
            diag = diagnoseLockConflict(dir, ctx); // 重新诊断,最多一轮(不变量 4)
        }
    }
    if (diag.verdict === 'orphaned-own-mcp') {
        const heal = attemptSelfHeal(dir, diag, ctx);
        if (heal.healed) {
            try {
                return publishOpened(openFn(), dir, ctx); // 同上:覆盖而非预删
            } catch (err) {
                if (!isLock(err)) throw err;
                lastErr = err;
                diag = diagnoseLockConflict(dir, ctx); // 新持有者可能已接管;最多一轮
            }
        } else {
            diag = { ...diag, verdict: 'unknown', report: { ...diag.report, reason: heal.reason } };
        }
    }
    throw buildLockError(diag, lastErr);
}

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
    enumerationCommand,
    diagnoseLockConflict,
    BACKOFF_RETRIES,
    BACKOFF_MS,
    TERM_WAIT_MS,
    KILL_WAIT_MS,
    POLL_MS,
    POST_KILL_SETTLE_MS,
    sleepSync,
    waitForExit,
    isLockError,
    attemptSelfHeal,
    openWithCoordination,
};
