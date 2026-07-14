'use strict';

// code-perception cache — a FILE-based, bounded, envelope-wrapped,
// containment-checked cache for CodeGraph-derived data. It is file-based (not
// an in-process Map) so a separate post-commit process can markStale /
// invalidate it. A stale value NEVER masquerades as fresh: `stale` lives on
// the envelope, never on the value, and `get()` surfaces it as the effective
// freshness. Only whitelisted value kinds are persisted (never source).
//
// Security-critical invariants (do NOT weaken):
//   * NEVER process.cwd(): the root derives from options.projectRoot / options.root.
//   * NEVER Date.now(): the clock is injected via options.now(); production
//     callers pass () => Date.now() themselves.
//   * Filenames are ONLY the 64-hex makeCacheKey sha + '.json' — every read,
//     write, and eviction is gated on that exact shape.
//   * Root safety (symlink / containment) is verified once at creation; an
//     unsafe root degrades the cache to a safe no-op (never throws, never
//     writes outside the project root).
//   * Writes are atomic: same-dir temp file + fs.renameSync.
//   * On read, file SIZE is checked (statSync) BEFORE the file is read.
//   * Corrupt/unparseable JSON is a MISS + diagnostic — never a throw.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CACHE_VERSION = 'evo-code-cache@1';
const DEFAULT_TTL_MS = 300000;
const MAX_CACHE_ENTRIES = 256;
const MAX_CACHE_VALUE_BYTES = 1 * 1024 * 1024;

const CACHEABLE_KINDS = Object.freeze(['provider-status', 'search', 'relationship', 'impact', 'governance-links']);

const KEY_RE = /^[0-9a-f]{64}$/;
const ENTRY_FILE_RE = /^[0-9a-f]{64}\.json$/;

function diag(code, message) {
    return { code, message: message || code };
}

function errText(err) {
    return err && err.message ? String(err.message) : String(err);
}

// True iff `childReal` is `rootReal` itself or strictly beneath it. Both
// inputs MUST already be realpath-resolved (mirrors native-lite's isContained).
function isContained(rootReal, childReal) {
    if (childReal === rootReal) {
        return true;
    }
    return childReal.startsWith(rootReal + path.sep);
}

// Canonical (sorted-key) JSON serialization — used for makeCacheKey only.
function canonicalJSON(value) {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJSON).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value === undefined ? null : value);
}

function makeCacheKey(parts) {
    const p = parts || {};
    const normalized = {
        providerId: p.providerId || '',
        providerVersion: p.providerVersion || '',
        adapterVersion: p.adapterVersion || '',
        snapshot: p.snapshot === undefined ? '' : p.snapshot,
        rootFingerprint: p.rootFingerprint || '',
        query: p.query || '',
    };
    let json;
    try {
        json = canonicalJSON(normalized);
    } catch (err) {
        json = JSON.stringify(String(err));
    }
    return crypto.createHash('sha256').update(json).digest('hex');
}

// Verify `root` is safe to use: no existing path component is a symlink, and
// its realpath is contained within `baseRoot`'s realpath (when baseRoot is
// given). Never throws. Returns { safe:true } or { safe:false, code }.
function resolveRootSafety(baseRoot, root) {
    let baseRootReal = null;
    if (typeof baseRoot === 'string' && baseRoot) {
        try {
            baseRootReal = fs.realpathSync(baseRoot);
        } catch (err) {
            return { safe: false, code: 'project-root-unresolvable' };
        }
    }

    // Walk up from `root` to the deepest existing ancestor. Any component
    // that does not yet exist cannot be a symlink, so it is safe by
    // construction; we only need to inspect what is actually on disk today.
    let current = root;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        let exists = false;
        try {
            exists = fs.existsSync(current);
        } catch (err) {
            exists = false;
        }
        if (exists) {
            break;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }

    let lst;
    try {
        lst = fs.lstatSync(current);
    } catch (err) {
        return { safe: false, code: 'cache-root-unresolvable' };
    }
    if (lst.isSymbolicLink()) {
        return { safe: false, code: 'symlink-escape' };
    }

    let currentReal;
    try {
        currentReal = fs.realpathSync(current);
    } catch (err) {
        return { safe: false, code: 'cache-root-unresolvable' };
    }

    const suffix = path.relative(current, root);
    const rootReal = suffix ? path.join(currentReal, suffix) : currentReal;

    if (baseRootReal !== null && !isContained(baseRootReal, rootReal)) {
        return { safe: false, code: 'symlink-escape' };
    }

    return { safe: true };
}

