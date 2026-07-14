'use strict';

// Governance Linker — reference-resolved links between governance entities
// (planning tasks, acceptance dependencies, commits) and code references.
//
// Layer 1 (exact, confidence 1.0): declares_file, depends_on_file,
// changed_by_commit — reference resolution is an EXACT normalized filePath
// match against the caller-provided `fileReferences` (CodeReference[]).
//
// Layer 2 (rule-gated symbol/evidence/focus links) added by cg-linker-symbol:
//   - implements_task (status 'derived'): emitted for a (task, symbolReference)
//     pair ONLY when a STRONG rule holds (plan names the symbol via explicit
//     task.symbols, evidence names the symbol, or a commit diff-range
//     intersects the symbol's lineRange AND that commit is tied to the task
//     via an evidence row). A symbol matching NO rule gets NO link — this
//     layer never blanket-links every symbol in a linked file to a task.
//   - verified_by_test / evidenced_by_archive (status 'confirmed', 1.0): from
//     `evidence` rows, but ONLY when the row carries (or resolves to) a real
//     codeReferenceId.
//   - related_to_focus (status 'derived', 1.0): from PRE-RESOLVED
//     `focusReferences` ONLY. A raw free-text `activeContextFocus` is never
//     accepted/parsed here.
//
// Layer 3 (name-only heuristic proposals) added by cg-linker-heuristic:
//   - implements_task (status 'proposed', confidence <= 0.5): the WEAKEST
//     signal — task.title (lowercased) contains a symbolReference's name
//     (lowercased, length >= 3). A loose textual signal ONLY; NEVER emitted
//     as confirmed/derived. When a heuristic proposal collides (same id —
//     same governanceEntityId+codeReferenceId+kind) with a stronger
//     confirmed/derived link, the strength-ranked dedupe below keeps the
//     stronger link and drops the proposal.
//
// Dedupe is strength-ranked, not first-wins: for links sharing the same id,
// the highest-ranked status survives (confirmed > derived > proposed) so a
// name-only proposal can never shadow a rule-gated or exact link.
//
// No dangling links, no guessing: every emitted link's codeReferenceId is a
// real id — resolved from a fileReferences match, a symbolReference.reference.id,
// an evidence.codeReferenceId/resolved evidence.filePath, or a
// focusReference.codeReferenceId. A reference that can't resolve produces an
// 'unresolved-code-reference' diagnostic and NEVER a link.
//
// No guessing from Markdown/text: depends_on_file comes ONLY from the
// explicit `acceptanceDependencies` input; implements_task never parses plan
// Markdown (only an explicit task.symbols array, evidence.symbols, a tied
// commit diff-range, or the Layer-3 title/name heuristic counts).
//
// Never throws: missing/undefined inputs degrade to { links: [], diagnostics: [] };
// a malformed task/dep/commit/symbolReference/evidence/focusReference row
// contributes a diagnostic (or is silently skipped), never a throw.
//
// buildGovernanceLinks stays PURE — no fs. persistGovernanceLinks (below) is
// a SEPARATE export and the ONLY fs in this module: it serializes an
// already-computed links array to the §3.4 stored graph, atomically and
// deterministically. It never computes links itself.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VALID_KINDS = new Set([
    'declares_file', 'depends_on_file', 'implements_task', 'changed_by_commit',
    'verified_by_test', 'evidenced_by_archive', 'related_to_focus',
]);
const VALID_STATUSES = new Set(['confirmed', 'derived', 'proposed']);
const STATUS_RANK = { confirmed: 3, derived: 2, proposed: 1 };

