'use strict';

// provider:native-lite — the zero-dependency fallback CodePerceptionProvider.
// Answers FILE-level questions from git + Architecture IR + Planning IR with
// hard filesystem-safety invariants and fixed resource budgets. It NEVER
// fabricates a symbol graph (no search / callers / callees / impact / explore).
//
// Security-critical invariants (do NOT weaken):
//   * NEVER process.cwd(): every method reads context.projectRoot (absolute)
//     and passes it as the git cwd and as the IR path root.
//   * Realpath containment BEFORE any read/hash: resolve abs under projectRoot,
//     lstat it; any symlink OR a realpath that escapes the workspace realpath is
//     excluded with a diagnostic and never read. Read/hash only via the verified
//     realpath.
//   * No silent truncation: exceeding a byte/file budget always emits a
//     diagnostic naming what was skipped — never a quietly "complete" result.
//   * Never throw: git failure / missing IR / malformed JSON / bad path all
//     degrade to diagnostics + a best-effort result.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { FRESHNESS, DIRTY, COMPAT, INDEX, CAPABILITY_KEYS } = require('./provider-contract');
const { normalizeReference } = require('./normalize');

const PROVIDER_ID = 'provider:native-lite';
const PROVIDER_NAME = 'Native Lite';
const ADAPTER_VERSION = '0.1.0';

// Fixed resource budgets (verbatim — do NOT invent alternates).
const MAX_FILE_BYTES = 1 * 1024 * 1024;         // 1 MiB per-file read/hash cap
const MAX_TOTAL_HASH_BYTES = 32 * 1024 * 1024;  // 32 MiB cumulative hash cap
const MAX_FILES = 10000;                        // max files enumerated
const CONTENT_HASH = 'sha256';
const BINARY_SNIFF_BYTES = 8 * 1024;            // first 8 KiB scanned for NUL

const ARCH_IR_REL = ['.evo-lite', 'generated', 'architecture', 'architecture-ir.json'];
const PLAN_IR_REL = ['.evo-lite', 'generated', 'planning', 'plan-ir.json'];

function diag(code, message) {
    return { code, message: message || code };
}

function errText(err) {
    return err && err.message ? String(err.message) : String(err);
}

function buildCapabilities() {
    const caps = {};
    for (const key of CAPABILITY_KEYS) {
        caps[key] = false;
    }
    // Native Lite answers file/module listing and file source only. Everything
    // symbol-graph shaped stays false — it never fabricates a symbol graph.
    caps.files = true;
    caps.source = true;
    caps.modules = true;
    return caps;
}

// True iff `childReal` is `rootReal` itself or strictly beneath it. Both inputs
// MUST already be realpath-resolved so no unresolved symlink can smuggle a path
// outside the workspace past this check.
function isContained(rootReal, childReal) {
    if (childReal === rootReal) {
        return true;
    }
    return childReal.startsWith(rootReal + path.sep);
}

// Resolve `rel` under the workspace and enforce the fs-safety invariants BEFORE
// any read/hash. Returns { safe:true, realpath } for a real, contained,
// non-symlink path; otherwise { safe:false, code, message }. Never throws.
function resolveSafe(projectRoot, projectRootReal, rel) {
    const abs = path.resolve(projectRoot, rel);
    let lst;
    try {
        lst = fs.lstatSync(abs);
    } catch (err) {
        return { safe: false, code: 'path-unresolved', message: `${rel}: ${errText(err)}` };
    }
    // Any symlink is refused outright — we never follow a link out of (or even
    // within) the workspace.
    if (lst.isSymbolicLink()) {
        return { safe: false, code: 'symlink-escape', message: `${rel} is a symlink; excluded (never followed)` };
    }
    let real;
    try {
        real = fs.realpathSync(abs);
    } catch (err) {
        return { safe: false, code: 'path-unresolved', message: `${rel}: ${errText(err)}` };
    }
    if (!isContained(projectRootReal, real)) {
        return { safe: false, code: 'symlink-escape', message: `${rel} resolves outside the workspace; excluded` };
    }
    return { safe: true, realpath: real };
}

