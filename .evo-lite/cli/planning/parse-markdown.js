'use strict';

const fs = require('fs');

// --- Frontmatter ---

function parseFrontmatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) return { frontmatter: {}, body: content };
    const fm = {};
    for (const line of match[1].split('\n')) {
        const kv = line.match(/^([\w-]+):\s*(.+)$/);
        if (kv) fm[kv[1]] = kv[2].trim();
    }
    return { frontmatter: fm, body: match[2] };
}

// --- Body extractors ---

function extractTitle(body) {
    const m = body.match(/^#\s+(.+)$/m);
    return m ? m[1].trim() : null;
}

function extractSection(body, heading) {
    const re = new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n##|$)`);
    const m = body.match(re);
    return m ? m[1] : '';
}

function extractLinkedPlans(body) {
    const section = extractSection(body, 'Linked Plans');
    return (section.match(/[-*]\s*(plan:[^\s\n]+)/g) || [])
        .map(m => m.replace(/^[-*]\s*/, '').trim());
}

function extractAcceptanceCriteria(body) {
    const section = extractSection(body, 'Acceptance Criteria');
    return section.split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('- '))
        .map(l => l.slice(2));
}

// --- Task parsing ---

function parseTaskAttrs(lines) {
    let linkedFiles = [];
    let verify = [];
    let acceptance = null;

    for (const line of lines) {
        const clean = line.trim();
        if (clean.startsWith('- files:')) {
            linkedFiles = clean.slice('- files:'.length).split(',').map(f => f.trim()).filter(Boolean);
        } else if (clean.startsWith('- verify:')) {
            verify.push(clean.slice('- verify:'.length).trim());
        } else if (clean.startsWith('- acceptance:')) {
            acceptance = clean.slice('- acceptance:'.length).trim();
        }
    }

    return { linkedFiles, verify, acceptance };
}

function extractTasks(body) {
    const tasks = [];
    const lines = body.split('\n');
    let currentPhase = null;
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        const phaseMatch = line.match(/^###\s+(.+)$/);
        if (phaseMatch) {
            currentPhase = phaseMatch[1].trim();
            i++;
            continue;
        }

        const cbMatch = line.match(/^[-*]\s+\[([ xX])\]\s+\[task:([^\]]+)\]\s+(.+)$/);
        if (cbMatch) {
            const continuations = [];
            let j = i + 1;
            while (j < lines.length) {
                const next = lines[j];
                if (/^\s{2,}/.test(next) && next.trim() !== '') {
                    continuations.push(next);
                    j++;
                } else if (next.trim() === '' && j + 1 < lines.length && /^\s{2,}/.test(lines[j + 1])) {
                    j++;
                } else {
                    break;
                }
            }

            const attrs = parseTaskAttrs(continuations);
            tasks.push({
                id: `task:${cbMatch[2]}`,
                title: cbMatch[3].trim(),
                status: cbMatch[1].trim() === '' ? 'todo' : 'implemented',
                phase: currentPhase,
                linkedFiles: attrs.linkedFiles,
                verify: attrs.verify,
                acceptance: attrs.acceptance,
            });
            i = j;
            continue;
        }

        i++;
    }

    return tasks;
}

// --- Public API ---

function parseSpecFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(content);

    if (!frontmatter.id || !frontmatter.id.startsWith('spec:')) return null;

    return {
        id: frontmatter.id,
        title: extractTitle(body),
        status: frontmatter.status || 'unknown',
        sourcePath: filePath,
        linkedPlans: extractLinkedPlans(body),
        acceptanceCriteria: extractAcceptanceCriteria(body),
    };
}

function parsePlanFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(content);

    if (!frontmatter.id || !frontmatter.id.startsWith('plan:')) return null;

    const tasks = extractTasks(body);

    return {
        id: frontmatter.id,
        title: extractTitle(body),
        status: frontmatter.status || 'unknown',
        sourcePath: filePath,
        linkedSpec: frontmatter.linkedSpec || null,
        taskIds: tasks.map(t => t.id),
        tasks,
    };
}

module.exports = { parseSpecFile, parsePlanFile, parseFrontmatter, extractTasks };
