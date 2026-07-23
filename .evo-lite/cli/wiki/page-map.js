'use strict';

// Unified page-path mapping for module/ and source/ pages (design §2.0).
// Windows-safe: the readable segment is whitelist-folded; uniqueness comes
// from a sha1 suffix. Collisions are detected on the CASE-FOLDED filename
// space and resolved by deterministically extending hash8 to the FULL hash —
// an existing assignment is never overwritten.

const crypto = require('node:crypto');

function normalizeRepoPath(p) {
    return String(p).replace(/\\/g, '/').replace(/^\.\//, '');
}

function readableSegment(raw) {
    const seg = String(raw).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return seg || 'x';
}

function fullHash(raw) {
    return crypto.createHash('sha1').update(String(raw), 'utf8').digest('hex');
}

function createPageMap(opts) {
    const hashFn = (opts && opts.hashFn) || fullHash;   // test seam: inject to force hash8 collisions
    const byKey = new Map();   // "<kind>\0<rawId>" -> page path
    const taken = new Map();   // case-folded page path -> owning key

    function assign(kind, rawId) {
        const key = `${kind}\x00${rawId}`;
        if (byKey.has(key)) return byKey.get(key);
        const hash = hashFn(rawId);
        let page = `${kind}/${readableSegment(rawId)}--${hash.slice(0, 8)}.html`;
        const owner = taken.get(page.toLowerCase());
        if (owner && owner !== key) {
            page = `${kind}/${readableSegment(rawId)}--${hash}.html`; // deterministic full-hash extension
            const owner2 = taken.get(page.toLowerCase());
            if (owner2 && owner2 !== key) throw new Error(`page-map: unresolvable collision for ${rawId}`);
        }
        taken.set(page.toLowerCase(), key);
        byKey.set(key, page);
        return page;
    }

    return {
        modulePage: id => assign('module', String(id)),
        sourcePage: p => assign('source', normalizeRepoPath(p)),
        modulePages: () => {
            const out = {};
            for (const [key, page] of byKey) {
                const idx = key.indexOf('\x00');
                if (key.slice(0, idx) === 'module') out[key.slice(idx + 1)] = page;
            }
            return out;
        },
    };
}

module.exports = { createPageMap, readableSegment, normalizeRepoPath, fullHash };
