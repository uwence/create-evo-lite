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

// [memory-lock-win-cim-snapshot-reliability] Phase 3A — 结果分类。
//
// 这里原本把六种事件(spawn 失败 / 超时 / 非零退出 / 空 stdout / 解析失败 /
// CIM 空行)全部折叠成同一个 `null`。安全上正确 —— 调用方一律按"不可确认"
// 处理;可诊断性上是灾难 —— 同一个 null 既可能是"这台 runner 慢",也可能是
// "我们把命令写错了",而 release gate 无从区分。
//
// 设计冻结:docs/superpowers/specs/2026-08-02-memory-lock-win-cim-snapshot-reliability-design.md
// 实施计划:docs/superpowers/plans/2026-08-02-memory-lock-win-cim-snapshot-reliability.md
//
// Phase 3A 只做分类,**不做重试**,单次预算保持 10 000 ms 不变。

const SNAPSHOT_TIMEOUT_MS = 10000;
const STREAM_SAMPLE_BYTES = 400;

// 确定性清洗。诊断流可能含命令行 —— 也就是路径与参数,其中可能带凭据。
// 清洗必须发生在截断【之前】:先截断会把一个秘密切成两半,让两侧都逃过匹配。
const SECRET_PATTERNS = [
    // KEY=value / TOKEN=value / SECRET=value / PASSWORD=value(大小写不敏感)
    /\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Za-z0-9_]*)\s*=\s*\S+/gi,
    // --token <v> / --key <v> / --password <v> / --secret <v>
    /(--(?:token|key|password|secret))(\s+|=)\S+/gi,
    // Authorization: <v>
    /(Authorization\s*:\s*)\S+(\s+\S+)?/gi,
    // 已知前缀的连续非空白串
    /\b(?:ghp_|gho_|sk-)\S+/gi,
];

function sanitizeStream(text) {
    let s = String(text === undefined || text === null ? '' : text);
    s = s.replace(SECRET_PATTERNS[0], (_m, name) => `${name}=<redacted>`);
    s = s.replace(SECRET_PATTERNS[1], (_m, flag) => `${flag} <redacted>`);
    s = s.replace(SECRET_PATTERNS[2], (_m, head) => `${head}<redacted>`);
    s = s.replace(SECRET_PATTERNS[3], '<redacted>');
    return s;
}

// 清洗失败时**不保留原文** —— 宁可丢掉诊断,也不泄露未经检查的字节。
//
// 顺序在这里,不在调用方:清洗必须先于截断。反过来会把一个秘密从它的载体
// (`KEY=`、`--token`)上切开,剩下一段裸值,之后任何清洗都认不出来。
function safeStreamSample(text, sanitizer = sanitizeStream) {
    const raw = String(text === undefined || text === null ? '' : text);
    try {
        return truncateStream(sanitizer(raw));
    } catch (_) {
        return `<redacted:${Buffer.byteLength(raw, 'utf8')} bytes>`;
    }
}

// 按 UTF-8 **字节**预算取一段,且以 code point 为单位累计 —— 直接对
// Buffer 切片再解码会把多字节字符切断,产生 U+FFFD。
// String.length 是 UTF-16 code unit,不是字节:400 个汉字约 1200 字节,
// 400 个 emoji 约 1600 字节,按字符切片会大幅超出冻结的字节预算。
function takeBytes(s, budget, fromEnd) {
    const chars = Array.from(s); // 按 code point 切分,不会拆开代理对
    const seq = fromEnd ? chars.slice().reverse() : chars;
    const out = [];
    let bytes = 0;
    for (const ch of seq) {
        const b = Buffer.byteLength(ch, 'utf8');
        if (bytes + b > budget) break;
        bytes += b;
        out.push(ch);
    }
    return fromEnd ? out.reverse().join('') : out.join('');
}

