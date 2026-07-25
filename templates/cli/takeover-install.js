'use strict';
// ATTP .claude/settings.json 事务化幂等 deep-merge installer。禁整文件覆盖;损坏 JSON fail-loud;安装前过闸。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { validateCapsule, CAPSULE_BUDGET_BYTES } = require('./takeover-payload');

const MANAGED_MARK = 'takeover-adapter.js';
const HOOK_COMMAND = 'node "$CLAUDE_PROJECT_DIR/.evo-lite/cli/takeover-adapter.js"';

function managedGroup(event) {
    const hooks = [{ type: 'command', command: HOOK_COMMAND }];
    return event === 'PreToolUse' ? { matcher: '*', hooks } : { hooks };
}
function managedFragment(events) { const o = {}; for (const e of events) o[e] = [managedGroup(e)]; return o; }
function isManagedGroup(g) {
    return Boolean(g && Array.isArray(g.hooks) && g.hooks.some(h => h && typeof h.command === 'string' && h.command.includes(MANAGED_MARK)));
}
function mergeHookConfig(existing, fragment) {
    const out = existing && typeof existing === 'object' ? JSON.parse(JSON.stringify(existing)) : {};
    out.hooks = out.hooks && typeof out.hooks === 'object' ? out.hooks : {};
    for (const ev of Object.keys(fragment)) {
        const arr = Array.isArray(out.hooks[ev]) ? out.hooks[ev] : [];
        out.hooks[ev] = [...arr.filter(g => !isManagedGroup(g)), ...fragment[ev]];
    }
    return out;
}

function readSettingsStrict(settingsPath, fsOps = fs) {
    if (!fsOps.existsSync(settingsPath)) return {};
    const raw = fsOps.readFileSync(settingsPath, 'utf8');
    try { return JSON.parse(raw); }
    catch (e) { throw new Error(`takeover: ${settingsPath} is corrupt JSON (${e.message}); leaving it unchanged`); }
}

const PROBE_INPUT = (projectRoot) => JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'probe', cwd: projectRoot });

// ① 二进制级:adapter 能被 node 执行,且产出【可被宿主摄入的】UserPromptSubmit envelope。
// 退出码 + 字符串包含已不足以判定 —— 失败路径现在也 exit 0(宿主契约),必须解析 envelope 与 capsule,
// 并把 takeover-degraded 视为运行时故障拒装(R5 复审 P0-1 配套)。
function probeAdapterBinary(projectRoot) {
    const adapter = path.join(projectRoot, '.evo-lite', 'cli', 'takeover-adapter.js');
    if (!fs.existsSync(adapter)) return { ok: false, reason: `adapter not found: ${adapter}` };
    const res = spawnSync(process.execPath, [adapter], { input: PROBE_INPUT(projectRoot), encoding: 'utf8', timeout: 20000 });
    if (res.status !== 0) return { ok: false, reason: `adapter exited ${res.status}: ${String(res.stderr || '').trim()}` };
    let envelope;
    try { envelope = JSON.parse(String(res.stdout || '').trim()); }
    catch (e) { return { ok: false, reason: `adapter stdout is not a single JSON object (${e.message})` }; }
    const hso = envelope && envelope.hookSpecificOutput;
    if (!hso || hso.hookEventName !== 'UserPromptSubmit' || typeof hso.additionalContext !== 'string') {
        return { ok: false, reason: 'adapter produced no UserPromptSubmit hook envelope' };
    }
    let capsule;
    try { capsule = JSON.parse(hso.additionalContext); }
    catch (e) { return { ok: false, reason: `adapter additionalContext is not a capsule (${e.message})` }; }
    // capsule 必须过【真正的 schema + 预算校验】—— 宿主会静默丢弃类型错字段,
    // `{evoLite:"takeover-stale"}` 这种残缺 capsule 不能算安装通过(R6 复审 P1-3)。
    const capVerdict = validateCapsule(capsule, CAPSULE_BUDGET_BYTES);
    if (!capVerdict.ok) return { ok: false, reason: `adapter capsule invalid (${capVerdict.errors.join(',')})` };
    if (capsule.evoLite === 'takeover-degraded') {
        return { ok: false, reason: `adapter reports a degraded runtime (${capsule.reason || 'unknown'}); fix the runtime before installing hooks` };
    }
    return { ok: true, reason: null };
}

