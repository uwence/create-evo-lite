'use strict';

const fs = require('fs');
const path = require('path');

const TASK_ID_RE = /task:[a-z0-9_-]+/gi;
// Catches bare mechanism tags like [plan-progress-t1] or [code-review-fixes-t3].
// These predate the `task:` prefix convention; rewrite to `task:<match>`.
const BARE_TASK_TAG_RE = /\[([a-z][a-z0-9-]*-t\d+)\]/gi;
const RAW_FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

function parseRawFrontmatter(content) {
    const m = content.match(RAW_FRONTMATTER_RE);
    if (!m) return {};
    const fm = {};
    for (const rawLine of m[1].split(/\r?\n/)) {
        const kv = rawLine.match(/^([A-Za-z0-9_]+):\s*"?([^"]*)"?\s*$/);
        if (kv) fm[kv[1]] = kv[2].trim();
    }
    return fm;
}

function extractTaskIds(text) {
    const direct = (text.match(TASK_ID_RE) || []).map(m => m.toLowerCase());
    const bareTags = [];
    let bareMatch;
    BARE_TASK_TAG_RE.lastIndex = 0;
    while ((bareMatch = BARE_TASK_TAG_RE.exec(text)) !== null) {
        bareTags.push(`task:${bareMatch[1].toLowerCase()}`);
    }
    return Array.from(new Set([...direct, ...bareTags]));
}

function backfillArchiveEvidence(projectRoot) {
    const rawDir = path.join(projectRoot, '.evo-lite', 'raw_memory');
    if (!fs.existsSync(rawDir)) {
        return {
            taskIdToArchives: {},
            archivesScanned: 0,
            archivesMatched: 0,
            outPath: null,
        };
    }

    const taskIdToArchives = {};
    let archivesScanned = 0;
    let archivesMatched = 0;

    for (const entry of fs.readdirSync(rawDir)) {
        if (!entry.startsWith('mem_') || !entry.endsWith('.md')) continue;
        archivesScanned += 1;
        const absPath = path.join(rawDir, entry);
        let content;
        try { content = fs.readFileSync(absPath, 'utf8'); } catch (_) { continue; }

        const fm = parseRawFrontmatter(content);
        const candidates = [];
        if (fm.linkedTask) candidates.push(fm.linkedTask.toLowerCase());
        candidates.push(...extractTaskIds(content));

        const unique = Array.from(new Set(candidates));
        if (unique.length === 0) continue;
        archivesMatched += 1;

        for (const taskId of unique) {
            if (!taskIdToArchives[taskId]) taskIdToArchives[taskId] = [];
            const ref = `archive:${entry}`;
            if (!taskIdToArchives[taskId].includes(ref)) {
                taskIdToArchives[taskId].push(ref);
            }
        }
    }

    const outDir = path.join(projectRoot, '.evo-lite', 'generated', 'planning');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'archive-evidence.json');
    const payload = {
        version: 'evo-archive-evidence@1',
        generatedAt: new Date().toISOString(),
        taskIdToArchives,
    };
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');

    return {
        taskIdToArchives,
        archivesScanned,
        archivesMatched,
        outPath,
    };
}

function loadArchiveEvidenceMap(projectRoot) {
    const evidencePath = path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'archive-evidence.json');
    if (!fs.existsSync(evidencePath)) return {};
    try {
        const payload = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
        return payload.taskIdToArchives || {};
    } catch (_) {
        return {};
    }
}

module.exports = {
    backfillArchiveEvidence,
    loadArchiveEvidenceMap,
    extractTaskIds,
    parseRawFrontmatter,
};
