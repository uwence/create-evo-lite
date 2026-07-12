'use strict';

// provider-router — two-phase capability routing over CodePerceptionProviders.
//
// Phase 1 (async): inspectProviders() awaits each registration's check() +
// getStatus() and isolates any throw into a diagnostic candidate. It never
// throws itself.
//
// Phase 2 (pure/sync): selectProvider() is a PURE, SYNCHRONOUS decision over
// already-built candidates — no await, no I/O, no Date/random — so it can be
// exhaustively unit-tested with hand-built candidates.
//
// No-silent-capability-substitution (ready-centric) invariant: if no ready
// provider exposes the requested capability, selectProvider returns
// candidate:null with the EXACT reason `No ready provider exposes
// ${capability} analysis`. It never wraps a lesser capability (e.g. a file
// listing) as a stand-in for the requested one.

function errText(err) {
    return err && err.message ? String(err.message) : String(err);
}

async function inspectProviders(registrations, context) {
    const candidates = [];
    for (const registration of registrations) {
        let availability;
        let status;
        const diagnostics = [];

        try {
            availability = await registration.provider.check(context);
        } catch (err) {
            availability = {
                available: false,
                ready: false,
                indexState: 'unknown',
                reason: errText(err),
            };
            diagnostics.push({
                code: 'check-failed',
                message: errText(err),
                providerId: registration.provider.id,
            });
        }

        try {
            status = await registration.provider.getStatus(context);
        } catch (err) {
            status = null;
            diagnostics.push({
                code: 'status-failed',
                message: errText(err),
                providerId: registration.provider.id,
            });
        }

        candidates.push({
            registration,
            role: registration.role,
            availability,
            status,
            diagnostics,
        });
    }
    return candidates;
}

function freshnessRank(cand) {
    const freshness = cand.status && cand.status.freshness;
    if (freshness === 'fresh') {
        return 0;
    }
    if (freshness === 'unknown') {
        return 1;
    }
    if (freshness === 'stale') {
        return 2;
    }
    return 3;
}

function roleRank(cand) {
    if (cand.role === 'structural-primary') {
        return 0;
    }
    if (cand.role === 'fallback') {
        return 2;
    }
    return 1;
}

function isFallback(cand) {
    return cand.role === 'fallback';
}

function supports(cand, capability) {
    return Boolean(cand.status && cand.status.capabilities && cand.status.capabilities[capability] === true);
}

function isReady(cand) {
    return Boolean(cand.availability && cand.availability.ready === true);
}

function isUsable(cand, capability) {
    return isReady(cand) && supports(cand, capability);
}

// Stable sort by [roleRank, freshnessRank] ascending.
function sortByRoleThenFreshness(cands) {
    return cands
        .map((cand, index) => ({ cand, index }))
        .sort((a, b) => {
            const roleDiff = roleRank(a.cand) - roleRank(b.cand);
            if (roleDiff !== 0) {
                return roleDiff;
            }
            const freshDiff = freshnessRank(a.cand) - freshnessRank(b.cand);
            if (freshDiff !== 0) {
                return freshDiff;
            }
            return a.index - b.index;
        })
        .map(entry => entry.cand);
}

function sortByFreshness(cands) {
    return cands
        .map((cand, index) => ({ cand, index }))
        .sort((a, b) => {
            const freshDiff = freshnessRank(a.cand) - freshnessRank(b.cand);
            if (freshDiff !== 0) {
                return freshDiff;
            }
            return a.index - b.index;
        })
        .map(entry => entry.cand);
}

function selectProvider(request, candidates) {
    const diagnostics = [];
    const cands = Array.isArray(candidates) ? candidates : [];
    const capability = request.capability;

    // 1-2. preferredProvider.
    if (request.preferredProvider) {
        const preferred = cands.find(c => c.registration && c.registration.provider && c.registration.provider.id === request.preferredProvider);
        if (!preferred) {
            diagnostics.push({ code: 'preferred-not-registered', providerId: request.preferredProvider });
            if (request.allowFallback === false) {
                return {
                    candidate: null,
                    degraded: false,
                    diagnostics,
                    reason: 'Preferred provider not available and fallback disabled',
                };
            }
        } else if (!isUsable(preferred, capability)) {
            diagnostics.push({ code: 'preferred-unusable', providerId: request.preferredProvider });
            if (request.allowFallback === false) {
                return {
                    candidate: null,
                    degraded: false,
                    diagnostics,
                    reason: 'Preferred provider not ready and fallback disabled',
                };
            }
        } else {
            return { candidate: preferred, degraded: false, diagnostics };
        }
    }

    // 3. Structural (non-fallback) selection.
    const usableNonFallback = cands.filter(c => isUsable(c, capability) && !isFallback(c));
    if (usableNonFallback.length > 0) {
        const sorted = sortByRoleThenFreshness(usableNonFallback);
        return { candidate: sorted[0], degraded: false, diagnostics };
    }

    // 4. Fallback (degraded) — only when fallback is allowed.
    if (request.allowFallback !== false) {
        const usableFallback = cands.filter(c => isUsable(c, capability) && isFallback(c));
        if (usableFallback.length > 0) {
            const sorted = sortByFreshness(usableFallback);
            diagnostics.push({
                code: 'degraded-fallback',
                message: 'Using fallback provider',
                providerId: sorted[0].registration.provider.id,
            });
            return { candidate: sorted[0], degraded: true, diagnostics };
        }
    }

    // 5. No ready provider exposes the capability — no silent substitution.
    return {
        candidate: null,
        degraded: true,
        diagnostics,
        reason: 'No ready provider exposes ' + capability + ' analysis',
    };
}

module.exports = { inspectProviders, selectProvider };
