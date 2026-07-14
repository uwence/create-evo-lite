'use strict';

// Governance Linker — reference-resolved links between governance entities
// (planning tasks, acceptance dependencies, commits) and code references.
// This first layer (buildGovernanceLinks) emits ONLY exact links at
// confidence 1.0: declares_file, depends_on_file, changed_by_commit.
//
// Reference resolution, no dangling links: every emitted link's
// codeReferenceId is resolved by an EXACT normalized filePath match against
// the caller-provided `fileReferences` (CodeReference[]). A path with no
// matching reference produces an 'unresolved-code-reference' diagnostic and
// NEVER a link — dangling links (a codeReferenceId that resolves to nothing)
// must not exist.
//
// No guessing from Markdown/text: depends_on_file comes ONLY from the
// explicit `acceptanceDependencies` input. The Planning IR does not carry
// acceptance dependsOn data (only task.linkedFiles), so this layer never
// parses spec/plan prose to invent dependency links.
//
// Never throws: missing/undefined inputs degrade to { links: [], diagnostics: [] };
// a malformed task/dep/commit contributes a diagnostic (or is silently
// skipped), never a throw.

const crypto = require('node:crypto');

function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function dedupeLinks(links) {
    const seen = new Set();
    const out = [];
    for (const link of links) {
        if (seen.has(link.id)) continue;
        seen.add(link.id);
        out.push(link);
    }
    return out;
}

// buildGovernanceLinks(inputs) -> { links: GovernanceCodeLink[], diagnostics: [] }
//
// This layer only handles the EXACT kinds (declares_file, depends_on_file,
// changed_by_commit). Extra input keys (symbolReferences/evidence/
// focusReferences) added by later linker layers are ignored, not errors.
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
    } catch (err) {
        diagnostics.push(diag('governance-linker-error', err && err.message ? err.message : String(err)));
    }

    return { links: dedupeLinks(links), diagnostics };
}

module.exports = {
    normalizePath,
    buildGovernanceLinks,
};
