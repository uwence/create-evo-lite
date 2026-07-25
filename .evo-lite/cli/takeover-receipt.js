'use strict';
// ATTP receipt IO / 严格项目根发现 / 有效性 / reconcile / 失效事务。禁载 memory.service/db/zvec(不变量6)。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getWorkspaceRoot } = require('./runtime');

const RECEIPT_SCHEMA_VERSION = 1;
const HARD_FIELDS = ['schemaVersion', 'host', 'sessionId', 'projectRoot', 'state'];

// ── fs seam(测试注入失败用;生产恒为真实实现)──
const DEFAULT_FS_OPS = {
    existsSync: fs.existsSync, readFileSync: fs.readFileSync, writeFileSync: fs.writeFileSync,
    renameSync: fs.renameSync, unlinkSync: fs.unlinkSync, mkdirSync: fs.mkdirSync,
    realpathSync: fs.realpathSync, lstatSync: fs.lstatSync,   // lstatSync 供 pathEntryInfo:漏注册会让守卫对健康路径也抛错 → 全 deny
};
let fsOps = { ...DEFAULT_FS_OPS };
function __setFsOps(overrides) { fsOps = { ...DEFAULT_FS_OPS, ...overrides }; }
function __resetFsOps() { fsOps = { ...DEFAULT_FS_OPS }; }

function discoverProjectRoot(startDir) {
    let cur = path.resolve(startDir);
    for (;;) {
        if (fsOps.existsSync(path.join(cur, '.evo-lite'))) return cur;
        const parent = path.dirname(cur);
        if (parent === cur) throw new Error(`takeover: no .evo-lite ancestor from ${startDir} (not an evo-lite project)`);
        cur = parent;
    }
}
function normalize(p) {
    let r = p.replace(/\\/g, '/');
    if (process.platform === 'win32' && /^[a-z]:/.test(r)) r = r[0].toUpperCase() + r.slice(1);
    return r;
}
// 严格 canonicalization:discover 失败抛;realpath 失败【也抛】。未经物理路径解析的字符串不是
// canonical root —— 用它建立 receipt 身份或做 containment 判断等于 fail-open(R4 复审 P0-2)。
function canonicalProjectRoot(startDir) {
    const root = discoverProjectRoot(startDir || getWorkspaceRoot());
    let real;
    try { real = fsOps.realpathSync(root); }
    catch (e) { throw new Error(`takeover: cannot canonicalize project root ${root}: ${e.message}`); }
    return normalize(real);
}

// 守卫解析 target 时复用同一 fs seam(单一注入点,故障注入可分别覆盖 root 与 target)。
function realpathStrict(p) { return fsOps.realpathSync(p); }   // 失败即抛,调用方 fail-closed
function pathExists(p) { return fsOps.existsSync(p); }

// existsSync 跟随链接:断链 symlink/junction 会返回 false,看起来跟"文件还没建"一模一样。
// 守卫若按后者处理就会退到父目录并放行,而 Write 仍会沿链接写到项目外(R7 复审 P0-1)。
// 这里用 lstat 区分二者:条目本身在不在,以及它是不是链接。
function pathEntryInfo(target) {
    try {
        const st = fsOps.lstatSync(target);
        return { exists: true, symbolicLink: st.isSymbolicLink() };
    } catch (e) {
        if (e && e.code === 'ENOENT') return { exists: false, symbolicLink: false };
        throw e;   // 权限等异常不得当成"不存在"
    }
}

function evoLiteDir(projectRoot) { return path.join(projectRoot, '.evo-lite'); }
function receiptDir(projectRoot, host) { return path.join(evoLiteDir(projectRoot), 'generated', 'takeover', 'receipts', host); }
function receiptPathFor(projectRoot, host, sessionId) {
    const name = crypto.createHash('sha256').update(`${host}\0${sessionId}`).digest('hex');
    return path.join(receiptDir(projectRoot, host), `${name}.json`);
}

function readActiveContextMarkdown(projectRoot) {
    try { return fsOps.readFileSync(path.join(evoLiteDir(projectRoot), 'active_context.md'), 'utf8'); }
    catch (_) { return null; }
}
function countMatches(md, re) { const m = md.match(re); return m ? m.length : 0; }

// 锚点解析 fail-closed:BEGIN/END 不是严格一对 → null(视同 active_context 不可用)。
// 文件存在但结构损坏时,绝不返回"空 focus 的健康结果"。
function readFocusAnchor(projectRoot) {
    const md = readActiveContextMarkdown(projectRoot);
    if (md === null) return null;
    if (countMatches(md, /<!--\s*BEGIN_FOCUS\s*-->/g) !== 1 || countMatches(md, /<!--\s*END_FOCUS\s*-->/g) !== 1) return null;
    const m = md.match(/<!--\s*BEGIN_FOCUS\s*-->([\s\S]*?)<!--\s*END_FOCUS\s*-->/);
    if (!m) return null; // END 在 BEGIN 之前等错序结构
    const text = m[1].trim();
    return { text, hash: crypto.createHash('sha256').update(text).digest('hex').slice(0, 16) };
}

