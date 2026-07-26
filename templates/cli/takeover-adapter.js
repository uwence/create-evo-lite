'use strict';
// ATTP Claude Code 生命周期 adapter + 两条 transport。顶部只载 receipt + payload;collector lazy(不变量6)。
const fs = require('fs');
const path = require('path');
const rc = require('./takeover-receipt');
const { buildTakeoverPayload, buildEmergencyCapsule, validateSessionPayload, validateCapsule,
    CAPSULE_BUDGET_BYTES } = require('./takeover-payload');
const HOST = 'claude-code';

function bashSingleQuote(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

// 恢复命令必须带当前 sessionId —— runReceiptRecovery 缺 --session-id 会直接抛 Usage 错误,
// 一条跑不通的命令等于没有恢复路径。拿不到合法 sessionId → 返回 null,由 recoveryText 如实说明(R5 复审 P0-2)。
function buildRecoveryCommand(projectRoot, sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) return null;
    const cli = bashSingleQuote(`${projectRoot}/.evo-lite/cli/memory.js`);
    return `node ${cli} bootstrap --receipt --host ${HOST} --session-id ${bashSingleQuote(sessionId)} --source manual-recovery --json`;
}
// 项目根不可知时的相对路径版(同样必带 sessionId)
function buildGenericRecoveryCommand(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) return null;
    return `node .evo-lite/cli/memory.js bootstrap --receipt --host ${HOST} --session-id ${bashSingleQuote(sessionId)} --source manual-recovery --json`;
}
function recoveryText(cmd) {
    return cmd ? `Recover: ${cmd}`
        : 'Cannot auto-recover: no session id in the hook input. Restart the Claude Code session.';
}

// ── 同步完整写入:循环处理 partial write,确认全部 UTF-8 字节送出;零进展即抛(不死循环)──
function writeAllSync(fd, text, writeSync = fs.writeSync) {
    const buf = Buffer.from(String(text), 'utf8');
    let off = 0;
    while (off < buf.length) {
        const written = writeSync(fd, buf, off, buf.length - off);
        if (!Number.isInteger(written) || written <= 0) throw new Error('stdout write made no progress');
        off += written;
    }
}

// 错误报告与业务输出用同一套同步完整写入语义:进程可能在写完前 process.exit(),
// process.stderr.write 的异步缓冲会丢失本该显式暴露的失败原因(R4 复审 P1-3)。
function reportError(msg) {
    try { writeAllSync(2, `${msg}\n`); } catch (_) { /* stderr 不可写时不得再抛,交由退出码承载 */ }
}

function runTransport(serialize, publish, write) {
    let serialized;
    try { serialized = serialize(); }
    catch (e) { reportError(`evo-lite takeover: serialize failed: ${e.message}`); return { exitCode: 1, error: `serialize: ${e.message}` }; }
    try { write(serialized); }
    catch (e) { reportError(`evo-lite takeover: delivery failed: ${e.message}`); return { exitCode: 1, error: `write: ${e.message}` }; }
    if (typeof publish === 'function') {
        try { publish(); }
        catch (e) { reportError(`evo-lite takeover: receipt publish failed: ${e.message}`); return { exitCode: 1, error: `publish: ${e.message}` }; }
    }
    return { exitCode: 0 };
}

// canonicalization(discover + realpath)失败不得抛到 main —— 各 handler 自行给出 fail-closed 结果。
function resolveRoot(deps) {
    try { return { ok: true, root: rc.canonicalProjectRoot(deps.projectRoot) }; }
    catch (e) { return { ok: false, error: e.message }; }
}

function executeHookTransport(json, publish, opts = {}) {
    const write = opts.write || ((s) => writeAllSync(1, s));
    return runTransport(() => JSON.stringify(json || {}), publish, write);
}
function executeCliRecoveryTransport(text, publish, opts = {}) {
    const write = opts.write || ((s) => writeAllSync(1, s + '\n'));
    return runTransport(() => String(text), publish, write);
}

