'use strict';

// Read-only source pages (design §2.3). Containment before read (same
// path-containment semantics as the 4a provider layer): repo-relative only,
// no '..', no absolute paths, realpath must stay inside projectRoot. All
// content is HTML-escaped; binary and oversized files get a stub reason and
// the module page keeps their entry.

const fs = require('node:fs');
const path = require('node:path');
const { escapeHtml, pageChrome } = require('./render');

const DEFAULT_LIMIT = 512 * 1024;

function resolveContained(projectRoot, repoRelPath) {
    const raw = String(repoRelPath).replace(/\\/g, '/');
    if (!raw || raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || raw.split('/').includes('..')) return null;
    const abs = path.resolve(projectRoot, raw);
    const rootReal = fs.realpathSync(projectRoot);
    let real;
    try { real = fs.realpathSync(abs); } catch { return null; }
    const rel = path.relative(rootReal, real);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return real;
}

function looksBinary(buf) {
    const n = Math.min(buf.length, 8000);
    for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
    return false;
}

function generateSourcePages({ projectRoot, files, pageMap, meta, limitBytes = DEFAULT_LIMIT }) {
    const pages = []; const skipped = []; const warnings = [];
    const sorted = [...new Set(files)].sort();
    for (const f of sorted) {
        const real = resolveContained(projectRoot, f);
        if (!real) { skipped.push({ path: f, reason: '路径不在项目内' }); continue; }
        let stat;
        try { stat = fs.statSync(real); } catch { skipped.push({ path: f, reason: '文件不可读' }); continue; }
        if (!stat.isFile()) { skipped.push({ path: f, reason: '不是普通文件' }); continue; }
        if (stat.size > limitBytes) {
            // Design §2.3: oversized files get an explanatory STUB page — never
            // silently dropped, never embedding the content itself.
            const body = `<h1><code>${escapeHtml(f)}</code></h1>`
                + `<p>该文件大小为 ${Math.round(stat.size / 1024)} KiB,超过 ${Math.round(limitBytes / 1024)} KiB 上限,未渲染正文。请在本地编辑器中查看。</p>`
                + `<p><a href="../index.html">← 返回项目全貌</a></p>`;
            pages.push({ page: pageMap.sourcePage(f), html: pageChrome({ title: `${f} — 源码`, body, meta }), stub: true });
            continue;
        }
        const buf = fs.readFileSync(real);
        if (looksBinary(buf)) { skipped.push({ path: f, reason: '二进制文件不渲染' }); continue; }
        const lines = buf.toString('utf8').split(/\r?\n/);
        const bodyLines = lines.map((line, i) =>
            `<tr id="L${i + 1}"><td class="ln">${i + 1}</td><td><pre>${escapeHtml(line) || ' '}</pre></td></tr>`).join('');
        const body = `<h1><code>${escapeHtml(f)}</code></h1>`
            + `<table class="src">${bodyLines}</table>`
            + `<p><a href="../index.html">← 返回项目全貌</a></p>`;
        pages.push({ page: pageMap.sourcePage(f), html: pageChrome({ title: `${f} — 源码`, body, meta }) });
    }
    return { pages, skipped, warnings };
}

module.exports = { generateSourcePages, resolveContained, DEFAULT_LIMIT };