// 首尾各保留至多 STREAM_SAMPLE_BYTES 字节。超时时的部分输出是判断"查询是否
// 已开始应答"的唯一线索,但完整 stdout 可能很大,且可能含命令行(即路径与
// 参数)。
function truncateStream(text) {
    const s = String(text === undefined || text === null ? '' : text);
    const total = Buffer.byteLength(s, 'utf8');
    if (total <= STREAM_SAMPLE_BYTES * 2) return s;
    const head = takeBytes(s, STREAM_SAMPLE_BYTES, false);
    const tail = takeBytes(s, STREAM_SAMPLE_BYTES, true);
    const omitted = total - Buffer.byteLength(head, 'utf8') - Buffer.byteLength(tail, 'utf8');
    return `${head}…[${omitted} bytes omitted]…${tail}`;
}

// 归一化器:**唯一**的 try/catch 所在。
// 原生 execFileSync 的合同是「成功返回 stdout / 失败抛错」,错误上带
// status、signal、stdout、stderr;code 只在 ENOENT、ETIMEDOUT 一类情形出现,
// 非零退出时 code 为 undefined。分类器不应重复处理这两种形态。
function runSnapshotCommand(exe, args, options, execFn) {
    const t0 = process.hrtime.bigint();
    const elapsed = () => Math.round((Number(process.hrtime.bigint() - t0) / 1e6) * 1000) / 1000;
    try {
        const stdout = execFn(exe, args, options);
        return { status: 0, signal: null, stdout: String(stdout === undefined || stdout === null ? '' : stdout), stderr: '', error: null, elapsedMs: elapsed() };
    } catch (err) {
        return {
            status: err && err.status !== undefined ? err.status : null,
            signal: err && err.signal !== undefined ? err.signal : null,
            stdout: String((err && err.stdout) || ''),
            stderr: String((err && err.stderr) || ''),
            error: err || null,
            elapsedMs: elapsed(),
        };
    }
}

// E1 冻结的**固定键集**,十项,一个不多。多出一个键就会让"固定键集"降格成
// 建议。`alive` / `dead` 不携带 detail —— 它只用来解释"为什么没有可用答案"。
function buildSnapshotDetail(run) {
    return {
        platform: process.platform,
        elapsedMs: run.elapsedMs,
        timeoutMs: SNAPSHOT_TIMEOUT_MS,
        status: run.status,
        signal: run.signal,
        errorCode: (run.error && run.error.code) || null,
        // 同样过清洗与有界截断:child-process 的错误消息可能带上可执行文件、
        // 参数或命令内容,原样写进 detail 会绕开 stdout 那一侧的清洗。
        errorMessage: run.error && run.error.message ? safeStreamSample(String(run.error.message)) : null,
        stdoutBytes: Buffer.byteLength(run.stdout || '', 'utf8'),
        stderrBytes: Buffer.byteLength(run.stderr || '', 'utf8'),
        partialStdout: safeStreamSample(run.stdout),
    };
}

// 受限接口:只允许覆盖 errorMessage,且覆盖值同样经清洗。
// 早先的写法接受自由 overrides 对象并 spread 进去 —— 那等于给"固定十键"
// 留了一个随时可以悄悄加第十一个键的口子。
function unavailable(reason, run, errorMessageOverride) {
    const detail = buildSnapshotDetail(run);
    if (errorMessageOverride !== undefined) {
        detail.errorMessage = safeStreamSample(String(errorMessageOverride));
    }
    return { state: 'unavailable', reason, detail };
}

const EMPTY_RUN = { status: null, signal: null, stdout: '', stderr: '', error: null, elapsedMs: 0 };