function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampConfidence(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

// Two inclusive ranges [a,b] and [c,d] intersect iff a <= d && c <= b.
function rangesIntersect(a, b, c, d) {
    return a <= d && c <= b;
}

function diag(code, message, providerId) {
    const d = { code, message: message || code };
    if (providerId !== undefined) d.providerId = providerId;
    return d;
}

// Backslashes -> forward slashes; strip a single leading './'.
function normalizePath(p) {
    return String(p).replace(/\\/g, '/').replace(/^\.\//, '');
}

// Builds a normalizedPath -> reference.id lookup. First reference wins on
// duplicate paths. References without a filePath are skipped.
function buildReferenceIndex(fileReferences) {
    const index = new Map();
    const refs = Array.isArray(fileReferences) ? fileReferences : [];
    for (const ref of refs) {
        if (!isPlainObject(ref)) continue;
        if (ref.filePath === undefined || ref.filePath === null) continue;
        const key = normalizePath(ref.filePath);
        if (!index.has(key)) index.set(key, ref.id);
    }
    return index;
}

function makeLinkId(governanceEntityId, codeReferenceId, kind) {
    const raw = `${governanceEntityId}|${codeReferenceId}|${kind}`;
    const tail = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
    return `gov-link:${tail}`;
}

function makeLink(governanceEntityId, codeReferenceId, kind, evidence) {
    const link = {
        id: makeLinkId(governanceEntityId, codeReferenceId, kind),
        governanceEntityId,
        codeReferenceId,
        kind,
        status: 'confirmed',
        confidence: 1.0,
        evidence: {},
    };
    if (isPlainObject(evidence)) {
        for (const key of Object.keys(evidence)) {
            if (evidence[key] !== undefined) link.evidence[key] = evidence[key];
        }
    }
    return link;
}

// declares_file: task.linkedFiles from the Planning IR.
function collectDeclaresFileLinks(planIR, resolveRef, links, diagnostics) {
    const tasks = isPlainObject(planIR) && Array.isArray(planIR.tasks) ? planIR.tasks : [];
    for (const task of tasks) {
        if (!isPlainObject(task)) continue;
        const linkedFiles = Array.isArray(task.linkedFiles) ? task.linkedFiles : [];
        for (const f of linkedFiles) {
            try {
                const codeReferenceId = resolveRef(f);
                if (!codeReferenceId) {
                    diagnostics.push(diag(
                        'unresolved-code-reference',
                        `declares_file: no fileReference for ${f} (task ${task.id})`,
                    ));
                    continue;
                }
                links.push(makeLink(task.id, codeReferenceId, 'declares_file', { sourcePath: task.sourcePath }));
            } catch (err) {
                diagnostics.push(diag('governance-linker-error', `declares_file: ${err && err.message ? err.message : String(err)}`));
            }
        }
    }
}

// depends_on_file: ONLY from the explicit acceptanceDependencies input —
// NEVER inferred/parsed from task/spec/plan data.
function collectDependsOnFileLinks(acceptanceDependencies, resolveRef, links, diagnostics) {
    const deps = Array.isArray(acceptanceDependencies) ? acceptanceDependencies : [];
    for (const dep of deps) {
        if (!isPlainObject(dep)) continue;
        try {
            const codeReferenceId = resolveRef(dep.filePath);
            if (!codeReferenceId) {
                diagnostics.push(diag(
                    'unresolved-code-reference',
                    `depends_on_file: no fileReference for ${dep.filePath} (governanceEntity ${dep.governanceEntityId})`,
                ));
                continue;
            }
            links.push(makeLink(dep.governanceEntityId, codeReferenceId, 'depends_on_file', { sourcePath: dep.sourcePath }));
        } catch (err) {
            diagnostics.push(diag('governance-linker-error', `depends_on_file: ${err && err.message ? err.message : String(err)}`));
        }
    }
}

// changed_by_commit: commit.changedFiles -> governanceEntityId 'commit:<sha>'.
function collectChangedByCommitLinks(commits, resolveRef, links, diagnostics) {
    const list = Array.isArray(commits) ? commits : [];
    for (const commit of list) {
        if (!isPlainObject(commit)) continue;
        const changedFiles = Array.isArray(commit.changedFiles) ? commit.changedFiles : [];
        for (const f of changedFiles) {
            try {
                const codeReferenceId = resolveRef(f);
                if (!codeReferenceId) {
                    diagnostics.push(diag(
                        'unresolved-code-reference',
                        `changed_by_commit: no fileReference for ${f} (commit ${commit.sha})`,
                    ));
                    continue;
                }
                links.push(makeLink(`commit:${commit.sha}`, codeReferenceId, 'changed_by_commit', { commitSha: commit.sha }));
            } catch (err) {
                diagnostics.push(diag('governance-linker-error', `changed_by_commit: ${err && err.message ? err.message : String(err)}`));
            }
        }
    }
}

// implements_task (status 'derived'): rule-gated symbol-level links. Emitted
// for a (task, symbolReference) pair ONLY when a STRONG rule holds:
//   1. Plan names the symbol: task.symbols (explicit array) includes the
//      symbol's name.
//   2. Evidence names the symbol: an evidence row with taskId===task.id has
//      a symbols array including the symbol's name.
//   3. Commit diff-range intersects the symbol's lineRange, AND that commit
//      is tied to the task via an evidence row (evidence.taskId===task.id
//      && evidence.commitSha===commit.sha). A bare commit/symbol
//      intersection with no task tie emits nothing here (file-granularity
//      changed_by_commit already covers the untied case).
// A symbolReference matching none of the rules for a task gets NO link —
// this never blanket-links every symbol in a linked file to a task.
function collectImplementsTaskSymbolLinks(planIR, symbolReferences, evidence, commits, links, diagnostics) {
    const tasks = isPlainObject(planIR) && Array.isArray(planIR.tasks) ? planIR.tasks : [];
    const rawSymRefs = Array.isArray(symbolReferences) ? symbolReferences : [];
    const evidenceList = Array.isArray(evidence) ? evidence : [];
    const commitList = Array.isArray(commits) ? commits : [];

    // Validate symbol references once; malformed rows -> diagnostic, skipped.
    const validSymRefs = [];
    for (const symRef of rawSymRefs) {
        if (!isPlainObject(symRef) || !isPlainObject(symRef.reference) || !symRef.reference.id) {
            diagnostics.push(diag('malformed-symbol-reference', 'symbolReference is missing a resolvable reference.id'));
            continue;
        }
        validSymRefs.push(symRef);
    }

    const commitsBySha = new Map();
    for (const commit of commitList) {
        if (isPlainObject(commit) && commit.sha !== undefined) commitsBySha.set(commit.sha, commit);
    }

    for (const task of tasks) {
        if (!isPlainObject(task) || task.id === undefined) continue;
        try {
            const taskSymbols = Array.isArray(task.symbols) ? task.symbols : [];
            const taskEvidence = evidenceList.filter(e => isPlainObject(e) && e.taskId === task.id);
            const evidenceSymbolNames = new Set();
            const tiedCommitShas = new Set();
            for (const e of taskEvidence) {
                if (Array.isArray(e.symbols)) {
                    for (const name of e.symbols) evidenceSymbolNames.add(name);
                }
                if (e.commitSha !== undefined) tiedCommitShas.add(e.commitSha);
            }

            for (const symRef of validSymRefs) {
                const name = symRef.reference.name;
                let matched = taskSymbols.includes(name) || evidenceSymbolNames.has(name);

                if (!matched && Array.isArray(symRef.lineRange) && symRef.lineRange.length === 2) {
                    const symPath = normalizePath(symRef.filePath);
                    const [symStart, symEnd] = symRef.lineRange;
                    for (const sha of tiedCommitShas) {
                        const commit = commitsBySha.get(sha);
                        if (!commit) continue;
                        const changedFiles = Array.isArray(commit.changedFiles) ? commit.changedFiles : [];
                        if (!changedFiles.some(f => normalizePath(f) === symPath)) continue;
                        const ranges = isPlainObject(commit.diffRanges) ? commit.diffRanges[symPath] : null;
                        if (!Array.isArray(ranges)) continue;
                        const intersects = ranges.some(r => (
                            Array.isArray(r) && r.length === 2 && rangesIntersect(r[0], r[1], symStart, symEnd)
                        ));
                        if (intersects) { matched = true; break; }
                    }
                }

                if (matched) {
                    const link = makeLink(task.id, symRef.reference.id, 'implements_task', {
                        sourcePath: task.sourcePath,
                        lineRange: symRef.lineRange,
                    });
                    link.status = 'derived';
                    link.confidence = clampConfidence(symRef.resolutionConfidence);
                    links.push(link);
                }
            }
        } catch (err) {
            diagnostics.push(diag('governance-linker-error', `implements_task(symbol): ${err && err.message ? err.message : String(err)}`));
        }
    }
}

// implements_task (status 'proposed', confidence 0.5): the WEAKEST layer —
// a name-only fuzzy match between a task's title and a symbol reference's
// name. task.title (lowercased) CONTAINS symbolReference.reference.name
// (lowercased, length >= 3 to avoid trivial matches). A loose textual
// signal ONLY: NEVER emitted as confirmed/derived, confidence capped at 0.5.
// A proposal that collides (same id) with a stronger rule's confirmed/derived
// link is dropped by the strength-ranked dedupe in buildGovernanceLinks —
// that is intended, not a bug.
function collectHeuristicLinks(planIR, symbolReferences, links, diagnostics) {
    const tasks = isPlainObject(planIR) && Array.isArray(planIR.tasks) ? planIR.tasks : [];
    const rawSymRefs = Array.isArray(symbolReferences) ? symbolReferences : [];

    for (const task of tasks) {
        if (!isPlainObject(task) || task.id === undefined) continue;
        if (typeof task.title !== 'string') continue;
        const titleLower = task.title.toLowerCase();
        try {
            for (const symRef of rawSymRefs) {
                if (!isPlainObject(symRef) || !isPlainObject(symRef.reference) || !symRef.reference.id) continue;
                const name = symRef.reference.name;
                if (typeof name !== 'string' || name.length < 3) continue;
                if (!titleLower.includes(name.toLowerCase())) continue;

                const link = makeLink(task.id, symRef.reference.id, 'implements_task', {
                    sourcePath: task.sourcePath,
                    heuristic: 'title-contains-symbol-name',
                });
                link.status = 'proposed';
                link.confidence = Math.min(0.5, clampConfidence(0.5));
                links.push(link);
            }
        } catch (err) {
            diagnostics.push(diag('governance-linker-error', `implements_task(heuristic): ${err && err.message ? err.message : String(err)}`));
        }
    }
}

// verified_by_test / evidenced_by_archive: from `evidence` rows, only when a
// real codeReferenceId can be resolved (explicit, or via evidence.filePath
// against fileReferences). No resolvable reference -> diagnostic, no link.
function collectEvidenceLinks(evidenceRows, resolveRef, links, diagnostics) {
    const rows = Array.isArray(evidenceRows) ? evidenceRows : [];
    for (const row of rows) {
        if (!isPlainObject(row)) {
            diagnostics.push(diag('malformed-evidence', 'evidence row is not an object'));
            continue;
        }
        try {
            let codeReferenceId = row.codeReferenceId;
            if (codeReferenceId === undefined || codeReferenceId === null) {
                codeReferenceId = resolveRef(row.filePath);
            }
            if (!codeReferenceId) {
                diagnostics.push(diag(
                    'unresolved-code-reference',
                    `evidence: no resolvable code reference (taskId ${row.taskId})`,
                ));
                continue;
            }
            const kind = row.kind === 'archive' ? 'evidenced_by_archive'
                : row.kind === 'test' ? 'verified_by_test'
                    : null;
            if (!kind) {
                diagnostics.push(diag('malformed-evidence', `evidence: unrecognized kind ${row.kind} (taskId ${row.taskId})`));
                continue;
            }
            links.push(makeLink(row.taskId, codeReferenceId, kind, {
                sourcePath: row.sourcePath,
                archivePath: row.archivePath,
            }));
        } catch (err) {
            diagnostics.push(diag('governance-linker-error', `evidence: ${err && err.message ? err.message : String(err)}`));
        }
    }
}

// related_to_focus: from PRE-RESOLVED `focusReferences` ONLY. Free-text
// activeContextFocus is never parsed/accepted here.
function collectFocusLinks(focusReferences, links, diagnostics) {
    const rows = Array.isArray(focusReferences) ? focusReferences : [];
    for (const row of rows) {
        if (!isPlainObject(row)) {
            diagnostics.push(diag('malformed-focus-reference', 'focusReference is not an object'));
            continue;
        }
        if (row.codeReferenceId === undefined || row.codeReferenceId === null) {
            diagnostics.push(diag(
                'unresolved-code-reference',
                `related_to_focus: focusReference missing codeReferenceId (governanceEntity ${row.governanceEntityId})`,
            ));
            continue;
        }
        try {
            const link = makeLink(row.governanceEntityId, row.codeReferenceId, 'related_to_focus', {});
            link.status = 'derived';
            links.push(link);
        } catch (err) {
            diagnostics.push(diag('governance-linker-error', `related_to_focus: ${err && err.message ? err.message : String(err)}`));
        }
    }
}

// Strength-ranked dedupe: for links sharing the same id, keep the HIGHEST
// STATUS_RANK (confirmed > derived > proposed). Ties (equal rank) keep the
// higher-confidence link, then the first-seen link. This ensures a
// 'proposed' heuristic can never shadow a 'confirmed'/'derived' link for the
// same (governanceEntityId, codeReferenceId, kind). Output is sorted by id
// for deterministic ordering.
function dedupeLinks(links) {
    const byId = new Map();
    for (const link of links) {
        if (!isPlainObject(link) || typeof link.id !== 'string') continue;
        const existing = byId.get(link.id);
        if (!existing) {
            byId.set(link.id, link);
            continue;
        }
        const existingRank = STATUS_RANK[existing.status] || 0;
        const candidateRank = STATUS_RANK[link.status] || 0;
        if (candidateRank > existingRank) {
            byId.set(link.id, link);
        } else if (candidateRank === existingRank && (link.confidence || 0) > (existing.confidence || 0)) {
            byId.set(link.id, link);
        }
        // else: candidate is weaker (or tied with lower/equal confidence) — keep existing
    }
    return Array.from(byId.values()).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Shape check: does `link` look like a valid GovernanceCodeLink?
function isValidLink(link) {
    if (!isPlainObject(link)) return false;
    if (typeof link.id !== 'string' || !link.id.startsWith('gov-link:')) return false;
    if (typeof link.governanceEntityId !== 'string' || link.governanceEntityId.length === 0) return false;
    if (typeof link.codeReferenceId !== 'string' || link.codeReferenceId.length === 0) return false;
    if (!VALID_KINDS.has(link.kind)) return false;
    if (!VALID_STATUSES.has(link.status)) return false;
    if (typeof link.confidence !== 'number' || !Number.isFinite(link.confidence) || link.confidence < 0 || link.confidence > 1) return false;
    if (!isPlainObject(link.evidence)) return false;
    return true;
}

// Recursively sort object keys so JSON.stringify produces a canonical,
// byte-identical representation for structurally-identical data regardless
// of key insertion order.
function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (isPlainObject(value)) {
        const out = {};
        for (const key of Object.keys(value).sort()) {
            out[key] = canonicalize(value[key]);
        }
        return out;
    }
    return value;
}

// persistGovernanceLinks(root, links) -> { path, written, count, diagnostics }
//
// The §3.4 stored graph writer — the ONLY fs in this module. Serializes an
// already-computed `links` array (from buildGovernanceLinks) to
// `<root>/.evo-lite/generated/code-perception/governance-links.json`.
//   - Deterministic: links sorted by id, all object keys canonicalized
//     (sorted), so two calls with the same links produce BYTE-IDENTICAL
//     output.
//   - Atomic: mkdir -p the parent, write a same-dir temp file, fs.renameSync
//     into place — never a half-written file.
//   - Never throws: an fs error degrades to { written:false,
//     diagnostics:[{code:'persist-failed', message}] }.
//   - Does NOT compute links — it only serializes what it is given.
function persistGovernanceLinks(root, links) {
    let targetDir = null;
    let targetPath = null;
    const diagnostics = [];
    let tmpPath = null;

    try {
        targetDir = path.join(String(root), '.evo-lite', 'generated', 'code-perception');
        targetPath = path.join(targetDir, 'governance-links.json');

        const safeLinks = Array.isArray(links) ? links : [];
        const sorted = safeLinks.slice().sort((a, b) => {
            const idA = isPlainObject(a) && typeof a.id === 'string' ? a.id : '';
            const idB = isPlainObject(b) && typeof b.id === 'string' ? b.id : '';
            return idA < idB ? -1 : idA > idB ? 1 : 0;
        });
        const payload = canonicalize({
            version: 'evo-code-graph@1',
            generatedCount: safeLinks.length,
            links: sorted,
        });
        const json = JSON.stringify(payload, null, 2);

        fs.mkdirSync(targetDir, { recursive: true });
        const rand = crypto.randomBytes(6).toString('hex');
        tmpPath = path.join(targetDir, `.governance-links.${process.pid}.${Date.now()}.${rand}.tmp`);
        fs.writeFileSync(tmpPath, json, 'utf8');
        fs.renameSync(tmpPath, targetPath);

        return { path: targetPath, written: true, count: safeLinks.length, diagnostics };
    } catch (err) {
        if (tmpPath) {
            try {
                fs.unlinkSync(tmpPath);
            } catch (cleanupErr) {
                // ignore — best-effort cleanup of the temp file
            }
        }
        diagnostics.push(diag('persist-failed', err && err.message ? err.message : String(err)));
        return { path: targetPath, written: false, count: 0, diagnostics };
    }
}

// buildGovernanceLinks(inputs) -> { links: GovernanceCodeLink[], diagnostics: [] }
//
// Handles the EXACT kinds (declares_file, depends_on_file, changed_by_commit)
// plus the rule-gated kinds (implements_task, verified_by_test,
// evidenced_by_archive, related_to_focus). All new inputs
// (symbolReferences/evidence/focusReferences; commits[].diffRanges) default
// to [] / absent and degrade gracefully — a raw `activeContextFocus` string
// is accepted as an input key but intentionally never read.
function buildGovernanceLinks(inputs) {
    const links = [];
    const diagnostics = [];

    try {
        const safeInputs = isPlainObject(inputs) ? inputs : {};
        const referenceIndex = buildReferenceIndex(safeInputs.fileReferences);
        const resolveRef = (filePath) => {
            if (filePath === undefined || filePath === null) return null;
            const key = normalizePath(filePath);
            return referenceIndex.has(key) ? referenceIndex.get(key) : null;
        };

        collectDeclaresFileLinks(safeInputs.planIR, resolveRef, links, diagnostics);
        collectDependsOnFileLinks(safeInputs.acceptanceDependencies, resolveRef, links, diagnostics);
        collectChangedByCommitLinks(safeInputs.commits, resolveRef, links, diagnostics);
        collectImplementsTaskSymbolLinks(safeInputs.planIR, safeInputs.symbolReferences, safeInputs.evidence, safeInputs.commits, links, diagnostics);
        collectHeuristicLinks(safeInputs.planIR, safeInputs.symbolReferences, links, diagnostics);
        collectEvidenceLinks(safeInputs.evidence, resolveRef, links, diagnostics);
        collectFocusLinks(safeInputs.focusReferences, links, diagnostics);
    } catch (err) {
        diagnostics.push(diag('governance-linker-error', err && err.message ? err.message : String(err)));
    }

    return { links: dedupeLinks(links), diagnostics };
}

module.exports = {
    normalizePath,
    buildGovernanceLinks,
    isValidLink,
    persistGovernanceLinks,
};
