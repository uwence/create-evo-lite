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

// --- Tracked checkbox scanner: the single semantic source ---
//
// "Is this line a machine-closable tracked checkbox" had three different answers:
// the parser's task/step recognition, preview's `/^- \[ \] /gm` count, and
// apply's `/- \[ \] /g` rewrite — unanchored and global, so it also rewrote
// indented children, prose, and literals inside fenced code. Every consumer now
// asks this scanner instead.
//
// Fence state is why exporting the two predicates would not have sufficed: a
// documented example of a step matches the grammar character for character, and
// only knowing you are inside a fence tells them apart.
const ORDINARY_TASK_CHECKBOX_RE = /^[-*]\s+\[([ xX])\]\s+\[task:([^\]]+)\]\s+(.+)$/;
const SUPERPOWERS_STEP_CHECKBOX_RE = /^-\s+\[([ xX])\]\s+\*\*Step/;
// ``` or ~~~, three or more, optionally indented — the opener may carry an info
// string, the closer may not.
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;

function scanTrackedPlanCheckboxes(content) {
    const lines = String(content == null ? '' : content).split(/\r?\n/);
    const checkboxes = [];
    let fence = null; // the marker char run that opened the current fence

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const fenceMatch = line.match(FENCE_RE);
        if (fenceMatch) {
            const marker = fenceMatch[1];
            if (fence === null) {
                fence = marker[0].repeat(3);
            } else if (marker[0] === fence[0] && marker.length >= fence.length) {
                fence = null;
            }
            continue;
        }
        if (fence !== null) continue; // inside a fence: documentation, not work

        const ord = line.match(ORDINARY_TASK_CHECKBOX_RE);
        if (ord) {
            checkboxes.push({ lineIndex: i, checked: ord[1] !== ' ', kind: 'task', taskId: `task:${ord[2]}` });
            continue;
        }
        const sp = line.match(SUPERPOWERS_STEP_CHECKBOX_RE);
        if (sp) {
            checkboxes.push({ lineIndex: i, checked: sp[1] !== ' ', kind: 'step', taskId: null });
        }
    }
    return { checkboxes };
}

// Rewrites ONLY the lines the scanner identified, in place, by line index —
// never by pattern replacement over the whole document. Returns the real number
// of lines changed so preview and apply cannot disagree about it.
function markTrackedPlanCheckboxesDone(content, scanResult) {
    const text = String(content == null ? '' : content);
    const scan = scanResult || scanTrackedPlanCheckboxes(text);
    const targets = scan.checkboxes.filter(c => !c.checked);
    if (targets.length === 0) return { content: text, changedCount: 0 };

    const lines = text.split(/\r?\n/);
    let changedCount = 0;
    for (const c of targets) {
        const line = lines[c.lineIndex];
        if (typeof line !== 'string') continue;
        // Only the checkbox itself; the rest of the line is left untouched.
        const next = line.replace(/^(\s*[-*]\s+)\[ \]/, '$1[x]');
        if (next !== line) { lines[c.lineIndex] = next; changedCount++; }
    }
    // Preserve the document's original newline style.
    const eol = /\r\n/.test(text) ? '\r\n' : '\n';
    return { content: lines.join(eol), changedCount };
}

// Tracked unchecked count — what preview must report and apply must perform.
function countTrackedUncheckedBoxes(content) {
    return scanTrackedPlanCheckboxes(content).checkboxes.filter(c => !c.checked).length;
}