// ② 形状级:命令原文是否结构正确 —— 静态、确定性、与本机 shell 无关,可安全作为安装闸。
function verifyHookCommandShape(command = HOOK_COMMAND) {
    if (typeof command !== 'string' || !command.includes(MANAGED_MARK)) {
        return { ok: false, reason: 'command does not reference the managed adapter' };
    }
    if (!/^node\s/.test(command)) return { ok: false, reason: 'command must invoke node' };
    if (!/"\$CLAUDE_PROJECT_DIR\/[^"]*takeover-adapter\.js"/.test(command)) {
        return { ok: false, reason: '$CLAUDE_PROJECT_DIR must sit inside double quotes (paths contain spaces)' };
    }
    return { ok: true, reason: null };
}

// ③ 命令级(诊断,【不作安装闸】):Claude Code 用 POSIX shell 执行 hook command;win32 上是 Git Bash,
//    不是 cmd.exe。Node 的 shell:true 会取本机 comspec,证明不了宿主行为,所以这里必须显式指定 shell。
function resolveHostShell(env = process.env) {
    const explicit = env.EVO_LITE_HOOK_SHELL || env.CLAUDE_CODE_GIT_BASH_PATH;
    if (explicit && fs.existsSync(explicit)) return { ok: true, shell: explicit };
    if (process.platform !== 'win32') return { ok: true, shell: '/bin/sh' };
    for (const c of ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']) {
        if (fs.existsSync(c)) return { ok: true, shell: c };
    }
    const where = spawnSync('where', ['bash'], { encoding: 'utf8' });
    const found = String(where.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
    if (found && fs.existsSync(found)) return { ok: true, shell: found };
    return { ok: false, reason: 'no POSIX shell found; cannot reproduce the Claude Code hook shell locally' };
}

// shell 不可发现 → skipped(仍 ok):本机 shell 差异不得导致误拒装。宿主 transport 的权威证据是 Step 9 dogfood。
function probeHookCommand(projectRoot, opts = {}) {
    const shape = verifyHookCommandShape(HOOK_COMMAND);
    if (!shape.ok) return { ok: false, skipped: false, reason: shape.reason };
    const binary = probeAdapterBinary(projectRoot);
    if (!binary.ok) return { ok: false, skipped: false, reason: binary.reason };
    const shellInfo = opts.shell ? { ok: true, shell: opts.shell } : (opts.resolveShell || resolveHostShell)();
    if (!shellInfo.ok) return { ok: true, skipped: true, reason: shellInfo.reason };
    // Node 在 win32 上仅当 shell basename 为 cmd.exe 时用 `/d /s /c`,否则用 `-c` —— 传 bash 路径即得 POSIX 语义。
    const res = spawnSync(HOOK_COMMAND, {
        shell: shellInfo.shell, input: PROBE_INPUT(projectRoot), encoding: 'utf8', timeout: 20000,
        env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot },
    });
    const where = ` under ${shellInfo.shell}`;
    if (res.error) return { ok: false, skipped: false, reason: `hook command failed to spawn${where}: ${res.error.message}` };
    if (res.status !== 0) return { ok: false, skipped: false, reason: `hook command exited ${res.status}${where}: ${String(res.stderr || '').trim()}` };
    if (!String(res.stdout || '').includes('hookSpecificOutput')) return { ok: false, skipped: false, reason: `hook command produced no hook envelope${where}` };
    return { ok: true, skipped: false, reason: null };
}

// ── settings 路径解析:必须绝对、且经【物理路径】绑定 canonical project root ──
// 字符串前缀只能挡字面逃逸。若 `project/.claude` 本身是指向项目外的 symlink/junction,
// 字面路径仍在项目内、实际写入却在项目外 —— 必须按 realpath 判定归属(R6 复审 P0-2)。
const normPath = (p) => {
    let r = String(p).replace(/\\/g, '/');
    if (process.platform === 'win32' && /^[a-z]:/.test(r)) r = r[0].toUpperCase() + r.slice(1);
    return r;
};
function realpathOrThrow(fsOps, target) {
    try { return fsOps.realpathSync(target); }
    catch (e) { throw new Error(`takeover: cannot resolve ${target} (${e.message}); refusing to touch settings`); }
}

