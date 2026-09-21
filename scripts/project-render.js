#!/usr/bin/env node
'use strict';

// project-render — PROJECT.md + spec metadata + recent devlog  ->  docs/project.html
//
// One-way. This script READS the markdown sources and WRITES exactly one file,
// docs/project.html. It never writes back to any source. If it ever needs to,
// that is a design error, not a feature.
//
// Zero dependencies, zero native modules. Node >= 18, stdlib only. git is used
// only for a cosmetic branch label and degrades silently when absent.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'project.html');
const DEVLOG_SHOWN = 5;
const SPEC_LINE_CAP = 120;

// ---------------------------------------------------------------- markdown --

function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Escape first, then re-introduce the few inline constructs we support. Order
// matters: code spans win, so markup inside them stays literal.
function inline(text) {
    const code = [];
    let s = esc(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${code.push(c) - 1}\u0000`);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${code[i]}</code>`);
}

function tableRow(line) {
    return line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
}

// Block-level parser. Supports the subset these documents actually use:
// headings, fenced code, pipe tables, bullet lists, blockquotes, paragraphs.
function blocks(md, minHeading = 2) {
    const lines = md.split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        if (/^\s*$/.test(line)) { i++; continue; }

        if (/^```/.test(line)) {
            const body = [];
            i++;
            while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
            i++;
            out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
            continue;
        }

        const h = line.match(/^(#{1,6})\s+(.*)$/);
        if (h) {
            const level = Math.max(minHeading, h[1].length);
            out.push(`<h${level}>${inline(h[2])}</h${level}>`);
            i++;
            continue;
        }

        if (/^\|/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
            const head = tableRow(line);
            i += 2;
            const rows = [];
            while (i < lines.length && /^\|/.test(lines[i])) rows.push(tableRow(lines[i++]));
            const th = head.map(c => `<th>${inline(c)}</th>`).join('');
            const tb = rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
            out.push(`<div class="tablewrap"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`);
            continue;
        }

        if (/^\s*[-*]\s+/.test(line)) {
            const items = [];
            while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
                items.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`);
                i++;
            }
            out.push(`<ul>${items.join('')}</ul>`);
            continue;
        }

        if (/^>\s?/.test(line)) {
            const body = [];
            while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
            out.push(`<blockquote>${blocks(body.join('\n'), minHeading)}</blockquote>`);
            continue;
        }

        const para = [];
        while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(```|\||>|#{1,6}\s|\s*[-*]\s)/.test(lines[i])) {
            para.push(lines[i++]);
        }
        if (!para.length) { i++; continue; }
        const text = para.join(' ');
        // A lone short capitalised word is a devlog label (Changed / Why / ...).
        const cls = para.length === 1 && /^[A-Z][A-Za-z ]{0,14}$/.test(text) ? ' class="lbl"' : '';
        out.push(`<p${cls}>${inline(text)}</p>`);
    }
    return out.join('\n');
}

// ------------------------------------------------------------------ sources --

function read(rel) {
    const p = path.join(ROOT, rel);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

// Split a document on its "## " headings. Returns the lead-in text plus one
// entry per section, with a trailing "(...)" in the heading kept aside as a tag.
function sections(md) {
    const parts = md.split(/^## /m);
    const lead = parts.shift();
    return {
        lead,
        list: parts.map(chunk => {
            const nl = chunk.indexOf('\n');
            const heading = (nl === -1 ? chunk : chunk.slice(0, nl)).trim();
            const body = nl === -1 ? '' : chunk.slice(nl + 1);
            const m = heading.match(/^(.*?)\s*\((.+)\)\s*$/);
            return { title: m ? m[1] : heading, tag: m ? m[2] : '', body };
        }),
    };
}

function slug(s) {
    return s.toLowerCase().replace(/[^a-z0-9一-龥]+/g, '-').replace(/^-|-$/g, '');
}

function specTable() {
    const dir = path.join(ROOT, 'docs', 'specs');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort().map(f => {
        const raw = fs.readFileSync(path.join(dir, f), 'utf8');
        const lines = raw.replace(/\n$/, '').split('\n').length;   // match wc -l
        const title = (raw.match(/^#\s+(.*)$/m) || [, f])[1];
        const goal = (raw.match(/^## Goal\s*\n+([^\n]+)/m) || [, ''])[1];
        return { file: f, title, goal, lines, over: lines > SPEC_LINE_CAP && f !== 'TEMPLATE.md' };
    });
}

function branchLabel() {
    try {
        return require('child_process')
            .execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'],
                { cwd: ROOT, encoding: 'utf8', timeout: 3000 }).trim();
    } catch { return null; }
}

// -------------------------------------------------------------------- page --

const CSS = `
:root{--bg:#f5f7f6;--surface:#fff;--surface-2:#eaeeed;--ink:#131a19;--ink-2:#5a6664;--ink-3:#808d8a;
--line:#d6dddb;--line-soft:#e6ebea;--accent:#0d7480;--accent-soft:#e0f0f1;--ok:#2c7a4f;--ok-soft:#e2f1e8;
--warn:#9a6407;--warn-soft:#f6eddc;--danger:#a33028;--danger-soft:#f7e5e3;
--shadow:0 1px 2px rgba(19,26,25,.05),0 8px 24px -16px rgba(19,26,25,.25);
--f-sans:"IBM Plex Sans",ui-sans-serif,system-ui,-apple-system,"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif;
--f-mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Consolas,monospace;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0d1211;--surface:#141c1b;--surface-2:#1b2524;
--ink:#e3e9e7;--ink-2:#8f9d9a;--ink-3:#6f7d7a;--line:#253230;--line-soft:#1d2726;--accent:#45b8c4;--accent-soft:#10302f;
--ok:#5cba81;--ok-soft:#10291d;--warn:#d59c46;--warn-soft:#2b2313;--danger:#e2786f;--danger-soft:#2d1917;
--shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px -16px rgba(0,0,0,.8);color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0d1211;--surface:#141c1b;--surface-2:#1b2524;--ink:#e3e9e7;--ink-2:#8f9d9a;
--ink-3:#6f7d7a;--line:#253230;--line-soft:#1d2726;--accent:#45b8c4;--accent-soft:#10302f;--ok:#5cba81;
--ok-soft:#10291d;--warn:#d59c46;--warn-soft:#2b2313;--danger:#e2786f;--danger-soft:#2d1917;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--f-sans);font-size:15px;line-height:1.65;
-webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto;padding:0 16px 96px;display:grid;grid-template-columns:1fr;gap:40px}
@media (min-width:1024px){.wrap{padding:0 24px 96px;grid-template-columns:216px minmax(0,1fr);gap:56px;align-items:start}}
.masthead{grid-column:1/-1;border-bottom:1px solid var(--line);padding:44px 0 28px;display:flex;flex-wrap:wrap;
gap:28px 40px;align-items:flex-end;justify-content:space-between}
.masthead h1{font-size:clamp(28px,4vw,40px);line-height:1.12;letter-spacing:-.022em;font-weight:700;margin:0 0 10px}
.eyebrow{font-family:var(--f-mono);font-size:11px;font-weight:500;letter-spacing:.13em;text-transform:uppercase;
color:var(--accent);margin:0 0 12px}
.masthead p.lede{margin:0;color:var(--ink-2);max-width:58ch}
.stamp{font-family:var(--f-mono);font-size:12px;color:var(--ink-2);display:grid;gap:4px;justify-items:start}
.stamp b{color:var(--ink);font-weight:600}
nav.toc{display:none;font-size:13px}
@media (min-width:1024px){nav.toc{display:block;position:sticky;top:24px}}
nav.toc p{font-family:var(--f-mono);font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-3);margin:0 0 10px}
nav.toc ol{list-style:none;margin:0;padding:0;display:grid;gap:1px}
nav.toc a{display:block;padding:5px 10px;color:var(--ink-2);text-decoration:none;border-left:2px solid var(--line-soft);border-radius:0 4px 4px 0}
nav.toc a:hover{color:var(--accent);background:var(--surface);border-left-color:var(--accent)}
main{min-width:0;display:grid;gap:52px}
section{scroll-margin-top:20px;min-width:0}
h2{font-size:21px;font-weight:600;margin:0 0 6px;padding-bottom:10px;border-bottom:1px solid var(--line);
display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
h2 .h2-tag{font-family:var(--f-mono);font-size:11px;font-weight:500;color:var(--ink-3);letter-spacing:.04em}
h3{font-size:15px;font-weight:600;margin:26px 0 8px}
p{margin:10px 0;max-width:74ch}
ul{margin:10px 0;padding-left:20px;max-width:74ch}
li{margin:4px 0}
a{color:var(--accent)}
code{font-family:var(--f-mono);font-size:.875em;background:var(--surface-2);border-radius:3px;padding:1px 5px;word-break:break-word}
pre{margin:12px 0;padding:12px 14px;overflow-x:auto;background:var(--surface);border:1px solid var(--line);
border-left:3px solid var(--ink-3);border-radius:0 8px 8px 0;box-shadow:var(--shadow)}
pre code{background:none;padding:0;font-size:12.5px;line-height:1.7}
blockquote{margin:16px 0;padding:13px 16px;border-radius:8px;background:var(--warn-soft);font-size:14px;max-width:74ch}
blockquote p{margin:6px 0;max-width:none}
blockquote p:first-child{margin-top:0}blockquote p:last-child{margin-bottom:0}
.tablewrap{overflow-x:auto;margin:14px 0;border:1px solid var(--line);border-radius:8px;background:var(--surface)}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th,td{text-align:left;padding:9px 14px;border-bottom:1px solid var(--line-soft);vertical-align:top}
thead th{font-family:var(--f-mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);
font-weight:500;background:var(--surface-2);border-bottom:1px solid var(--line);white-space:nowrap}
tbody tr:last-child td{border-bottom:none}
.badge{display:inline-block;font-family:var(--f-mono);font-size:10.5px;font-weight:600;letter-spacing:.06em;
padding:2px 7px;border-radius:4px;white-space:nowrap}
.badge.pass{color:var(--ok);background:var(--ok-soft)}
.badge.hold{color:var(--warn);background:var(--warn-soft)}
.badge.stop{color:var(--danger);background:var(--danger-soft)}
.badge.idle{color:var(--ink-3);background:var(--surface-2)}
.now{background:var(--accent-soft);border-radius:10px;padding:4px 20px;margin-top:14px}
.now p{max-width:none}
.log{border-left:2px solid var(--line);padding-left:18px;margin-top:8px}
.log h3{font-family:var(--f-mono);font-size:13px;color:var(--accent);margin-top:22px}
.log p.lbl{font-family:var(--f-mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;
color:var(--ink-3);margin:12px 0 -4px}
footer{grid-column:1/-1;border-top:1px solid var(--line);margin-top:12px;padding-top:20px;font-size:12.5px;
color:var(--ink-3);font-family:var(--f-mono)}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

// Status words in the Milestones table get a badge so progress reads at a glance.
const BADGES = [
    [/未授权|不得|禁止/, 'stop'],
    [/完成|已推送|已建立|通过/, 'pass'],
    [/进行中|待|被拒|本地/, 'hold'],
    [/未开始|未定/, 'idle'],
];

// Only the LAST cell of a row carries status. Badging every cell turned a
// milestone's description into a green "pass" because it contained the word
// for "passes".
function badgeify(html) {
    return html.replace(/<td>([^<]{2,40})<\/td>(?=<\/tr>)/g, (m, txt) => {
        for (const [re, cls] of BADGES) {
            if (re.test(txt)) return `<td><span class="badge ${cls}">${txt}</span></td>`;
        }
        return m;
    });
}

function build() {
    const project = read('PROJECT.md');
    if (!project) {
        console.error('project-render: PROJECT.md not found — nothing to render.');
        process.exit(1);
    }

    const { lead, list } = sections(project);
    const title = (lead.match(/^#\s+(.*)$/m) || [, 'Project'])[1];
    const lede = lead.split('\n').filter(l => l.trim() && !l.startsWith('#')).join(' ');

    const specs = specTable();
    const devlogRaw = read('docs/devlog.md') || '';
    const entries = devlogRaw.split(/^## /m).slice(1).slice(0, DEVLOG_SHOWN);
    const lastLog = entries.length ? entries[0].split('\n')[0].trim() : '—';
    const identity = list.find(s => /identity/i.test(s.title));
    const now = list.find(s => /^now$/i.test(s.title));

    const rendered = list.map(s => {
        let body = blocks(s.body, 3);
        if (/milestone/i.test(s.title)) body = badgeify(body);
        return { ...s, id: slug(s.title), html: body };
    });

    // Specs section is generated from the filesystem, not transcribed by hand.
    const specRows = specs.map(s => `<tr><td><code>docs/specs/${esc(s.file)}</code></td>` +
        `<td>${esc(s.title)}</td>` +
        `<td><span class="badge ${s.over ? 'stop' : 'pass'}">${s.lines} / ${SPEC_LINE_CAP}</span></td></tr>`).join('');
    const specHtml = `<p>由 <code>docs/specs/</code> 目录实时生成，不是手抄的。行数超过 ${SPEC_LINE_CAP} 即表示该 spec 需要拆。</p>` +
        `<div class="tablewrap"><table><thead><tr><th>文件</th><th>标题</th><th>行数</th></tr></thead><tbody>${specRows}</tbody></table></div>`;

    const logHtml = '<div class="log">' + entries.map(e => blocks('### ' + e, 3)).join('') + '</div>';

    const toc = [...rendered.map(s => ({ id: s.id, t: s.title })),
        { id: 'specs-generated', t: 'Spec 索引' }, { id: 'devlog', t: '开发日志' }];

    const branch = branchLabel();
    const stamp = [
        branch ? `<div><b>branch</b> ${esc(branch)}</div>` : '',
        `<div><b>specs</b> ${specs.length}</div>`,
        `<div><b>last log</b> ${esc(lastLog)}</div>`,
        `<div><b>rendered</b> ${new Date().toISOString().slice(0, 10)}</div>`,
    ].join('');

    return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>${CSS}</style></head><body>
<div class="wrap">
<header class="masthead">
<div><p class="eyebrow">AI Project Continuity Toolkit</p><h1>${esc(title)}</h1>
<p class="lede">${inline(lede)}</p></div>
<div class="stamp">${stamp}</div>
</header>
<nav class="toc" aria-label="目录"><p>目录</p><ol>${
    toc.map(s => `<li><a href="#${s.id}">${esc(s.t)}</a></li>`).join('')}</ol></nav>
<main>
${rendered.map(s => {
        const isNow = s === now || s === identity;
        return `<section id="${s.id}"><h2>${esc(s.title)}${
            s.tag ? ` <span class="h2-tag">${esc(s.tag)}</span>` : ''}</h2>` +
            (isNow ? `<div class="now">${s.html}</div>` : s.html) + `</section>`;
    }).join('\n')}
<section id="specs-generated"><h2>Spec 索引 <span class="h2-tag">generated</span></h2>${specHtml}</section>
<section id="devlog"><h2>开发日志 <span class="h2-tag">最新 ${entries.length} 条</span></h2>${logHtml}</section>
</main>
<footer>由 scripts/project-render.js 从 PROJECT.md、docs/specs/、docs/devlog.md 生成 · 单向输出，不回写源文件 · 要改内容请改 Markdown 源文件后重新渲染</footer>
</div></body></html>
`;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, build());
console.log(`project-render: wrote ${path.relative(ROOT, OUT)}`);
