'use strict';

// code-perception §5 ACT surface — the post-commit hook step. On a commit it
// refreshes Native Lite file facts, marks the code-perception cache stale,
// rebuilds + persists the commit/file governance links, and writes a
// deterministic post-commit status blob. It surfaces a MANUAL `codegraph
// sync` remedy as an advisory STRING only — this module NEVER requires or
// spawns codegraph (no `./codegraph`, `./providers/codegraph`, or
// `./codegraph-exec`); the stale-index remedy is words, never an action.
//
// Every step below is individually guarded: a Native Lite / cache / linker /
// fs failure degrades to a diagnostic and this module NEVER throws, so a
// Provider failure can never fail the commit that triggered it.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const nativeLite = require('./native-lite');
const cacheModule = require('./cache');
const linker = require('./governance-linker');

function diag(code, message) {
    return { code, message: message || code };
}

function errText(err) {
    return err && err.message ? String(err.message) : String(err);
}

function countByKind(links) {
    const counts = {};
    for (const link of links) {
        if (!link || typeof link.kind !== 'string') continue;
        counts[link.kind] = (counts[link.kind] || 0) + 1;
    }
    return counts;
}

// A STRING-only advisory — never an action. Surfaced only when there are
// changed files worth re-syncing an (optional, external) CodeGraph index
// for; empty changedFiles yields an empty string (no suggestion).
function buildSyncSuggestion(headSha, changedFiles) {
    if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
        return '';
    }
    return `If CodeGraph is installed and its index predates ${headSha}, run 'codegraph sync' manually to refresh symbol/impact data.`;
}

// Same atomic-write idiom as cache.js/persistGovernanceLinks: same-dir temp
// file + fs.renameSync. Never throws — returns false on any fs error.
function atomicWriteJSON(filePath, payload) {
    let tmpPath = null;
    try {
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });
        const rand = crypto.randomBytes(6).toString('hex');
        tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${rand}.tmp`);
        const json = JSON.stringify(payload, null, 2);
        fs.writeFileSync(tmpPath, json, 'utf8');
        fs.renameSync(tmpPath, filePath);
        return true;
    } catch (err) {
        if (tmpPath) {
            try {
                fs.unlinkSync(tmpPath);
            } catch (cleanupErr) {
                // ignore — best-effort cleanup of the temp file
            }
        }
        return false;
    }
}

// runPostCommitCodePerception({ projectRoot, headSha, changedFiles, cache })
//   -> { report, diagnostics }
//
// Never throws. Each of the 7 steps is independently guarded; a failure in
// any one step degrades to a diagnostic and the remaining steps still run.
function runPostCommitCodePerception(context) {
    const diagnostics = [];
    const ctx = context || {};
    const projectRoot = ctx.projectRoot;
    const hasProjectRoot = typeof projectRoot === 'string' && projectRoot.length > 0;
    const headSha = typeof ctx.headSha === 'string' && ctx.headSha ? ctx.headSha : 'unknown';
    const changedFiles = Array.isArray(ctx.changedFiles) ? ctx.changedFiles : [];
    const cache = ctx.cache || null;

    // 1. Refresh Native Lite facts (git-based; recomputes hashes).
    let fileReferences = [];
    try {
        const filesResult = nativeLite.create().getFiles({ projectRoot }, {});
        fileReferences = Array.isArray(filesResult.files) ? filesResult.files.map(f => f.reference) : [];
        if (Array.isArray(filesResult.diagnostics)) {
            diagnostics.push(...filesResult.diagnostics);
        }
    } catch (err) {
        diagnostics.push(diag('native-lite-refresh-failed', errText(err)));
    }

    // 2. Mark the code-perception cache stale (a caller may pass no cache).
    let cacheMarkedStale = false;
    if (cache && typeof cache.markStale === 'function') {
        try {
            cache.markStale({ reason: 'head', currentCommit: headSha });
            cacheMarkedStale = true;
        } catch (err) {
            diagnostics.push(diag('cache-mark-stale-failed', errText(err)));
        }
    }

    // 3. Rebuild commit/file governance links (declares/depends untouched —
    //    only the commit's changedFiles feed changed_by_commit here).
    let links = [];
    try {
        const built = linker.buildGovernanceLinks({
            commits: [{ sha: headSha, changedFiles }],
            fileReferences,
        });
        links = Array.isArray(built.links) ? built.links : [];
        if (Array.isArray(built.diagnostics)) {
            diagnostics.push(...built.diagnostics);
        }
    } catch (err) {
        diagnostics.push(diag('governance-link-build-failed', errText(err)));
    }

    // 4. Persist the stored graph (writes governance-links.json, atomic).
    let persisted = { written: false, count: links.length, diagnostics: [] };
    if (hasProjectRoot) {
        try {
            persisted = linker.persistGovernanceLinks(projectRoot, links);
            if (Array.isArray(persisted.diagnostics)) {
                diagnostics.push(...persisted.diagnostics);
            }
        } catch (err) {
            diagnostics.push(diag('governance-link-persist-failed', errText(err)));
        }
    } else {
        diagnostics.push(diag('missing-project-root', 'context.projectRoot (absolute path) is required to persist governance links'));
    }

    // 5. Manual-sync advisory — a STRING only, NEVER a codegraph spawn/call.
    const syncSuggestion = buildSyncSuggestion(headSha, changedFiles);

    // 6. Write the post-commit blob (atomic, deterministic).
    const report = {
        event: 'post-commit-code-perception',
        commit: headSha,
        changedFiles,
        nativeLiteFileCount: fileReferences.length,
        cacheMarkedStale,
        linksPersisted: typeof persisted.count === 'number' ? persisted.count : links.length,
        linkKinds: countByKind(links),
        syncSuggestion,
        ok: true,
        diagnostics,
    };

    if (hasProjectRoot) {
        const blobPath = path.join(projectRoot, '.evo-lite', 'generated', 'code-perception', 'post-commit-last-run.json');
        const wrote = atomicWriteJSON(blobPath, report);
        if (!wrote) {
            diagnostics.push(diag('post-commit-blob-write-failed', `failed to write ${blobPath}`));
        }
    }

    // 7. Return.
    return { report, diagnostics };
}

// registerCodePerceptionCommands(program) — the `mem code-perception
// post-commit` CLI, mirroring spec-portfolio.js's group idiom.
function registerCodePerceptionCommands(program) {
    const cp = program.command('code-perception').description('Code-perception runtime hooks.');
    cp.command('post-commit')
        .description('Refresh code-perception facts + links after a commit (never runs codegraph sync).')
        .action(async () => {
            const projectRoot = require('../runtime').getWorkspaceRoot();
            let headSha = 'unknown';
            try {
                headSha = require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim();
            } catch (_) {
                // best-effort: fall back to 'unknown'
            }
            const changedFiles = (process.env.EVO_LITE_CHANGED_FILES || '').split(/\s+/).filter(Boolean);
            let cache = null;
            try {
                cache = cacheModule.createCache({ projectRoot, now: () => Date.now() });
            } catch (_) {
                // best-effort: proceed without a cache
            }
            const { report, diagnostics } = module.exports.runPostCommitCodePerception({ projectRoot, headSha, changedFiles, cache });
            console.log(`code-perception post-commit: ${report.linksPersisted} link(s), stale=${report.cacheMarkedStale}`);
            if (diagnostics.length) console.log(`  diagnostics: ${diagnostics.length}`);
        });
}

module.exports = { runPostCommitCodePerception, registerCodePerceptionCommands };