function createNoopCache(reason) {
    return {
        get(key) {
            void key;
            return { hit: false, diagnostics: [diag(reason, `cache unavailable: ${reason}`)] };
        },
        set(key, value, meta) {
            void key; void value; void meta;
            return { stored: false, reason };
        },
        invalidateOn(reasonArg) {
            void reasonArg;
            return { cleared: 0 };
        },
        markStale(opts) {
            void opts;
            return { marked: 0 };
        },
        size() {
            return 0;
        },
    };
}

function ensureDir(dir) {
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
        // Best-effort: a failure here surfaces as a write failure below.
    }
}

function tempFileFor(filePath, now) {
    const rand = crypto.randomBytes(6).toString('hex');
    return `${filePath}.${process.pid}.${now}.${rand}.tmp`;
}

function atomicWriteJSON(filePath, json, now) {
    const tmpPath = tempFileFor(filePath, now);
    try {
        fs.writeFileSync(tmpPath, json, 'utf8');
        fs.renameSync(tmpPath, filePath);
        return true;
    } catch (err) {
        try {
            fs.unlinkSync(tmpPath);
        } catch (cleanupErr) {
            // ignore — best-effort cleanup of the temp file
        }
        return false;
    }
}

// Enumerate valid `<64hex>.json` entry files that are real files (never a
// symlink masquerading as an entry). Never throws.
function listValidEntries(root) {
    let names;
    try {
        names = fs.readdirSync(root);
    } catch (err) {
        return [];
    }
    const out = [];
    for (const name of names) {
        if (!ENTRY_FILE_RE.test(name)) {
            continue;
        }
        const filePath = path.join(root, name);
        let lst;
        try {
            lst = fs.lstatSync(filePath);
        } catch (err) {
            continue;
        }
        if (!lst.isFile()) {
            continue; // excludes symlinks and directories that happen to match the name
        }
        out.push({ key: name.slice(0, 64), filePath });
    }
    return out;
}

function readEnvelope(filePath) {
    let raw;
    try {
        raw = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        return { ok: false, code: 'cache-read-failed' };
    }
    let envelope;
    try {
        envelope = JSON.parse(raw);
    } catch (err) {
        return { ok: false, code: 'cache-corrupt' };
    }
    if (!envelope || typeof envelope !== 'object' || typeof envelope.storedAt !== 'number') {
        return { ok: false, code: 'cache-corrupt' };
    }
    return { ok: true, envelope };
}

