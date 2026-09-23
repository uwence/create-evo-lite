'use strict';

// Presentation-only Markdown parser for `render`.
//
// Its output may flow to HTML and nowhere else. It must never become input
// to status, lifecycle, focus or state decisions — that is the whole of the
// structure/semantics boundary in docs/specs/3.1-minimal-cli.md §3. Nothing
// in src/status.js or src/structure.js requires this file.

function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Escape first, then reintroduce the few inline constructs we support.
// Code spans win, so markup inside them stays literal.
function inline(text) {
    const codes = [];
    let out = escapeHtml(text)
        .replace(/`([^`]+)`/g, (_, code) => `\u0000${codes.push(code) - 1}\u0000`);
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
    return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

function tableCells(line) {
    return line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
}

// Block-level parser covering the subset these documents actually use:
// headings, fenced code, pipe tables, bullet lists, blockquotes, paragraphs.
function toHtml(markdown, minHeading = 2) {
    const lines = markdown.split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        if (!line.trim()) { i += 1; continue; }

        if (line.trim().startsWith('```')) {
            const body = [];
            i += 1;
            while (i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i++]);
            i += 1;
            out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
            continue;
        }

        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            const level = Math.max(minHeading, heading[1].length);
            out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
            i += 1;
            continue;
        }

        if (line.startsWith('|') && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
            const head = tableCells(line);
            i += 2;
            const rows = [];
            while (i < lines.length && lines[i].startsWith('|')) rows.push(tableCells(lines[i++]));
            const headHtml = head.map(c => `<th>${inline(c)}</th>`).join('');
            const bodyHtml = rows
                .map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
            out.push('<div class="tablewrap"><table><thead><tr>' + headHtml
                + `</tr></thead><tbody>${bodyHtml}</tbody></table></div>`);
            continue;
        }

        if (/^\s*[-*]\s+/.test(line)) {
            const items = [];
            while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
                items.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`);
                i += 1;
            }
            out.push(`<ul>${items.join('')}</ul>`);
            continue;
        }

        if (/^>\s?/.test(line)) {
            const body = [];
            while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
            out.push(`<blockquote>${toHtml(body.join('\n'), minHeading)}</blockquote>`);
            continue;
        }

        const paragraph = [];
        while (i < lines.length && lines[i].trim()
               && !/^(```|\||>|#{1,6}\s|\s*[-*]\s)/.test(lines[i])) {
            paragraph.push(lines[i++]);
        }
        if (!paragraph.length) { i += 1; continue; }
        const text = paragraph.join(' ');
        // A lone short capitalised word is a devlog label (Changed / Why / …).
        const labelled = paragraph.length === 1 && /^[A-Z][A-Za-z ]{0,14}$/.test(text);
        out.push(`<p${labelled ? ' class="lbl"' : ''}>${inline(text)}</p>`);
    }
    return out.join('\n');
}

module.exports = { toHtml, inline, escapeHtml };
