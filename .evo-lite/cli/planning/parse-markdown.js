'use strict';

const fs = require('fs');
const path = require('path');

// --- Frontmatter ---

function parseFrontmatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) return { frontmatter: {}, body: content };
    const fm = {};
    for (const line of match[1].split(/\r?\n/)) {
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
    let evidence = [];

    for (const line of lines) {
        const clean = line.trim();
        if (clean.startsWith('- files:')) {
            linkedFiles = clean.slice('- files:'.length).split(',').map(f => f.trim()).filter(Boolean);
        } else if (clean.startsWith('- verify:')) {
            verify.push(clean.slice('- verify:'.length).trim());
        } else if (clean.startsWith('- acceptance:')) {
            acceptance = clean.slice('- acceptance:'.length).trim();
        } else if (clean.startsWith('- evidence:')) {
            evidence.push(clean.slice('- evidence:'.length).trim());
        }
    }

    return { linkedFiles, verify, acceptance, evidence };
}

function extractTasks(body) {
    const tasks = [];
    const lines = body.split(/\r?\n/);
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
                evidence: attrs.evidence,
            });
            i = j;
            continue;
        }

        i++;
    }

    return tasks;
}

// --- Superpowers plan format support ---

function extractSuperPowersFiles(sectionLines) {
    const files = [];
    let inFiles = false;
    for (const line of sectionLines) {
        const t = line.trim();
        if (/^\*\*Files:\*\*/.test(t)) { inFiles = true; continue; }
        if (inFiles && /^\*\*[A-Z]/.test(t)) { inFiles = false; }
        if (!inFiles) continue;
        const m = t.match(/^-\s+(?:Create|Modify|Test|Sync):\s*`([^`]+)`/i);
        if (m) {
            const p = m[1].trim().replace(/:\d[\d-]*$/, '');
            if (p) files.push(p);
        }
    }
    return files;
}

function extractSuperPowersTasks(content, planSlug) {
    const lines = content.split(/\r?\n/);
    const tasks = [];
    let i = 0;

    while (i < lines.length) {
        const taskMatch = lines[i].match(/^###\s+Task\s+(\d+):\s+(.+)$/);
        if (taskMatch) {
            const taskNum = taskMatch[1];
            const taskTitle = taskMatch[2].trim().replace(/`/g, '');
            const taskId = `task:${planSlug}-t${taskNum}`;

            let j = i + 1;
            const sectionLines = [];
            while (j < lines.length && !/^#{2,3}\s/.test(lines[j])) {
                sectionLines.push(lines[j]);
                j++;
            }

            const allSteps = sectionLines.filter(l => /^-\s+\[[xX ]\]\s+\*\*Step/.test(l));
            const doneSteps = sectionLines.filter(l => /^-\s+\[[xX]\]\s+\*\*Step/.test(l));
            const filesHeadLine = sectionLines.find(l => /^\*\*Files:\*\*/.test(l.trim()));
            const readOnly = !!(filesHeadLine && /read[-\s]only|no\s+edits/i.test(filesHeadLine));
            const status = allSteps.length > 0 && doneSteps.length === allSteps.length
                ? 'implemented'
                : 'todo';

            tasks.push({
                id: taskId,
                title: taskTitle,
                status,
                phase: null,
                linkedFiles: extractSuperPowersFiles(sectionLines),
                verify: [],
                acceptance: null,
                evidence: [],
                readOnly,
            });

            i = j;
        } else {
            i++;
        }
    }

    return tasks;
}

function parseSuperPowersPlan(filePath, content) {
    if (!/^###\s+Task\s+\d+:/m.test(content)) return null;

    const { frontmatter } = parseFrontmatter(content);
    const base = path.basename(filePath, '.md');
    const slug = base.replace(/^\d{4}-\d{2}-\d{2}-/, '');
    const planId = `plan:${slug}`;

    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : slug;

    const tasks = extractSuperPowersTasks(content, slug);
    const allDone = tasks.length > 0 && tasks.every(t => t.status === 'implemented');

    return {
        id: planId,
        title,
        status: allDone ? 'done' : 'draft',
        sourcePath: filePath,
        linkedSpec: frontmatter.linkedSpec || null,
        r008Exempt: frontmatter.r008Exempt === true || frontmatter.r008Exempt === 'true',
        taskIds: tasks.map(t => t.id),
        tasks,
    };
}

// --- Public API ---

function parseSpecFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(content);

    if (!frontmatter.id || !frontmatter.id.startsWith('spec:')) return null;

    let linkedPlans = extractLinkedPlans(body);
    if (linkedPlans.length === 0 && frontmatter.linkedPlan) {
        linkedPlans = [frontmatter.linkedPlan];
    }

    return {
        id: frontmatter.id,
        title: extractTitle(body),
        status: frontmatter.status || 'unknown',
        sourcePath: filePath,
        linkedPlans,
        acceptanceCriteria: extractAcceptanceCriteria(body),
    };
}

function parsePlanFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(content);

    if (!frontmatter.id || !frontmatter.id.startsWith('plan:')) {
        return parseSuperPowersPlan(filePath, content);
    }

    const tasks = extractTasks(body);

    return {
        id: frontmatter.id,
        title: extractTitle(body),
        status: frontmatter.status || 'unknown',
        sourcePath: filePath,
        linkedSpec: frontmatter.linkedSpec || null,
        r008Exempt: frontmatter.r008Exempt === true || frontmatter.r008Exempt === 'true',
        taskIds: tasks.map(t => t.id),
        tasks,
    };
}

module.exports = { parseSpecFile, parsePlanFile, parseFrontmatter, extractTasks };