function extractTasks(body) {
    const tasks = [];
    const lines = body.split(/\r?\n/);
    let currentPhase = null;
    let i = 0;
    // Same scanner the mutation uses, so the parser cannot recognise a task the
    // rewriter would skip, or vice versa. A fenced example of a task line is
    // documentation here too.
    const trackedLines = new Set(scanTrackedPlanCheckboxes(body).checkboxes
        .filter(c => c.kind === 'task').map(c => c.lineIndex));

    while (i < lines.length) {
        const line = lines[i];

        const phaseMatch = line.match(/^###\s+(.+)$/);
        if (phaseMatch) {
            currentPhase = phaseMatch[1].trim();
            i++;
            continue;
        }

        const cbMatch = trackedLines.has(i) ? line.match(ORDINARY_TASK_CHECKBOX_RE) : null;
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

const SUPERPOWERS_TASK_HEADING_RE = /^###\s+Task\s+(\d+)\s*(?::|：|-|–|—)\s+(.+)$/;
const SUPERPOWERS_TASK_HEADING_ANY_RE = /^###\s+Task\s+\d+\s*(?::|：|-|–|—)\s+/m;

function hasSuperPowersTaskHeadings(content) {
    return SUPERPOWERS_TASK_HEADING_ANY_RE.test(content);
}

function extractSuperPowersFiles(sectionLines) {
    const files = [];
    let inFiles = false;
    for (const line of sectionLines) {
        const t = line.trim();
        if (/^\*\*Files:\*\*/.test(t)) { inFiles = true; continue; }
        if (inFiles && /^\*\*[A-Z]/.test(t)) { inFiles = false; }
        if (!inFiles) continue;
        const m = t.match(/^-\s+(?:Create|Add|Modify|Test|Sync):\s*`([^`]+)`/i);
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
        const taskMatch = lines[i].match(SUPERPOWERS_TASK_HEADING_RE);
        if (taskMatch) {
            const taskNum = taskMatch[1];
            const taskTitle = taskMatch[2].trim().replace(/`/g, '');
            const taskId = `task:${planSlug}-t${taskNum}`;

            let j = i + 1;
            const sectionLines = [];
            while (j < lines.length && !/^#{2,3}\s+Task\s+\d+\s*(?::|：|-|–|—)\s+/.test(lines[j])) {
                sectionLines.push(lines[j]);
                j++;
            }

            // Scanned, not pattern-matched: a step shown inside a fenced example
            // is documentation, and counting it would make the task look
            // incomplete forever while the rewriter correctly leaves it alone.
            const sectionScan = scanTrackedPlanCheckboxes(sectionLines.join('\n')).checkboxes
                .filter(c => c.kind === 'step');
            const allSteps = sectionScan;
            const doneSteps = sectionScan.filter(c => c.checked);
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
    if (!hasSuperPowersTaskHeadings(content)) return null;

    const { frontmatter } = parseFrontmatter(content);
    const base = path.basename(filePath, '.md');
    const slug = base.replace(/^\d{4}-\d{2}-\d{2}-/, '');
    const planId = frontmatter.id && frontmatter.id.startsWith('plan:')
        ? frontmatter.id
        : `plan:${slug}`;

    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : slug;

    const taskSlug = planId.replace(/^plan:/, '');
    const tasks = extractSuperPowersTasks(content, taskSlug);
    const allDone = tasks.length > 0 && tasks.every(t => t.status === 'implemented');

    return {
        id: planId,
        title,
        status: frontmatter.status || (allDone ? 'done' : 'draft'),
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
    const format = String(frontmatter.format || '').toLowerCase();
    const hasSuperPowers = hasSuperPowersTaskHeadings(content);

    if (!frontmatter.id || !frontmatter.id.startsWith('plan:')) {
        return parseSuperPowersPlan(filePath, content);
    }

    if (format === 'superpowers' && hasSuperPowers) {
        return parseSuperPowersPlan(filePath, content);
    }

    const tasks = extractTasks(body);
    if (tasks.length === 0 && hasSuperPowers) {
        return parseSuperPowersPlan(filePath, content);
    }

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

// The single relation algorithm for "which plans belong to this spec".
//
// It lives here because both consumers already depend on this module, and
// because having two of them is precisely the defect this closes: Spec Portfolio
// resolved three sources while closure read only frontmatter.linkedPlan, so the
// two official mechanisms could disagree about whether a spec had a linked plan
// at all. Anything that needs this answer must call THIS function rather than
// re-deriving it.
//
// planIr is passed in rather than read here so this stays a pure function and
// this module acquires no filesystem dependency.
function resolveLinkedPlanIds(parsedSpec, planIr) {
    if (!parsedSpec || !parsedSpec.id) return [];
    // Declared: body "## Linked Plans", falling back to frontmatter linkedPlan
    // (parseSpecFile already applies that precedence).
    const ids = new Set(parsedSpec.linkedPlans || []);
    // Reverse: any plan whose linkedSpec points back at this spec.
    const plans = (planIr && Array.isArray(planIr.plans)) ? planIr.plans : [];
    for (const plan of plans) {
        if (plan && plan.id && plan.linkedSpec === parsedSpec.id) ids.add(plan.id);
    }
    // Sorted so preview actions and warnings are stable across runs.
    return Array.from(ids).sort();
}

module.exports = {
    parseSpecFile, parsePlanFile, parseFrontmatter, extractTasks, parseSuperPowersPlan,
    resolveLinkedPlanIds,
    scanTrackedPlanCheckboxes, markTrackedPlanCheckboxesDone, countTrackedUncheckedBoxes,
};