async function handleSessionStart(input, deps) {
    const rootRes = resolveRoot(deps);
    if (!rootRes.ok) { // 根不可 canonicalize:不发布、注入 degraded 说明 —— 但【exit 0】,否则宿主会丢弃这段上下文
        return { json: { hookSpecificOutput: { hookEventName: 'SessionStart',
            additionalContext: `[evo-lite] takeover FAILED: ${rootRes.error}. Run from the project root — ${recoveryText(buildGenericRecoveryCommand(input.session_id))}` },
            systemMessage: `evo-lite takeover root canonicalization failed: ${rootRes.error}` },
            exitCode: 0, publish: null, failure: `root: ${rootRes.error}` };
    }
    const projectRoot = rootRes.root;
    const sessionId = input.session_id;
    const sourceEvent = `SessionStart:${input.source || 'startup'}`;
    const existing = rc.readReceipt(projectRoot, HOST, sessionId);
    const focus = rc.readFocusAnchor(projectRoot);
    const recoveryCmd = buildRecoveryCommand(projectRoot, sessionId);
    const recovery = recoveryText(recoveryCmd);

    // 所有 SessionStart 失败共用:注入 degraded 说明 + systemMessage + 不发布 receipt + failure 标记,
    // 但【exitCode 恒 0】—— 非零会让宿主直接丢弃这段 additionalContext,失败反而变静默(R5 复审 P0-1)。
    const ssFailure = (contextText, sysMsg, failure) => ({
        json: { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: contextText },
            systemMessage: sysMsg },
        exitCode: 0, publish: null, failure,
    });

    // 无合法 sessionId → 不得谎称可自动恢复(与 buildRecoveryCommand/buildGenericRecoveryCommand 的
    // null 语义一致);缺此前置检查会让 sessionId 为空时静默走成功路径,recovery 文案永远无法送达。
    if (typeof sessionId !== 'string' || !sessionId) {
        return ssFailure(`[evo-lite] takeover FAILED: missing session id. ${recovery}`,
            'evo-lite takeover failed: missing session id', 'missing-session-id');
    }

    if (focus === null) { // 不可恢复:degraded,失效已有 committed,不发布
        if (existing.state === 'committed') rc.invalidateReceipt(projectRoot, HOST, sessionId, 'active-context-unreadable');
        return ssFailure(`[evo-lite] takeover DEGRADED (active_context unreadable). ${recovery}`,
            'evo-lite takeover degraded: active_context unreadable', 'active-context-unreadable');
    }

    const base = { host: HOST, sessionId, projectRoot, sourceEvent, focus: focus.text, focusHash: focus.hash,
        generatedAt: new Date().toISOString() };
    let context;
    try {
        context = deps.collect ? await deps.collect(base)
            : await require('./takeover-session').collectSessionTakeoverContextFull(base);
    } catch (e) {
        return ssFailure(`[evo-lite] takeover FAILED: ${e.message}. ${recovery}`,
            `evo-lite takeover collector failed: ${e.message}`, `collect: ${e.message}`);
    }
    const build = deps.buildPayload || buildTakeoverPayload;
    const validate = deps.validate || validateSessionPayload;
    let payload;
    try { payload = build(context); }
    catch (e) { // builder 抛错也须给出可执行恢复命令(不落到 main 的通用错误)
        return ssFailure(`[evo-lite] takeover payload build failed: ${e.message}. ${recovery}`,
            `evo-lite takeover build failed: ${e.message}`, `build: ${e.message}`);
    }
    const verdict = validate(payload);
    if (!verdict.ok) { // 校验不过 → 不发布 receipt
        return ssFailure(`[evo-lite] takeover payload invalid (${verdict.errors.join(',')}). ${recovery}`,
            'evo-lite takeover payload validation failed', `invalid: ${verdict.errors.join(',')}`);
    }
    const publish = () => rc.publishReceipt(projectRoot, { schemaVersion: rc.RECEIPT_SCHEMA_VERSION, host: HOST,
        sessionId, projectRoot: rc.canonicalProjectRoot(projectRoot), state: 'committed', focusHash: focus.hash,
        payloadHash: null, generatedAt: base.generatedAt, sourceEvent });
    void existing; // establishment 与 refresh 都刷新 receipt;差异仅诊断
    return { json: { hookSpecificOutput: { hookEventName: 'SessionStart',
        additionalContext: `[evo-lite takeover] ${JSON.stringify(payload)}` } }, exitCode: 0, publish, failure: null };
}

// 每轮 capsule 也必须经 validateCapsule —— probe 已确认宿主会【静默丢弃】类型错的字段,
// 无效 capsule 等于静默失去再播种能力。任何失败路径都输出 buildEmergencyCapsule 的结果:
// 恒是预算内、经校验的 JSON capsule。【禁止】退回未预算的普通文本(R4 复审 P0-1)。
// 【exitCode 恒 0】:非零时宿主根本不解析这段 JSON,精心构造的 emergency capsule 会被整体丢弃(R5 复审 P0-1)。
// 失败由 capsule 的 takeover-degraded + systemMessage + failure 标记 + stderr 承载,不由退出码承载。
function emergencyResult(parts) {
    const { projectName, focusHash, recoveryAction, reason } = parts;
    const em = buildEmergencyCapsule({ projectName, focusHash, recoveryAction, reason }, CAPSULE_BUDGET_BYTES);
    const json = { hookSpecificOutput: { hookEventName: 'UserPromptSubmit',
        additionalContext: JSON.stringify(em.capsule) } };
    // action 装不下时,完整恢复命令走 systemMessage(不计入 capsule 预算)
    json.systemMessage = em.systemMessage || `evo-lite takeover capsule degraded: ${reason}`;
    return { json, exitCode: 0, publish: null, failure: reason };   // stderr 由 main 统一报告,避免重复写
}

