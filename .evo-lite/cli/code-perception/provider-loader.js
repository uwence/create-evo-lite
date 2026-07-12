'use strict';

// provider-loader — allowlist-only instantiation of CodePerceptionProviders.
//
// Security-critical invariant (do NOT weaken):
//   Configuration may only SELECT a provider by `id` from the code-registered
//   `registry` (default DEFAULT_REGISTRY). It can never cause an arbitrary
//   module path to be require()d or arbitrary JS to run: a config-supplied
//   `module` / `path` / `require` / `factory` / `create` field is stripped by
//   sanitizeOptions() and is NEVER read, required, or executed by this file.
//   An unknown id is skipped with a diagnostic — nothing is required for it.
//
// Native Lite (role 'fallback') is always present in the returned
// registrations. A factory that throws during create() is isolated to a
// `provider-load-failed` diagnostic; every other selection still loads.
// loadProviders() itself never throws.

const DEFAULT_REGISTRY = Object.freeze({
    'provider:native-lite': { role: 'fallback', create: () => require('./native-lite').create() },
});

// Keys that must never survive into a registration's `options`: any of these
// could otherwise be used to smuggle a code path or a substitute factory.
const STRIPPED_OPTION_KEYS = ['id', 'enabled', 'role', 'module', 'path', 'require', 'factory', 'create'];

function sanitizeOptions(entry) {
    const options = Object.assign({}, entry);
    for (const key of STRIPPED_OPTION_KEYS) {
        delete options[key];
    }
    return options;
}

function loadProviders(config, opts) {
    const cfg = config || {};
    const reg = (opts && opts.registry) || DEFAULT_REGISTRY;
    const cfgProviders = (cfg.codePerception && Array.isArray(cfg.codePerception.providers))
        ? cfg.codePerception.providers
        : [];

    const diagnostics = [];
    const selections = [];

    for (const entry of cfgProviders) {
        if (!entry || entry.enabled === false) {
            continue;
        }
        const id = entry.id;
        const regEntry = reg[id];
        if (!regEntry) {
            diagnostics.push({
                code: 'unknown-provider',
                message: `unknown provider id: ${id}`,
                providerId: id,
            });
            continue;
        }
        selections.push({
            id,
            role: entry.role || regEntry.role,
            source: 'configured',
            options: sanitizeOptions(entry),
        });
    }

    // Always ensure native-lite is present (fallback), unless config already
    // selected it — in which case that single configured selection stands.
    if (reg['provider:native-lite'] && !selections.some(s => s.id === 'provider:native-lite')) {
        selections.push({
            id: 'provider:native-lite',
            role: reg['provider:native-lite'].role,
            source: 'builtin',
            options: {},
        });
    }

    const registrations = [];
    for (const selection of selections) {
        const regEntry = reg[selection.id];
        try {
            const provider = regEntry.create();
            registrations.push({
                provider,
                role: selection.role,
                source: selection.source,
                options: selection.options,
            });
        } catch (err) {
            diagnostics.push({
                code: 'provider-load-failed',
                message: String((err && err.message) || err),
                providerId: selection.id,
            });
        }
    }

    return { registrations, diagnostics };
}

module.exports = {
    DEFAULT_REGISTRY,
    loadProviders,
};
