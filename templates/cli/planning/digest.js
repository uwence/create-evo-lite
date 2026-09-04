'use strict';

// Rendering for drift findings.
//
// Every finding used to be printed in full, so a routine commit emitted ~80
// lines in which R008 alone accounted for 72. Nothing in that wall is wrong,
// but a reader who must scroll past it every commit stops reading it, and the
// signal that DOES need a decision (R011, say) is buried in the middle.
//
// This does NOT invent a severity ranking. `level` already exists on every
// finding, and no drift rule blocks anything — `release-preflight` reads
// `spec.releaseBlocking` and never consults this report. So inventing
// "blocking vs advisory" here would be a judgement without an authority.
// Instead: errors stay verbatim (they are few and they are the level the
// producer already marked as most severe), everything else collapses to one
// line per rule with its count, and `--verbose` restores the full list.

function digestFindings(findings, options = {}) {
    const list = Array.isArray(findings) ? findings : [];
    if (list.length === 0) return [];
    if (options.verbose) return renderEach(list);

    const errors = list.filter(f => f.level === 'error');
    const rest = list.filter(f => f.level !== 'error');
    const lines = renderEach(errors);

    // One line per rule, in descending count: the shape of the backlog at a
    // glance. Order by count so the largest debt is not hidden below a rule
    // with two findings.
    const byRule = new Map();
    for (const f of rest) {
        const seen = byRule.get(f.rule) || { rule: f.rule, count: 0, levels: new Set(), sample: f };
        seen.count += 1;
        seen.levels.add(f.level);
        byRule.set(f.rule, seen);
    }
    const groups = [...byRule.values()].sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule));
    for (const g of groups) {
        const levels = [...g.levels].sort().join('/');
        const one = g.count === 1 ? `: ${g.sample.message}` : '';
        lines.push(`[${levels}] ${g.rule}: ${g.count}${one}`);
    }
    if (rest.length) {
        lines.push(`  → ${rest.length} finding(s) collapsed; re-run with --verbose for the full list`);
    }
    return lines;
}

function renderEach(list) {
    const lines = [];
    for (const f of list) {
        lines.push(`[${f.level}] ${f.rule}: ${f.message}`);
        if (f.suggestedAction) lines.push(`  → ${f.suggestedAction}`);
    }
    return lines;
}

module.exports = { digestFindings };