function handleUserPromptSubmit(input, deps) {
    const sessionId = input.session_id;
    const rootRes = resolveRoot(deps);
    if (!rootRes.ok) {
        return emergencyResult({ projectName: null, focusHash: null,
            recoveryAction: buildGenericRecoveryCommand(sessionId), reason: `root-canonicalization-failed: ${rootRes.error}` });
    }
    const projectRoot = rootRes.root;
    const projectName = path.basename(projectRoot);
    const recoveryCmd = buildRecoveryCommand(projectRoot, sessionId);   // 原始命令(进 capsule.action),非文案
    const build = deps.buildPayload || buildTakeoverPayload;
    const validate = deps.validateCapsule || validateCapsule;

    let verdict = null, focus = null, capsule = null, failure = null;
    try {
        ({ verdict, focus } = rc.reconcile({ projectRoot, host: HOST, sessionId }));
        // 说明:reconcile 判 degraded 属【治理状态】而非 handler 故障 —— failure 保持 null,
        // 诊断由 degraded capsule + 下面的 systemMessage 承担,守卫另行 fail-closed。
    } catch (e) {
        return emergencyResult({ projectName, focusHash: null, recoveryAction: recoveryCmd, reason: `reconcile: ${e.message}` });
    }
    try {
        capsule = build({ kind: 'refresh', host: HOST, sessionId, projectRoot, projectName,
            sourceEvent: 'UserPromptSubmit', focus: focus ? focus.text : null,
            focusHash: focus ? focus.hash : null, receiptVerdict: verdict, recoveryAction: recoveryCmd }, CAPSULE_BUDGET_BYTES);
    } catch (e) { failure = `build: ${e.message}`; }
    if (!failure) {
        const capVerdict = validate(capsule, CAPSULE_BUDGET_BYTES);
        if (!capVerdict.ok) failure = `invalid: ${capVerdict.errors.join(',')}`;
    }
    if (failure) {
        return emergencyResult({ projectName, focusHash: focus ? focus.hash : null,
            recoveryAction: recoveryCmd, reason: failure });
    }
    const json = { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: JSON.stringify(capsule) } };
    if (verdict.transition === 'degraded' || verdict.transition === 'stale') {
        json.systemMessage = `evo-lite takeover ${verdict.transition}${verdict.reason ? `: ${verdict.reason}` : ''}`;
    }
    return { json, exitCode: 0, publish: null, failure: null };
}

const READONLY_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const GUARDED_WRITE_TOOLS = new Set(['Edit', 'Write']); // MVP:NotebookEdit 待 probe 证明工具名+输入 schema

function ptu(decision, reason) {
    const hookSpecificOutput = { hookEventName: 'PreToolUse', permissionDecision: decision };
    if (reason) hookSpecificOutput.permissionDecisionReason = reason;
    return { json: { hookSpecificOutput }, exitCode: 0, publish: null };
}

// 守卫【任何】抛错都必须落在 deny 上:PreToolUse 输出里没有 permissionDecision 等于放行,
// 抛到 main 的通用错误路径就是 fail-open(R4 复审 P0-2 ④)。
function handlePreToolUse(input, deps) {
    const tool = input.tool_name;
    if (READONLY_TOOLS.has(tool) || tool === 'Bash') return ptu('allow');
    if (!GUARDED_WRITE_TOOLS.has(tool)) return ptu('allow');
    try { return guardWrite(input, deps); }
    catch (e) {
        const hint = recoveryText(buildGenericRecoveryCommand(input && input.session_id));
        return ptu('deny', `[evo-lite] takeover guard failed (${e.message}); refusing write. Run from the project root — ${hint}`);
    }
}

