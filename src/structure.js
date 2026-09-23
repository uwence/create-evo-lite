'use strict';

// Thin structural scan of PROJECT.md for `status`.
//
// It recognises Markdown STRUCTURE only: section headings, fenced blocks,
// table separator rows, and physical line length. It never reads meaning out
// of prose — no focus, no lifecycle, no "this checkbox means done". See
// docs/specs/3.1-minimal-cli.md §3. The renderer's parser is a separate
// thing and its output never reaches this file.

const SECTION = /^##\s+(.+?)\s*\(<=\s*(\d+)\s*\)\s*$/;
const TABLE_SEPARATOR = /^\|[\s:|-]+\|$/;

const LINE_LIMIT = 240;

// One counting rule, no per-section special cases (§4):
// count non-empty source lines; skip the heading, the fence lines
// themselves, and a table's header and separator rows.
function measure(bodyLines) {
    let count = 0;
    let separators = 0;
    let inFence = false;
    const longLines = [];

    bodyLines.forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('```')) { inFence = !inFence; return; }
        if (!trimmed) return;
        if (!inFence && TABLE_SEPARATOR.test(trimmed)) { separators += 1; return; }
        // A prose line is one that is neither fenced nor part of a table.
        if (!inFence && !trimmed.startsWith('|') && line.length > LINE_LIMIT) {
            longLines.push({ line: index + 1, length: line.length });
        }
        count += 1;
    });

    // Each separator row pairs with exactly one header row.
    return { lines: count - separators, longLines };
}

function scanSections(text) {
    const lines = text.split('\n');
    const sections = [];
    let current = null;

    for (const line of lines) {
        if (line.startsWith('## ')) {
            if (current) sections.push(current);
            const match = line.match(SECTION);
            current = match
                ? { name: match[1], cap: Number(match[2]), body: [] }
                : { name: line.slice(3).trim(), cap: null, body: [] };
            continue;
        }
        if (current) current.body.push(line);
    }
    if (current) sections.push(current);

    return sections.map(section => ({
        name: section.name,
        cap: section.cap,
        ...measure(section.body),
    }));
}

// Display only. Never a gate: the caller exits 0 either way (§4).
function capsVerdict(sections) {
    const problems = [];
    for (const section of sections) {
        if (section.cap !== null && section.lines > section.cap) {
            problems.push(`${section.name} ${section.lines}/${section.cap}`);
        }
        for (const long of section.longLines) {
            problems.push(`${section.name} 第 ${long.line} 行 ${long.length} chars`);
        }
    }
    return problems.length ? `OVER — ${problems.join('；')}` : 'OK';
}

module.exports = { scanSections, capsVerdict, LINE_LIMIT };