// 受管对象【唯一】:<canonicalProjectRoot>/.claude/settings.json。
// 只做"项目内 + 名字含 marker"的校验不够 —— 被篡改的 manifest 仍能指向项目内任意文件,
// 让 restore 覆盖、让 discard 删除它(R7 复审 P0-2)。所以身份必须精确到单个文件。
const MANAGED_SETTINGS_RELATIVE = path.join('.claude', 'settings.json');
const MANIFEST_KIND = 'attp-settings-backup';
const MANIFEST_SCHEMA_VERSION = 1;
const BACKUP_NAME_RE = /^settings\.json\.attp-backup-\d+-[0-9a-f]{12}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

function managedSettingsPath(projectRoot, fsOps = fs) {
    return path.join(realpathOrThrow(fsOps, projectRoot), MANAGED_SETTINGS_RELATIVE);
}

// backup 必须是受管 settings 的【同目录兄弟】,且文件名精确匹配生成规则;
// 若该路径已存在且是链接,同样拒绝(否则 discard 会顺链删掉别的文件)。
function resolveManagedBackupPath(managedSettings, backupPathInput, fsOps = fs) {
    const abs = path.resolve(String(backupPathInput));
    if (normPath(path.dirname(abs)) !== normPath(path.dirname(managedSettings))) {
        throw new Error(`takeover: backup must be a sibling of the managed settings file; got ${abs}`);
    }
    if (!BACKUP_NAME_RE.test(path.basename(abs))) {
        throw new Error(`takeover: backup path does not follow the managed naming rule: ${abs}`);
    }
    // 链接判定用 lstat:断链 symlink 的 existsSync 为 false,用 exists 判会漏掉(与守卫同一规则)
    let st = null;
    try { st = fsOps.lstatSync(abs); }
    catch (e) { if (!e || e.code !== 'ENOENT') throw e; }
    if (st && st.isSymbolicLink()) {
        throw new Error(`takeover: backup path is a link; refusing to touch it: ${abs}`);
    }
    if (st && normPath(realpathOrThrow(fsOps, abs)) !== normPath(abs)) {
        throw new Error(`takeover: backup path does not resolve to itself; refusing to touch it: ${abs}`);
    }
    return abs;
}

// 返回【验证过的绝对物理路径】。存在则直接 realpath;不存在则解析最近存在祖先再拼回尾部。
// 损坏 symlink / realpath 失败 / 物理落点在项目外 / 不是那个受管文件 → 一律抛错,绝不写也绝不删。
function resolveManagedSettingsPath(projectRoot, settingsPath, fsOps = fs) {
    const canonRoot = normPath(realpathOrThrow(fsOps, projectRoot));
    const abs = path.isAbsolute(settingsPath) ? path.resolve(settingsPath) : path.resolve(projectRoot, settingsPath);
    let existing = abs;
    const tail = [];
    for (;;) {
        if (fsOps.existsSync(existing)) break;                 // existsSync 跟随链接
        let dangling = false;
        try { fsOps.lstatSync(existing); dangling = true; }    // 链接本身在、目标不在 = 损坏链接
        catch (_) { dangling = false; }
        if (dangling) throw new Error(`takeover: ${existing} is a broken link; refusing to touch settings`);
        const parent = path.dirname(existing);
        if (parent === existing) throw new Error(`takeover: no existing ancestor for ${abs}`);
        tail.unshift(path.basename(existing));
        existing = parent;
    }
    const physical = path.join(realpathOrThrow(fsOps, existing), ...tail);
    const target = normPath(physical);
    // 明确决定:MVP 只管项目内 settings。用户级(~/.claude/settings.json)超出范围,拒绝而非隐式处理。
    if (!(target === canonRoot || target.startsWith(canonRoot + '/'))) {
        throw new Error(`takeover: --settings resolves outside the project root (${canonRoot}); got ${physical}. User-level settings are out of MVP scope.`);
    }
    // 身份精确到单个受管文件:项目内的其他文件同样不得被本工具写入或删除。
    const managed = path.join(canonRoot, MANAGED_SETTINGS_RELATIVE);
    if (normPath(physical) !== normPath(managed)) {
        throw new Error(`takeover: only ${managed} is managed; got ${physical}`);
    }
    return managed;
}

