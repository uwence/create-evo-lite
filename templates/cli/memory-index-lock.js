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