function snapshotCommand(pid) {
    if (process.platform === 'win32') {
        const script = `Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}" | Select-Object Name,ProcessId,ParentProcessId,CommandLine,@{n='StartedAt';e={$_.CreationDate.ToUniversalTime().ToString('o')}} | ConvertTo-Json`;
        return { exe: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', script] };
    }
    return { exe: 'ps', args: ['-o', 'ppid=,lstart=,args=', '-p', String(Number(pid))] };
}

// win32:JSON 行 → 身份字段。任一字段缺失/类型非法/pid 不匹配 → invalid-row。
// 畸形行绝不呈现为 alive:身份字段是杀进程决策的输入,字段非法不是"较差的
// 证据",是【没有】证据。
function parseWin32Row(pid, run) {
    let parsed;
    try {
        parsed = JSON.parse(run.stdout);
    } catch (_) {
        return unavailable('parse-error', run);
    }
    // 精确 ProcessId 查询正常返回**单个对象**。空数组 = 没查到;非空数组
    // 意味着这条查询的语义与我们以为的不同 —— 静默取第 [0] 行会把一个
    // 意料之外的结果集当成身份证据。
    if (Array.isArray(parsed)) {
        return unavailable(parsed.length === 0 ? 'no-row' : 'invalid-row', run);
    }
    const row = parsed;
    if (!row || typeof row !== 'object') return unavailable('no-row', run);
    // 严格类型:数字字段必须真的是数字。接受 "123" 这类数字字符串等于放宽
    // 「ParentProcessId 类型非法 → invalid-row」这条冻结规则。
    if (typeof row.ProcessId !== 'number' || !Number.isInteger(row.ProcessId) || row.ProcessId !== Number(pid)) {
        return unavailable('invalid-row', run);
    }
    if (typeof row.ParentProcessId !== 'number' || !Number.isInteger(row.ParentProcessId) || row.ParentProcessId < 0) {
        return unavailable('invalid-row', run);
    }
    // 空白字符串不是身份证据。只查 length === 0 会让 "   " 通过。
    if (typeof row.Name !== 'string' || row.Name.trim().length === 0) return unavailable('invalid-row', run);
    if (typeof row.CommandLine !== 'string' || row.CommandLine.trim().length === 0) return unavailable('invalid-row', run);
    if (typeof row.StartedAt !== 'string' || Number.isNaN(Date.parse(row.StartedAt))) return unavailable('invalid-row', run);
    return {
        state: 'alive',
        snapshot: {
            alive: true,
            isNode: /node(\.exe)?$/i.test(row.Name),
            commandLine: row.CommandLine,
            ppid: row.ParentProcessId,
            ppidAlive: pidAlive(row.ParentProcessId),
            startedAt: row.StartedAt,
        },
    };
}

// 非 win32:`ps -o ppid=,lstart=,args=` 的文本行。lstart 固定 5 段。
//
// transport 天然不对称,这是实现级事实而非测试遗漏:
//   parse-error  只在 win32 的 JSON transport 上可达（此处按文本解析）
//   no-row       只在 win32 的 null / [] 上可达
//   POSIX        空/纯空白 stdout 已在第 5 步判为 empty-output；
//                非空但不符合 ps 行结构 → invalid-row
// 因此这里【不再】保留一个 `if (!line) return no-row` 守卫:它永远不可达,
// 只会制造「POSIX 也能产出 no-row」的错误印象。
function parsePosixRow(pid, run) {
    const line = String(run.stdout || '').trim();
    const tokens = line.split(/\s+/);
    if (tokens.length < 7) return unavailable('invalid-row', run);
    const ppid = Number(tokens[0]);
    if (!Number.isInteger(ppid)) return unavailable('invalid-row', run);
    const startedDate = new Date(tokens.slice(1, 6).join(' '));
    if (Number.isNaN(startedDate.getTime())) return unavailable('invalid-row', run);
    const commandLine = tokens.slice(6).join(' ');
    if (!commandLine) return unavailable('invalid-row', run);
    const first = commandLine.split(/\s+/)[0] || '';
    return {
        state: 'alive',
        snapshot: {
            alive: true,
            isNode: /node/i.test(path.basename(first)),
            commandLine,
            ppid,
            ppidAlive: pidAlive(ppid),
            startedAt: startedDate.toISOString(),
        },
    };
}

// 旧 snapshotFn seam 到结构化结果的适配(设计冻结的四条规则)。
// `timeout` 等真实分类【必须】经低层 executor seam 产生:旧 seam 不携带任何
// 可区分这些情形的信息,猜测就是编造。
function adaptLegacySnapshot(pid, snapshotFn) {
    let legacy;
    try {
        legacy = snapshotFn(pid);
    } catch (err) {
        return unavailable('invalid-row', EMPTY_RUN,
            `legacy snapshotFn threw: ${err && err.message ? String(err.message) : 'unknown'}`);
    }
    if (legacy && typeof legacy === 'object' && typeof legacy.state === 'string') return legacy;
    if (legacy && typeof legacy === 'object' && legacy.alive === true) return { state: 'alive', snapshot: legacy };
    if (legacy && typeof legacy === 'object' && legacy.alive === false) return { state: 'dead', snapshot: legacy };
    return unavailable('invalid-row', EMPTY_RUN, 'legacy snapshotFn returned null');
}

// 九步优先级,按序短路,穷尽且互斥。
function getProcessSnapshotResult(pid, seams = {}) {
    if (seams && typeof seams.snapshotFn === 'function') {
        return adaptLegacySnapshot(pid, seams.snapshotFn);
    }
    const isAlive = (seams && typeof seams.pidAliveFn === 'function') ? seams.pidAliveFn : pidAlive;
    // 1. 进程确认不存在 —— 在发出任何命令之前
    if (!isAlive(pid)) {
        return { state: 'dead', snapshot: { alive: false, isNode: null, commandLine: null, ppid: null, ppidAlive: null, startedAt: null } };
    }
    const execFn = (seams && typeof seams.execFileSyncFn === 'function') ? seams.execFileSyncFn : execFileSync;
    const { exe, args } = snapshotCommand(pid);
    const run = runSnapshotCommand(exe, args, { encoding: 'utf8', timeout: SNAPSHOT_TIMEOUT_MS }, execFn);

    // 2. 超时 —— ETIMEDOUT 是【唯一】判据。SIGTERM 单独不算:外部终止与子进程
    //    自身信号退出同样表现为 SIGTERM,而 timeout 是唯一能不打红 gate 的
    //    reason,把 SIGTERM 并进去等于悄悄扩大那条豁免。
    if (run.error && run.error.code === 'ETIMEDOUT') return unavailable('timeout', run);
    // 3. host 无法启动
    if (run.error && run.error.code === 'ENOENT') return unavailable('spawn-error', run);
    // 4. host 非零退出(含 SIGTERM 而无 ETIMEDOUT)
    if (run.error || run.status !== 0) return unavailable('nonzero-exit', run);
    // 5. 成功退出但 stdout 为空或只有空白
    if (!String(run.stdout || '').trim()) return unavailable('empty-output', run);
    // 6-9. 解析 / 空行 / 畸形行 / alive —— 由平台各自的解析层判定
    return process.platform === 'win32' ? parseWin32Row(pid, run) : parsePosixRow(pid, run);
}

// 兼容 wrapper:导出面行为不变。alive/dead 返回旧 snapshot,unavailable 返回
// null —— 既有调用方与测试对 `=== null` 的依赖原样保留。
function getProcessSnapshot(pid, seams = {}) {
    const result = getProcessSnapshotResult(pid, seams);
    return result.state === 'unavailable' ? null : result.snapshot;
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
    // [memory-lock-win-cim-snapshot-reliability] Phase 3A Task 3 —— 消费结构化
    // 结果以拿到 reason。**闸的语义逐字不变**:reason 只进入诊断文本,不为任何
    // 一条 kill 授权路径增加分支。
    const result = getProcessSnapshotResult(owner.pid, ctx.seams);
    const snapshot = result.state === 'unavailable' ? null : result.snapshot;
    // 闸①:已死 → 死持有者(无进程可杀,仅允许 CAS 清 stale owner)
    if (result.state === 'dead') {
        return {
            verdict: 'dead-holder', owner, snapshot, observedLeaseId: owner.leaseId,
            report: { ...base, reason: `holder pid ${owner.pid} 已退出,残留 stale owner(接管成功时将被原子覆盖,无需手动清理),可重试` },
        };
    }
    // 快照不可得(查询失败/权限不足/超时…)→ unknown。
    // 唯一的改进是把 reason 写进报告:同一句"无法确认"过去既可能是"这台机器
    // 慢",也可能是"命令写错了",运维看不出区别。
    if (result.state === 'unavailable') {
        return {
            verdict: 'unknown', owner, snapshot,
            report: { ...base, reason: `无法确认 pid ${owner.pid} 的进程身份(${result.reason};查询失败、超时或权限不足),绝不自动终止` },
        };
    }
    // 结构化结果为 alive 时字段已保证齐备;这一层保留为防御性检查,若未来
    // 有调用方注入了自造的 alive 快照,仍按不可确认处理。
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
            // 设计 §4.2:所有 live-foreign report 必须明示「不会自动终止该进程」。
            // 本分支原文写作「仅诊断不终止」—— 语义相近但不满足该用户可见合同,
            // 于是 T-lock-orphan-refusal-matrix case 3 在非 win32 上必然失败。
            report: { ...base, reason: `pid ${owner.pid}:unix 平台孤儿自愈默认关闭(孤儿被 init 接管,父进程判定不可靠),不会自动终止该进程,仅提供诊断` },
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

// 锁错误识别:Zvec 错误判定 + "Can't lock" message。识别失败宁可当非锁
// 错误 rethrow(设计 §6:非锁错误零干预)。
//
// [zvec-win-unicode-containment] Task 5 —— 本模块不再解析 @zvec/zvec。
// 这里原先在**每一次错误分类时**就地解析 native binding 并调用 isZVecError:
// 一个绕开判定层的 native 入口,而且发生在最不该再碰 native 的时刻 ——
// collection 打开失败之后。判定谓词改由调用方注入:调用方
// (ZvecMemoryIndex.initialize)此刻已在 SAFE 判定下持有 z,不需要第二次解析
// native 模块。
//
// 未注入谓词时的回退**镜像上游自身的定义** —— @zvec/zvec 的 isZVecError 判定
// 的是 `code` 以 'ZVEC_' 开头,不是错误名。原先的回退写作 /zvec/i.test(name),
// 在真实 zvec 错误上几乎必然为 false;它从前只在 require 失败(即 zvec 根本
// 不存在、也就不会有 zvec 错误)时才走到,所以这个缺陷一直没有暴露。把裸
// require 移除后该分支变成常规路径,必须先修正,否则「消除 require」会顺手
// 把锁诊断降级成裸 rethrow。
//
// 这是对上游契约的镜像而非猜测:真实并发矩阵测试用真实锁冲突同时验证注入
// 形式与回退形式并要求二者一致,上游改定义会红,而不是静默降级。
//
// 两个条件必须同时成立 —— 绝不因为消除 require 就把任意带 "can't lock" 的
// 普通错误当成 Zvec 锁错误,那会让非锁错误进入 backoff/诊断/自愈阶梯。
const LOCK_MESSAGE_RE = /can't lock/i;

function looksLikeZVecError(err) {
    return typeof err === 'object' && err !== null
        && typeof err.name === 'string'
        && typeof err.code === 'string' && err.code.startsWith('ZVEC_');
}

function isLockError(err, isZVecError) {
    if (!err) return false;
    let isZ;
    if (typeof isZVecError === 'function') {
        // 注入的谓词来自 native binding;它自身抛错时退回纯判定,
        // 而不是让错误分类把调用方的原始错误吞掉。
        try {
            isZ = Boolean(isZVecError(err));
        } catch (_) {
            isZ = looksLikeZVecError(err);
        }
    } else {
        isZ = looksLikeZVecError(err);
    }
    return isZ && LOCK_MESSAGE_RE.test(String(err.message || ''));
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
    // [memory-lock-win-cim-snapshot-reliability] Phase 3A Task 3 —— 同样消费
    // 结构化结果。这是**杀进程前的最后一次身份确认**,所以 reason 只用于把
    // 中止原因说清楚,绝不新增任何"可以杀"的分支:unavailable 一律中止。
    const recheckResult = getProcessSnapshotResult(owner.pid, ctx.seams);
    const recheck = recheckResult.state === 'unavailable' ? null : recheckResult.snapshot;
    if (recheckResult.state === 'dead') {
        // 诊断与自愈之间已自行退出 → 无进程可杀;owner 留给接管覆盖(P0-1)
    } else if (recheckResult.state === 'unavailable') {
        return { healed: false, reason: `自愈中止:pid ${owner.pid} 的身份在复核时无法确认(${recheckResult.reason}),绝不自动终止` };
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
    SNAPSHOT_TIMEOUT_MS,
    truncateStream,
    sanitizeStream,
    safeStreamSample,
    runSnapshotCommand,
    getProcessSnapshotResult,
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
    looksLikeZVecError,
    isLockError,
    attemptSelfHeal,
    openWithCoordination,
};