// manifest 读取即再验证:损坏或被篡改的 manifest 不得让 rollback/discard 触碰项目外文件。
function readBackupManifest(projectRoot, fsOps = fs) {
    const manifestPath = backupManifestPath(projectRoot);
    if (!fsOps.existsSync(manifestPath)) return null;
    let raw;
    try { raw = JSON.parse(fsOps.readFileSync(manifestPath, 'utf8')); }
    catch (e) { throw new Error(`takeover: settings backup manifest is corrupt (${e.message}); refusing to touch settings`); }
    // 与写入侧同一个 validator:两边判定不一致就会出现"提交成功但恢复路径拒收"的 manifest
    if (!validateBackupManifestShape(raw)) {
        throw new Error('takeover: settings backup manifest failed schema validation; refusing to touch settings');
    }
    // settingsPath 必须【就是】那个受管文件 —— 项目内任意其他文件也不许被 restore 覆盖或被 discard 删除
    const settingsPath = resolveManagedSettingsPath(projectRoot, raw.settingsPath, fsOps);
    const backupPath = raw.existed ? resolveManagedBackupPath(settingsPath, raw.backupPath, fsOps) : null;
    return { ...raw, settingsPath, backupPath, manifestPath };
}

// ── settings 事务化备份/回滚 ──
function backupManifestPath(projectRoot) {
    return path.join(projectRoot, '.evo-lite', 'generated', 'takeover', 'settings-backup.json');
}
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// manifest 形状的【唯一】判定:写入侧(commitManifest)与消费侧(readBackupManifest)必须共用,
// 否则可能"提交成功"却发布出一份恢复路径拒收的 manifest —— 事务化备份就名存实亡(R9 复审 P0-2)。
function validateBackupManifestShape(raw) {
    return Boolean(raw && typeof raw === 'object' && !Array.isArray(raw)
        && raw.kind === MANIFEST_KIND && raw.schemaVersion === MANIFEST_SCHEMA_VERSION
        && typeof raw.settingsPath === 'string' && typeof raw.existed === 'boolean'
        && (raw.existed
            ? (typeof raw.backupPath === 'string' && typeof raw.sha256 === 'string' && SHA256_RE.test(raw.sha256))
            : (raw.backupPath === null && raw.sha256 === null)));
}
// 六个承重字段的规范化投影:回读比较用它,避免再手写字段清单而漏项
const manifestFingerprint = (m) => JSON.stringify([m.kind, m.schemaVersion, m.settingsPath, m.existed, m.backupPath, m.sha256]);

