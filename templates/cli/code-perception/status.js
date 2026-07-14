'use strict';

// code-perception status — READ-only aggregation surface.
//
// Pure aggregation over sub-spec ①'s router candidates: builds a providers
// table, emits MANUAL-sync stale hints (advising the user to run
// `codegraph sync` themselves — this module NEVER spawns anything), and
// summarizes governance link counts.
//
// No subprocess spawning, no fs, no network. Never throws: malformed input
// degrades to a best-effort report plus diagnostics.

function emptyLinkSummary() {
    return { confirmed: 0, derived: 0, proposed: 0 };
}

function summarizeLinks(links) {
    if (links === undefined || links === null) {
        return emptyLinkSummary();
    }
    if (Array.isArray(links)) {
        const summary = emptyLinkSummary();
        for (const link of links) {
            const status = link && link.status;
            if (status === 'confirmed' || status === 'derived' || status === 'proposed') {
                summary[status] += 1;
            }
        }
        return summary;
    }
    // Pre-summarized { confirmed, derived, proposed } — pass through, coercing
    // missing/invalid fields to 0 rather than trusting arbitrary input shape.
    return {
        confirmed: Number.isFinite(links.confirmed) ? links.confirmed : 0,
        derived: Number.isFinite(links.derived) ? links.derived : 0,
        proposed: Number.isFinite(links.proposed) ? links.proposed : 0,
    };
}

function pushDiagnostics(target, diagnosticsArr, providerId) {
    if (!Array.isArray(diagnosticsArr)) {
        return;
    }
    for (const diag of diagnosticsArr) {
        if (!diag) {
            continue;
        }
        target.push({
            code: diag.code,
            message: diag.message,
            providerId: diag.providerId || providerId,
        });
    }
}

function isStale(status) {
    if (!status) {
        return false;
    }
    if (status.indexState === 'stale') {
        return true;
    }
    const indexed = status.indexedCommit;
    const current = status.currentCommit;
    if (indexed !== undefined && indexed !== null && current !== undefined && current !== null && indexed !== current) {
        return true;
    }
    return false;
}

function buildProviderRow(candidate, diagnostics) {
    const registration = candidate.registration;
    const availability = candidate.availability;
    const status = candidate.status;

    const id = (registration && registration.provider && registration.provider.id)
        ?? (status && status.providerId)
        ?? 'unknown';
    const role = candidate.role ?? (registration && registration.role) ?? 'unknown';
    const available = Boolean(availability && availability.available === true);
    const ready = Boolean(availability && availability.ready === true);
    const indexState = (status && status.indexState) ?? (availability && availability.indexState) ?? 'unknown';
    const compatibility = (status && status.compatibility) ?? 'unknown';
    const degraded = !ready || role === 'fallback';

    const row = { id, role, available, ready, indexState, compatibility, degraded };
    const reason = availability && availability.reason;
    if (reason) {
        row.reason = reason;
    }

    pushDiagnostics(diagnostics, candidate.diagnostics, id);
    pushDiagnostics(diagnostics, status && status.diagnostics, id);

    return row;
}

function buildStaleHint(row, status) {
    if (row.indexState === 'not-required') {
        return null;
    }
    if (!isStale(status)) {
        return null;
    }
    const indexedCommit = (status && status.indexedCommit) ?? null;
    const currentCommit = (status && status.currentCommit) ?? null;
    return {
        providerId: row.id,
        indexedCommit,
        currentCommit,
        message: `Provider ${row.id} index is stale (indexed ${indexedCommit} vs current ${currentCommit}); run 'codegraph sync' manually to refresh.`,
    };
}

function buildCodePerceptionStatus(context, options) {
    const providers = [];
    const staleHints = [];
    const diagnostics = [];

    try {
        const opts = options || {};
        const candidates = Array.isArray(opts.candidates) ? opts.candidates : [];

        for (const candidate of candidates) {
            if (!candidate || typeof candidate !== 'object') {
                diagnostics.push({ code: 'malformed-candidate', message: 'candidate is not an object' });
                continue;
            }

            let row;
            try {
                row = buildProviderRow(candidate, diagnostics);
            } catch (err) {
                diagnostics.push({
                    code: 'malformed-candidate',
                    message: err && err.message ? String(err.message) : String(err),
                });
                continue;
            }

            providers.push(row);

            try {
                const hint = buildStaleHint(row, candidate.status);
                if (hint) {
                    staleHints.push(hint);
                }
            } catch (err) {
                diagnostics.push({
                    code: 'stale-hint-failed',
                    message: err && err.message ? String(err.message) : String(err),
                    providerId: row.id,
                });
            }
        }

        const links = summarizeLinks(opts.links);

        return { providers, staleHints, links, diagnostics };
    } catch (err) {
        diagnostics.push({
            code: 'status-build-failed',
            message: err && err.message ? String(err.message) : String(err),
        });
        return { providers, staleHints, links: emptyLinkSummary(), diagnostics };
    }
}

module.exports = { buildCodePerceptionStatus };