function gitLines(projectRoot, args) {
    const out = execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' });
    return out.split('\n').map(s => s.trim()).filter(Boolean);
}

function readArchMap(projectRoot, diagnostics) {
    const map = new Map();
    const p = path.join(projectRoot, ...ARCH_IR_REL);
    let raw;
    try {
        if (!fs.existsSync(p)) {
            return map;
        }
        raw = fs.readFileSync(p, 'utf8');
    } catch (err) {
        diagnostics.push(diag('architecture-ir-unavailable', errText(err)));
        return map;
    }
    try {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.files)) {
            for (const f of parsed.files) {
                if (f && typeof f.path === 'string') {
                    map.set(f.path, typeof f.module === 'string' ? f.module : null);
                }
            }
        }
    } catch (err) {
        diagnostics.push(diag('architecture-ir-unavailable', `malformed architecture-ir.json: ${errText(err)}`));
    }
    return map;
}

function readPlanMap(projectRoot, diagnostics) {
    const map = new Map();
    const p = path.join(projectRoot, ...PLAN_IR_REL);
    let raw;
    try {
        if (!fs.existsSync(p)) {
            return map;
        }
        raw = fs.readFileSync(p, 'utf8');
    } catch (err) {
        diagnostics.push(diag('planning-ir-unavailable', errText(err)));
        return map;
    }
    try {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.tasks)) {
            for (const t of parsed.tasks) {
                if (!t || typeof t.id !== 'string' || !Array.isArray(t.linkedFiles)) {
                    continue;
                }
                for (const lf of t.linkedFiles) {
                    if (typeof lf !== 'string') {
                        continue;
                    }
                    if (!map.has(lf)) {
                        map.set(lf, []);
                    }
                    map.get(lf).push(t.id);
                }
            }
        }
    } catch (err) {
        diagnostics.push(diag('planning-ir-unavailable', `malformed plan-ir.json: ${errText(err)}`));
    }
    return map;
}

function check(context) {
    // Native Lite needs no index and no external tool: the working tree is the
    // source of truth. Must never throw.
    void context;
    return {
        available: true,
        ready: true,
        installed: true,
        indexState: INDEX.NOT_REQUIRED,
    };
}

function getStatus(context) {
    const projectRoot = context && context.projectRoot;
    // Working tree IS the truth → always fresh. Dirty reflects whether the git
    // working tree has any changed/untracked file.
    let dirty = DIRTY.CLEAN;
    if (typeof projectRoot === 'string' && projectRoot) {
        try {
            const lines = gitLines(projectRoot, ['status', '--porcelain']);
            dirty = lines.length > 0 ? DIRTY.DIRTY : DIRTY.CLEAN;
        } catch (err) {
            // Non-fatal: we cannot prove clean, so report UNKNOWN (valid enum),
            // never throw.
            dirty = DIRTY.UNKNOWN;
        }
    }
    return {
        providerId: PROVIDER_ID,
        adapterVersion: ADAPTER_VERSION,
        available: true,
        ready: true,
        indexState: INDEX.NOT_REQUIRED,
        dirty,
        freshness: FRESHNESS.FRESH,
        compatibility: COMPAT.SUPPORTED,
        capabilities: buildCapabilities(),
        diagnostics: [],
    };
}