function buildCache(root, cfg) {
    const { now, ttlMs, maxEntries, maxValueBytes } = cfg;

    function enforceMaxEntries() {
        const entries = listValidEntries(root);
        if (entries.length <= maxEntries) {
            return;
        }
        const withStoredAt = entries.map(e => {
            const read = readEnvelope(e.filePath);
            return {
                filePath: e.filePath,
                storedAt: read.ok ? read.envelope.storedAt : -Infinity, // corrupt/unreadable evicts first
            };
        });
        withStoredAt.sort((a, b) => a.storedAt - b.storedAt);
        const excess = withStoredAt.length - maxEntries;
        for (let i = 0; i < excess; i++) {
            try {
                fs.unlinkSync(withStoredAt[i].filePath);
            } catch (err) {
                // ignore — best-effort eviction
            }
        }
    }

    function get(key) {
        try {
            if (typeof key !== 'string' || !KEY_RE.test(key)) {
                return { hit: false, diagnostics: [diag('invalid-key', 'cache key must be a 64-hex sha256')] };
            }
            const filePath = path.join(root, `${key}.json`);
            let stat;
            try {
                stat = fs.statSync(filePath);
            } catch (err) {
                return { hit: false, diagnostics: [diag('cache-miss', 'no entry for key')] };
            }
            if (stat.size > maxValueBytes) {
                // Size checked BEFORE any read — never load an oversized file into memory.
                return { hit: false, diagnostics: [diag('cache-value-too-large', `${key}.json exceeds ${maxValueBytes} bytes; not read`)] };
            }
            const read = readEnvelope(filePath);
            if (!read.ok) {
                return { hit: false, diagnostics: [diag(read.code, `${key}.json: ${read.code}`)] };
            }
            const envelope = read.envelope;
            if (now() - envelope.storedAt > ttlMs) {
                try {
                    fs.unlinkSync(filePath);
                } catch (err) {
                    // ignore — best-effort cleanup of an expired entry
                }
                return { hit: false, diagnostics: [diag('cache-expired', 'entry exceeded ttlMs')] };
            }
            return {
                hit: true,
                value: envelope.value,
                stale: !!envelope.stale,
                staleReason: envelope.staleReason || null,
                storedAt: envelope.storedAt,
            };
        } catch (err) {
            return { hit: false, diagnostics: [diag('cache-internal-error', errText(err))] };
        }
    }

    function set(key, value, meta) {
        try {
            if (typeof key !== 'string' || !KEY_RE.test(key)) {
                return { stored: false, reason: 'invalid-key' };
            }
            const m = meta || {};
            if (!CACHEABLE_KINDS.includes(m.kind)) {
                return { stored: false, reason: 'uncacheable-kind' };
            }
            const nowMs = now();
            const envelope = {
                version: CACHE_VERSION,
                storedAt: nowMs,
                stale: false,
                staleReason: null,
                currentCommit: m.currentCommit || null,
                kind: m.kind,
                value,
            };
            let json;
            try {
                json = JSON.stringify(envelope);
            } catch (err) {
                return { stored: false, reason: 'unserializable-value' };
            }
            if (Buffer.byteLength(json, 'utf8') > maxValueBytes) {
                // Checked BEFORE writing anything to disk.
                return { stored: false, reason: 'cache-value-too-large' };
            }
            ensureDir(root);
            const filePath = path.join(root, `${key}.json`);
            const wrote = atomicWriteJSON(filePath, json, nowMs);
            if (!wrote) {
                return { stored: false, reason: 'write-failed' };
            }
            enforceMaxEntries();
            return { stored: true };
        } catch (err) {
            return { stored: false, reason: 'cache-internal-error' };
        }
    }

    function markStale(opts) {
        try {
            const o = opts || {};
            const entries = listValidEntries(root);
            let marked = 0;
            for (const e of entries) {
                const read = readEnvelope(e.filePath);
                if (!read.ok) {
                    continue; // corrupt entries are left alone (get() will surface cache-corrupt)
                }
                const envelope = read.envelope;
                envelope.stale = true;
                envelope.staleReason = o.reason || null;
                if (o.currentCommit !== undefined) {
                    envelope.currentCommit = o.currentCommit;
                }
                let json;
                try {
                    json = JSON.stringify(envelope);
                } catch (err) {
                    continue;
                }
                if (atomicWriteJSON(e.filePath, json, now())) {
                    marked++;
                }
            }
            return { marked };
        } catch (err) {
            return { marked: 0 };
        }
    }

    function invalidateOn(reason) {
        void reason; // MVP: any reason clears all entries.
        try {
            const entries = listValidEntries(root);
            let cleared = 0;
            for (const e of entries) {
                try {
                    fs.unlinkSync(e.filePath);
                    cleared++;
                } catch (err) {
                    // ignore — best-effort clear
                }
            }
            return { cleared };
        } catch (err) {
            return { cleared: 0 };
        }
    }

    function size() {
        try {
            return listValidEntries(root).length;
        } catch (err) {
            return 0;
        }
    }

    return { get, set, invalidateOn, markStale, size };
}

function createCache(options) {
    const opts = options || {};
    const projectRoot = typeof opts.projectRoot === 'string' && opts.projectRoot ? opts.projectRoot : null;
    const explicitRoot = typeof opts.root === 'string' && opts.root ? opts.root : null;

    if (!projectRoot && !explicitRoot) {
        return createNoopCache('missing-cache-root');
    }
    if (typeof opts.now !== 'function') {
        // Injected-clock invariant: never fall back to Date.now() ourselves.
        return createNoopCache('missing-clock');
    }

    const root = explicitRoot || path.join(projectRoot, '.evo-lite', '.cache', 'code-perception');
    const safety = resolveRootSafety(projectRoot, root);
    if (!safety.safe) {
        return createNoopCache('unsafe-cache-root');
    }

    const cfg = {
        now: opts.now,
        ttlMs: typeof opts.ttlMs === 'number' ? opts.ttlMs : DEFAULT_TTL_MS,
        maxEntries: typeof opts.maxEntries === 'number' ? opts.maxEntries : MAX_CACHE_ENTRIES,
        maxValueBytes: typeof opts.maxValueBytes === 'number' ? opts.maxValueBytes : MAX_CACHE_VALUE_BYTES,
    };
    return buildCache(root, cfg);
}

module.exports = { makeCacheKey, createCache, CACHEABLE_KINDS };