function guardWrite(input, deps) {
    const rootRes = resolveRoot(deps);   // canonicalization(含 realpath)失败 → deny
    if (!rootRes.ok) {
        return ptu('deny', `[evo-lite] cannot canonicalize the project root (${rootRes.error}); refusing write. Run from the project root — ${recoveryText(buildGenericRecoveryCommand(input.session_id))}`);
    }
    const projectRoot = rootRes.root;
    const sessionId = input.session_id;
    const recovery = recoveryText(buildRecoveryCommand(projectRoot, sessionId));

    // (a) committed receipt
    if (rc.readReceipt(projectRoot, HOST, sessionId).state !== 'committed') {
        return ptu('deny', `[evo-lite] takeover required before writing. ${recovery}`);
    }
    // (b) active_context 可读 + reconcile 非 degraded
    const { verdict, focus } = rc.reconcile({ projectRoot, host: HOST, sessionId });
    if (verdict.transition === 'degraded' || verdict.state !== 'committed') {
        return ptu('deny', `[evo-lite] takeover unhealthy (${verdict.reason || verdict.transition}). ${recovery}`);
    }
    // (b2) 构建 refresh capsule → validateCapsule → 字节预算
    const build = deps.buildPayload || buildTakeoverPayload;
    let capsule;
    try {
        capsule = build({ kind: 'refresh', host: HOST, sessionId, projectRoot, projectName: path.basename(projectRoot),
            sourceEvent: 'PreToolUse', focus: focus.text, focusHash: focus.hash,
            receiptVerdict: verdict, recoveryAction: recovery }, CAPSULE_BUDGET_BYTES);
    } catch (e) { return ptu('deny', `[evo-lite] takeover payload build failed (${e.message}). ${recovery}`); }
    const capVerdict = validateCapsule(capsule, CAPSULE_BUDGET_BYTES);
    if (!capVerdict.ok) return ptu('deny', `[evo-lite] takeover payload invalid (${capVerdict.errors.join(',')}). ${recovery}`);

    // (c) target-path fail-closed
    const ti = input.tool_input;
    const target = ti && typeof ti === 'object' ? ti.file_path : null;
    if (!target || typeof target !== 'string') {
        return ptu('deny', `[evo-lite] cannot determine target path; refusing write. ${recovery}`);
    }
    const abs = path.isAbsolute(target) ? target : path.resolve(projectRoot, target);
    // 向上找最近【条目存在】的一层。注意用 lstat 而非 exists:断链 symlink 的 exists 为 false,
    // 若按"还没建的文件"跳过它退到父目录,守卫就会放行,而 Write 会沿链接写到项目外(R7 复审 P0-1)。
    let probe = abs;
    for (;;) {
        let info;
        try { info = rc.pathEntryInfo(probe); }
        catch (e) { return ptu('deny', `[evo-lite] cannot stat '${probe}' (${e.message}); refusing write.`); }
        if (info.exists) break;                      // 含"存在的链接",下面必须物理解析它
        const parent = path.dirname(probe);
        if (parent === probe) return ptu('deny', `[evo-lite] no existing ancestor for '${target}'; refusing write.`);
        probe = parent;
    }
    // 最近存在条目的 realpath 失败(权限/断链/不可解析 junction)→ deny。
    // 未经解析的字符串做 containment 判断,正是 symlink 逃逸能绕过守卫的原因(R4 复审 P0-2 ③)。
    try { probe = rc.realpathStrict(probe); }
    catch (e) { return ptu('deny', `[evo-lite] cannot resolve target '${target}' (${e.message}); refusing write.`); }
    const cp = probe.replace(/\\/g, '/'), cr = projectRoot.replace(/\\/g, '/');
    if (!(cp === cr || cp.startsWith(cr + '/'))) {
        return ptu('deny', `[evo-lite] target '${target}' resolves outside project '${projectRoot}'.`);
    }
    return ptu('allow');
}

async function handleHookInput(input, deps = {}) {
    switch (input && input.hook_event_name) {
        case 'SessionStart': return handleSessionStart(input, deps);
        case 'UserPromptSubmit': return handleUserPromptSubmit(input, deps);
        case 'PreToolUse': return handlePreToolUse(input, deps);
        default: return { json: {}, exitCode: 0, publish: null, failure: null };
    }
}

function main() {
    let raw = '';
    process.stdin.on('data', d => raw += d).on('end', async () => {
        let input = {}; try { input = JSON.parse(raw); } catch (_) {}
        let out;
        try { out = await handleHookInput(input, {}); }
        catch (e) { // handler 兜底:仍输出 envelope 并 exit 0(非零会让 systemMessage 也失效)
            out = { json: { systemMessage: `evo-lite takeover error: ${e.message}` }, exitCode: 0, publish: null, failure: e.message };
        }
        // 单一诊断出口:所有 handler 的 failure 在此统一落 stderr(handler 内不重复写)
        if (out.failure) reportError(`evo-lite takeover: ${out.failure}`);
        // 退出码只反映 transport 结果:序列化/写出/发布失败才非零(此时 JSON 本就没送达或不可信)
        const res = executeHookTransport(out.json, out.publish);
        process.exit(res.exitCode || out.exitCode || 0);
    });
}

if (require.main === module) main();
module.exports = { handleHookInput, executeHookTransport, executeCliRecoveryTransport, writeAllSync,
    reportError, resolveRoot, buildRecoveryCommand, buildGenericRecoveryCommand };