// manifest 也走"先写临时、回读校验、再 rename 提交":半写的 manifest 会同时挡住下一次 backup
// 和 rollback/discard(前者见 manifest 即拒,后者解析失败即拒),必须不留半成品(R8 复审 P1-3)。
function commitManifest(fsOps, manifestPath, manifest) {
    const tmp = `${manifestPath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
    try {
        fsOps.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
        const back = JSON.parse(fsOps.readFileSync(tmp, 'utf8'));            // 回读 + 解析验证
        if (!validateBackupManifestShape(back)) throw new Error('manifest read-back failed schema validation');
        if (manifestFingerprint(back) !== manifestFingerprint(manifest)) throw new Error('manifest read-back mismatch');
        fsOps.renameSync(tmp, manifestPath);                                  // 原子提交
    } catch (e) {
        let cleanupError = null;
        try { if (fsOps.existsSync(tmp)) fsOps.unlinkSync(tmp); }
        catch (e2) { cleanupError = e2; }                                     // 清理失败不得静默(R9 复审 P1-1)
        if (cleanupError) {
            throw new AggregateError([e, cleanupError],
                `takeover: settings backup manifest not committed; orphaned temp manifest may remain at ${tmp}`);
        }
        throw new Error(`takeover: settings backup manifest not committed (${e.message})`);
    }
}

// 原文件存在却备份失败(写失败/回读不一致)→ 抛。绝不"以为有备份"就继续安装。
function backupSettings(settingsPathInput, { projectRoot, fsOps = fs } = {}) {
    const settingsPath = resolveManagedSettingsPath(projectRoot, settingsPathInput, fsOps); // 物理验证后的绝对路径
    const manifestPath = backupManifestPath(projectRoot);
    if (fsOps.existsSync(manifestPath)) {
        throw new Error(`takeover: a settings backup manifest already exists (${manifestPath}); resolve it before installing`);
    }
    fsOps.mkdirSync(path.dirname(manifestPath), { recursive: true });
    let manifest;
    if (!fsOps.existsSync(settingsPath)) {
        manifest = { kind: MANIFEST_KIND, schemaVersion: MANIFEST_SCHEMA_VERSION,
            settingsPath, existed: false, backupPath: null, sha256: null };
    } else {
        const original = fsOps.readFileSync(settingsPath);                       // Buffer:按字节,不经编码转换
        const backupPath = `${settingsPath}.attp-backup-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
        // 备份未提交(manifest 未写成)前的任何失败都要清掉半成品 —— 否则会在用户仓库里
        // 遗留一份含 settings 原始内容的孤儿副本(R7 复审 P1-2)。
        // 保留传入错误的【结构】:commitManifest 可能已抛 AggregateError([commitError, tempCleanupError]),
        // 若在这里统一压成 new Error(message),公开 API backupSettings 的调用者就拿不到 errors[](R10 复审 P1-1)。
        const abortBackup = (err) => {
            const errors = err instanceof AggregateError ? [...err.errors] : [err];
            let orphan = '';
            try { if (fsOps.existsSync(backupPath)) fsOps.unlinkSync(backupPath); }
            catch (e2) { errors.push(e2); orphan += `; orphaned backup may remain at ${backupPath}`; }
            // rename 提交前 manifest 不该出现;万一出现也如实报告路径供人工处理
            try { if (fsOps.existsSync(manifestPath)) orphan += `; stray manifest may remain at ${manifestPath}`; }
            catch (_) { /* ignore */ }
            if (err instanceof AggregateError || errors.length > 1) {
                throw new AggregateError(errors, `${err.message}${orphan}`);
            }
            throw new Error(`${err.message}${orphan}`, { cause: err });
        };
        try {
            fsOps.writeFileSync(backupPath, original);
            let readback;
            try { readback = fsOps.readFileSync(backupPath); }
            catch (e) { throw new Error(`takeover: settings backup unreadable after write (${e.message}); refusing to install`); }
            if (!Buffer.isBuffer(readback) || !readback.equals(original)) {
                throw new Error('takeover: settings backup does not match the original bytes; refusing to install');
            }
        } catch (e) { abortBackup(e); }
        manifest = { kind: MANIFEST_KIND, schemaVersion: MANIFEST_SCHEMA_VERSION,
            settingsPath, existed: true, backupPath, sha256: sha256(original) };
        try { commitManifest(fsOps, manifestPath, manifest); }
        catch (e) { abortBackup(e); }                                            // manifest 未提交 → 备份也不留
        return { ...manifest, manifestPath };
    }
    commitManifest(fsOps, manifestPath, manifest);                               // 无原文件:仍走同一提交路径
    return { ...manifest, manifestPath };
}

function restoreSettings({ projectRoot, fsOps = fs } = {}) {
    const manifest = readBackupManifest(projectRoot, fsOps);   // schema + 物理归属再验证,失败即抛
    if (manifest === null) throw new Error(`takeover: no settings backup manifest at ${backupManifestPath(projectRoot)}`);
    if (manifest.existed) {
        const bytes = fsOps.readFileSync(manifest.backupPath);
        if (sha256(bytes) !== manifest.sha256) throw new Error('takeover: backup bytes do not match the recorded digest; not restoring');
        fsOps.writeFileSync(manifest.settingsPath, bytes);                       // 恢复原始字节
        fsOps.unlinkSync(manifest.backupPath);
    } else if (fsOps.existsSync(manifest.settingsPath)) {
        fsOps.unlinkSync(manifest.settingsPath);                                 // 原本不存在 → 才允许删除
    }
    fsOps.unlinkSync(manifest.manifestPath);
    return { restored: manifest.existed ? 'original-bytes' : 'removed-new-file' };
}

// backup 清理:阶段门通过后调用。只删已验证存在的备份文件与 manifest,不触碰当前 settings。
function discardBackup({ projectRoot, fsOps = fs } = {}) {
    const manifest = readBackupManifest(projectRoot, fsOps);   // 同样再验证:篡改的 manifest 不得删项目外文件
    if (manifest === null) return { discarded: false };
    if (manifest.existed && fsOps.existsSync(manifest.backupPath)) fsOps.unlinkSync(manifest.backupPath);
    fsOps.unlinkSync(manifest.manifestPath);
    return { discarded: true };
}