// META 缺失/字段非法 → { ok:false, reason } 供 collector 记入 degraded;绝不让 NaN 穿到 freshness。
function readMetaAnchor(projectRoot) {
    const md = readActiveContextMarkdown(projectRoot);
    if (md === null) return { ok: false, reason: 'active-context-unreadable', meta: null };
    if (countMatches(md, /<!--\s*BEGIN_META\s*-->/g) !== 1 || countMatches(md, /<!--\s*END_META\s*-->/g) !== 1) {
        return { ok: false, reason: 'meta-anchor-missing', meta: null };
    }
    const m = md.match(/<!--\s*BEGIN_META\s*-->([\s\S]*?)<!--\s*END_META\s*-->/);
    if (!m) return { ok: false, reason: 'meta-anchor-malformed', meta: null };
    const block = m[1];
    const pick = (key) => { const r = block.match(new RegExp(`${key}:\\s*([^\\s]+)`)); return r ? r[1] : null; };
    const rawAhead = pick('ahead'), rawBehind = pick('behind');
    const toInt = (raw) => {                       // 提交计数:必须是非负整数,否则归一为 null
        if (raw === null) return { ok: false, value: null };
        const n = Number(raw);
        return Number.isInteger(n) && n >= 0 ? { ok: true, value: n } : { ok: false, value: null };
    };
    const ahead = toInt(rawAhead), behind = toInt(rawBehind);
    const headSha = pick('headSha');
    const meta = { headSha, upstreamSha: pick('upstreamSha'), ahead: ahead.value, behind: behind.value };
    if (!headSha || !ahead.ok || !behind.ok) {
        return { ok: false, reason: 'meta-fields-invalid', meta }; // meta 仍返回(键齐全、数值为 null)
    }
    return { ok: true, reason: null, meta };
}

function publishReceipt(projectRoot, receiptObj) {
    const finalPath = receiptPathFor(projectRoot, receiptObj.host, receiptObj.sessionId);
    fsOps.mkdirSync(path.dirname(finalPath), { recursive: true });
    const tmp = path.join(path.dirname(finalPath), `.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}.json`);
    fsOps.writeFileSync(tmp, JSON.stringify(receiptObj), 'utf8');
    fsOps.renameSync(tmp, finalPath);
}

function readReceipt(projectRoot, host, sessionId) {
    const p = receiptPathFor(projectRoot, host, sessionId);
    if (!fsOps.existsSync(p)) return { state: 'missing', reason: null, receipt: null };
    let raw; try { raw = JSON.parse(fsOps.readFileSync(p, 'utf8')); }
    catch (_) { return { state: 'invalid', reason: 'corrupt', receipt: null }; }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { state: 'invalid', reason: 'corrupt', receipt: null };
    for (const f of HARD_FIELDS) if (!(f in raw)) return { state: 'invalid', reason: `missing-${f}`, receipt: raw };
    if (raw.state !== 'committed') return { state: 'invalid', reason: raw.reason || 'state-not-committed', receipt: raw };
    const canonRoot = canonicalProjectRoot(projectRoot);
    if (raw.schemaVersion !== RECEIPT_SCHEMA_VERSION || raw.host !== host || raw.sessionId !== sessionId || raw.projectRoot !== canonRoot) {
        return { state: 'invalid', reason: 'identity-mismatch', receipt: raw };
    }
    return { state: 'committed', reason: null, receipt: raw };
}

// canonicalization 失败时【不得】用 path.resolve 造替代 identity(那会写出一份带假身份的 receipt)。
// 此时只允许"不写入任何身份"的撤销方式 —— unlink;再失败则如实报告 ok:false,由守卫 fail-closed。
function invalidateReceipt(projectRoot, host, sessionId, reason) {
    let canonRoot = null;
    try { canonRoot = canonicalProjectRoot(projectRoot); }
    catch (e) { canonRoot = null; reason = `${reason}; canonicalization-failed: ${e.message}`; }
    if (canonRoot !== null) {
        try {
            publishReceipt(projectRoot, { schemaVersion: RECEIPT_SCHEMA_VERSION, host, sessionId, projectRoot: canonRoot, state: 'invalid', reason });
            return { ok: true, method: 'tombstone', reason: null };
        } catch (_) { /* 回退 unlink */ }
    }
    try {
        const p = receiptPathFor(projectRoot, host, sessionId);
        if (fsOps.existsSync(p)) fsOps.unlinkSync(p);
        return { ok: true, method: 'unlink', reason: null };
    } catch (e) { return { ok: false, method: 'none', reason: e.message }; }
}

function reconcile({ projectRoot, host, sessionId }) {
    const rr = readReceipt(projectRoot, host, sessionId);
    const focus = readFocusAnchor(projectRoot);
    if (focus === null) {
        let invalidation = { ok: true, method: 'none' };
        if (rr.state === 'committed') invalidation = invalidateReceipt(projectRoot, host, sessionId, 'active-context-unreadable');
        // 失效持久化即便双失败,verdict 仍为 degraded —— 守卫据此 fail-closed(不依赖文件状态)
        return { verdict: { state: 'invalid', transition: 'degraded', reason: 'active-context-unreadable' }, focus: null, invalidation };
    }
    if (rr.state !== 'committed') {
        return { verdict: { state: rr.state === 'missing' ? 'missing' : 'invalid', transition: 'stale', reason: rr.reason }, focus, invalidation: null };
    }
    if (rr.receipt.focusHash !== focus.hash) {
        publishReceipt(projectRoot, { ...rr.receipt, focusHash: focus.hash });
        return { verdict: { state: 'committed', transition: 'refreshed', reason: null }, focus, invalidation: null };
    }
    return { verdict: { state: 'committed', transition: 'active', reason: null }, focus, invalidation: null };
}

module.exports = {
    RECEIPT_SCHEMA_VERSION, discoverProjectRoot, canonicalProjectRoot, evoLiteDir, receiptPathFor,
    readFocusAnchor, readMetaAnchor, publishReceipt, readReceipt, invalidateReceipt, reconcile,
    realpathStrict, pathExists, pathEntryInfo, __setFsOps, __resetFsOps,
};
