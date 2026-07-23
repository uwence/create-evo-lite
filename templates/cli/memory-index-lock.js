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
