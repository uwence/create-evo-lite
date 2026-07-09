'use strict';

const fs = require('fs');
const path = require('path');

// Same grammar as active_context backlog (memory.service.js BACKLOG_ID_RE).
// Re-declared here so hive modules stay free of memory.service's db deps.
const CHECKBOX_RE = /^- \[([ xX])\]\s*(.*)$/;
const LABEL_RE = /^\[([A-Za-z0-9_-]{1,32})\]\s*/;

const FEEDBACK_REL = '.evo-lite/hive/feedback.md';
const FEEDBACK_TEMPLATE = [
    '# 🐝 Hive Feedback Outbox',
    '',
    '> 子巢 agent: 撞到 evo-lite 本身的摩擦(非本项目问题)时, 追加一行:',
    '> `- [ ] [short-label] 现象 + 复现条件`。母巢 nurture 时收集并勾选。',
    '',
    '',
].join('\n');

function feedbackPath(childRoot) {
    return path.join(childRoot, ...FEEDBACK_REL.split('/'));
}

function parseFeedback(text) {
    return String(text).split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('- ['))
        .map(line => {
            const m = line.match(CHECKBOX_RE);
            if (!m) return null;
            const body = m[2].trim();
            const labelMatch = body.match(LABEL_RE);
            return {
                checked: m[1].toLowerCase() === 'x',
                label: labelMatch ? labelMatch[1] : null,
                text: labelMatch ? body.slice(labelMatch[0].length).trim() : body,
                line,
            };
        })
        .filter(Boolean);
}

function markCollected(text, lines) {
    const targets = new Set(lines);
    return String(text).split('\n')
        .map(raw => targets.has(raw.trim()) ? raw.replace('- [ ]', '- [x]') : raw)
        .join('\n');
}

function readOutbox(childRoot) {
    const fp = feedbackPath(childRoot);
    if (!fs.existsSync(fp)) return { exists: false, text: '', pending: [] };
    const text = fs.readFileSync(fp, 'utf8');
    const pending = parseFeedback(text)
        .filter(item => !item.checked)
        .map(({ label, text: itemText, line }) => ({ label, text: itemText, line }));
    return { exists: true, text, pending };
}

module.exports = { FEEDBACK_REL, FEEDBACK_TEMPLATE, feedbackPath, parseFeedback, markCollected, readOutbox };