function installWithBackup(settingsPath, { events, projectRoot, fsOps = fs }) {
    const backup = backupSettings(settingsPath, { projectRoot, fsOps });          // 失败即抛,install 根本不会跑
    try { return { ...installTakeoverHooks(settingsPath, { events, projectRoot, fsOps }), backup }; }
    catch (e) {
        try { restoreSettings({ projectRoot, fsOps }); }
        catch (restoreError) {   // 回滚也失败:两个错误都要留下,否则原始安装错误被覆盖(R5 复审 P1-2)
            throw new AggregateError([e, restoreError],
                `takeover install failed AND rollback failed; restore manually from ${backup.manifestPath}`);
        }
        throw e;
    }
}

function installTakeoverHooks(settingsPathInput, { events, projectRoot, fsOps = fs }) {
    const settingsPath = resolveManagedSettingsPath(projectRoot, settingsPathInput, fsOps); // 物理边界内的绝对路径
    const existing = readSettingsStrict(settingsPath, fsOps);     // 损坏 → 抛,原文件不动
    // 安装闸只用与 shell 无关的两项:命令形状 + adapter 可执行。命令级 probe 是诊断,不参与放行判定。
    const shape = verifyHookCommandShape(HOOK_COMMAND);
    if (!shape.ok) throw new Error(`takeover install: hook command shape invalid (${shape.reason}); settings unchanged`);
    const binary = probeAdapterBinary(projectRoot);
    if (!binary.ok) throw new Error(`takeover install: adapter probe failed (${binary.reason}); settings unchanged`);
    const before = JSON.stringify(existing);
    const merged = mergeHookConfig(existing, managedFragment(events));
    const serialized = JSON.stringify(merged, null, 2) + '\n';
    fsOps.mkdirSync(path.dirname(settingsPath), { recursive: true });
    // 临时文件含【合并后的完整 settings】(可能带用户原有敏感字段),rename 失败必须清理,
    // 否则会永久残留在仓库里,且不在 .gitignore 覆盖范围内(R10 复审 P1-2)。
    const tmp = `${settingsPath}.evo-tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
    try {
        fsOps.writeFileSync(tmp, serialized, 'utf8');
        fsOps.renameSync(tmp, settingsPath);                       // 原子替换;此后不得再有可失败的业务操作
    } catch (installError) {
        let cleanupError = null;
        try { if (fsOps.existsSync(tmp)) fsOps.unlinkSync(tmp); }
        catch (e) { cleanupError = e; }
        if (cleanupError) {
            throw new AggregateError([installError, cleanupError],
                `takeover install failed; orphaned temporary settings may remain at ${tmp}`);
        }
        throw installError;
    }
    return { changed: JSON.stringify(merged) !== before };
}

function statusTakeoverHooks(settingsPathInput, events, projectRoot) {
    // projectRoot 给出时同样做物理解析(子目录下 status 才不会读错文件);测试可省略
    const settingsPath = projectRoot ? resolveManagedSettingsPath(projectRoot, settingsPathInput) : settingsPathInput;
    const cfg = readSettingsStrict(settingsPath);                  // 损坏 → 抛(不误报 all-missing)
    const hooks = cfg.hooks || {};
    const installed = [], missing = [];
    for (const ev of events) {
        (Array.isArray(hooks[ev]) && hooks[ev].some(isManagedGroup) ? installed : missing).push(ev);
    }
    return { installed, missing };
}

module.exports = { MANAGED_MARK, HOOK_COMMAND, managedGroup, managedFragment, isManagedGroup,
    mergeHookConfig, verifyHookCommandShape, probeAdapterBinary, resolveHostShell, probeHookCommand,
    MANAGED_SETTINGS_RELATIVE, managedSettingsPath, resolveManagedSettingsPath, resolveManagedBackupPath,
    backupManifestPath, validateBackupManifestShape, readBackupManifest, backupSettings, restoreSettings,
    discardBackup, installWithBackup, installTakeoverHooks, statusTakeoverHooks };