function getFiles(context, query) {
    void query;
    const diagnostics = [];
    const provider = getStatus(context);
    const projectRoot = context && context.projectRoot;

    if (typeof projectRoot !== 'string' || !projectRoot) {
        diagnostics.push(diag('missing-project-root', 'context.projectRoot (absolute path) is required'));
        return { provider, files: [], diagnostics };
    }

    let projectRootReal;
    try {
        projectRootReal = fs.realpathSync(projectRoot);
    } catch (err) {
        diagnostics.push(diag('project-root-unresolvable', errText(err)));
        return { provider, files: [], diagnostics };
    }

    // 1. Enumerate (tracked + untracked, honoring .gitignore). Deterministic sort.
    let list;
    try {
        list = gitLines(projectRoot, ['ls-files', '--cached', '--others', '--exclude-standard']);
    } catch (err) {
        diagnostics.push(diag('git-enumeration-failed', errText(err)));
        return { provider, files: [], diagnostics };
    }
    list.sort();

    // 2. Changed set (tracked modifications).
    const changedSet = new Set();
    try {
        for (const rel of gitLines(projectRoot, ['diff', '--name-only'])) {
            changedSet.add(rel);
        }
    } catch (err) {
        diagnostics.push(diag('git-diff-failed', errText(err)));
    }

    // 3 + 4. Architecture / Planning IR maps (best-effort, never throw).
    const archMap = readArchMap(projectRoot, diagnostics);
    const planMap = readPlanMap(projectRoot, diagnostics);

    // 5. MAX_FILES — no silent truncation.
    if (list.length > MAX_FILES) {
        const total = list.length;
        const dropped = total - MAX_FILES;
        list = list.slice(0, MAX_FILES);
        diagnostics.push(diag('file-limit-exceeded', `enumerated ${total} files; processing first ${MAX_FILES}, skipped ${dropped}`));
    }

    // 6. Per-file fs-safety → size → binary sniff → hash budget.
    const files = [];
    let hashedTotal = 0;
    for (const rel of list) {
        const safe = resolveSafe(projectRoot, projectRootReal, rel);
        if (!safe.safe) {
            diagnostics.push(diag(`${safe.code}:${rel}`, safe.message));
            continue;
        }
        const realpath = safe.realpath;

        let size;
        try {
            size = fs.statSync(realpath).size;
        } catch (err) {
            diagnostics.push(diag(`stat-failed:${rel}`, errText(err)));
            continue;
        }

        let contentHash; // stays undefined unless we actually hash

        if (size > MAX_FILE_BYTES) {
            // Over per-file cap: keep it LISTED, but do not read/hash.
            diagnostics.push(diag(`file-too-large:${rel}`, `${rel} is ${size} bytes > ${MAX_FILE_BYTES}; listed without contentHash`));
        } else {
            let buf;
            try {
                buf = fs.readFileSync(realpath);
            } catch (err) {
                diagnostics.push(diag(`read-failed:${rel}`, errText(err)));
                continue;
            }
            const sniffLen = Math.min(buf.length, BINARY_SNIFF_BYTES);
            let isBinary = false;
            for (let i = 0; i < sniffLen; i++) {
                if (buf[i] === 0) {
                    isBinary = true;
                    break;
                }
            }
            if (isBinary) {
                // Binaries are EXCLUDED (not listed) with a diagnostic.
                diagnostics.push(diag(`binary-skipped:${rel}`, `${rel} contains a NUL byte in the first ${BINARY_SNIFF_BYTES} bytes; excluded`));
                continue;
            }
            if (hashedTotal + buf.length > MAX_TOTAL_HASH_BYTES) {
                // Over cumulative cap: keep it LISTED without a contentHash.
                diagnostics.push(diag(`hash-budget-exceeded:${rel}`, `cumulative hash budget ${MAX_TOTAL_HASH_BYTES} bytes exceeded; ${rel} listed without contentHash`));
            } else {
                contentHash = crypto.createHash(CONTENT_HASH).update(buf).digest('hex');
                hashedTotal += buf.length;
            }
        }

        const snapshot = {
            freshness: FRESHNESS.FRESH,
            dirty: changedSet.has(rel) ? DIRTY.DIRTY : DIRTY.CLEAN,
        };
        if (contentHash !== undefined) {
            snapshot.contentHash = contentHash;
        }
        const reference = normalizeReference(PROVIDER_ID, {
            providerEntityId: rel,
            name: path.basename(rel),
            kind: 'file',
            filePath: rel,
            snapshot,
            provenance: { method: 'native-file', authority: 'governance', confidence: 1 },
        });
        files.push({
            reference,
            moduleId: archMap.has(rel) ? archMap.get(rel) : null,
            declaredByTaskIds: planMap.has(rel) ? planMap.get(rel) : [],
            changed: changedSet.has(rel),
        });
    }

    return { provider, files, diagnostics };
}

