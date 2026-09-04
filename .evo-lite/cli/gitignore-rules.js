'use strict';

// The Evo-Lite block inside a project's .gitignore is managed by the mother, but
// the FILE belongs to the project. So syncing is strictly additive: rules the
// template declares and the project lacks get appended; nothing is ever removed,
// reordered, or overwritten. A project may add ignores anywhere it likes,
// including inside the managed block, and they survive.
//
// This exists because the previous check asked "does a block exist?" — three
// strings had to be present, and if they were, nothing was written. Every rule
// added to the template AFTER a project was scaffolded was therefore unreachable
// for that project forever. Measured: three of four registered children still
// excluded the hive outbox after the allowlist shipped.
//
// One function, two callers (scaffold and hive nurture). They must not grow
// separate ideas of what "already has the rules" means.

const MARKER = '# Evo-Lite runtime';

// A rule is a non-empty, non-comment line. Comments document intent rather than
// change behaviour, so they are never compared and never re-appended.
function ruleLines(text) {
    return String(text == null ? '' : text)
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
}

// Only the managed block is the mother's business. Anything above the marker
// (node_modules/, dist/, language-specific ignores) is the project's own and is
// never synced — a child is not obliged to share the mother's general ignores.
function managedRules(templateText) {
    const text = String(templateText == null ? '' : templateText);
    const at = text.indexOf(MARKER);
    return ruleLines(at === -1 ? text : text.slice(at));
}

// Rules the template declares that the project does not have anywhere in its
// file — deliberately whole-file, not block-scoped: a project that moved a rule
// outside the block still HAS that rule, and re-adding it would be noise.
function missingRules(currentText, templateText) {
    const have = new Set(ruleLines(currentText));
    return managedRules(templateText).filter(rule => !have.has(rule));
}

function appendRules(currentText, missing) {
    if (!missing || !missing.length) return currentText;
    const current = String(currentText == null ? '' : currentText);
    const separator = current.endsWith('\n') ? '' : '\n';
    return `${current}${separator}\n${MARKER} (rules added by a later Evo-Lite version)\n${missing.join('\n')}\n`;
}

module.exports = { MARKER, ruleLines, managedRules, missingRules, appendRules };