function getEntity(context, options) {
    const opts = options || {};
    const filePath = opts.filePath;
    const projectRoot = context && context.projectRoot;

    const makeRef = (contentHash) => {
        const snapshot = { freshness: FRESHNESS.FRESH, dirty: DIRTY.UNKNOWN };
        if (contentHash !== undefined) {
            snapshot.contentHash = contentHash;
        }
        return normalizeReference(PROVIDER_ID, {
            providerEntityId: typeof filePath === 'string' ? filePath : '',
            name: typeof filePath === 'string' ? path.basename(filePath) : '',
            kind: 'file',
            filePath: typeof filePath === 'string' ? filePath : '',
            snapshot,
            provenance: { method: 'native-file', authority: 'governance', confidence: 1 },
        });
    };

    if (typeof projectRoot !== 'string' || !projectRoot || typeof filePath !== 'string' || !filePath) {
        return {
            reference: makeRef(),
            content: null,
            truncated: false,
            diagnostics: [diag('path-unsafe', 'context.projectRoot and filePath are required')],
        };
    }

    let projectRootReal;
    try {
        projectRootReal = fs.realpathSync(projectRoot);
    } catch (err) {
        return {
            reference: makeRef(),
            content: null,
            truncated: false,
            diagnostics: [diag('path-unsafe', `projectRoot unresolvable: ${errText(err)}`)],
        };
    }

    const safe = resolveSafe(projectRoot, projectRootReal, filePath);
    if (!safe.safe) {
        return {
            reference: makeRef(),
            content: null,
            truncated: false,
            diagnostics: [diag('path-unsafe', safe.message)],
        };
    }
    const realpath = safe.realpath;

    let size;
    try {
        size = fs.statSync(realpath).size;
    } catch (err) {
        return {
            reference: makeRef(),
            content: null,
            truncated: false,
            diagnostics: [diag('path-unsafe', `stat failed: ${errText(err)}`)],
        };
    }

    if (size > MAX_FILE_BYTES) {
        return {
            reference: makeRef(),
            content: null,
            truncated: false,
            diagnostics: [diag('file-too-large', `${filePath} is ${size} bytes > ${MAX_FILE_BYTES}; content withheld`)],
        };
    }

    let buf;
    try {
        buf = fs.readFileSync(realpath);
    } catch (err) {
        return {
            reference: makeRef(),
            content: null,
            truncated: false,
            diagnostics: [diag('path-unsafe', `read failed: ${errText(err)}`)],
        };
    }

    const sniffLen = Math.min(buf.length, BINARY_SNIFF_BYTES);
    for (let i = 0; i < sniffLen; i++) {
        if (buf[i] === 0) {
            return {
                reference: makeRef(),
                content: null,
                truncated: false,
                diagnostics: [diag('binary', `${filePath} contains a NUL byte in the first ${BINARY_SNIFF_BYTES} bytes; content withheld`)],
            };
        }
    }

    const contentHash = crypto.createHash(CONTENT_HASH).update(buf).digest('hex');
    let truncated = size === MAX_FILE_BYTES; // read at the per-file boundary
    let text = buf.toString('utf8');

    if (Array.isArray(opts.lineRange) && opts.lineRange.length === 2) {
        const lines = text.split('\n');
        const start = Math.max(1, Math.trunc(opts.lineRange[0]) || 1);
        const end = Math.min(lines.length, Math.trunc(opts.lineRange[1]) || lines.length);
        text = end >= start ? lines.slice(start - 1, end).join('\n') : '';
    }

    if (typeof opts.maxChars === 'number' && Number.isFinite(opts.maxChars) && opts.maxChars >= 0 && text.length > opts.maxChars) {
        text = text.slice(0, opts.maxChars);
        truncated = true;
    }

    return {
        reference: makeRef(contentHash),
        content: text,
        truncated,
        diagnostics: [],
    };
}

function create() {
    return {
        id: PROVIDER_ID,
        name: PROVIDER_NAME,
        adapterVersion: ADAPTER_VERSION,
        capabilities: buildCapabilities(),
        check,
        getStatus,
        getFiles,
        getEntity,
    };
}

module.exports = { create };
