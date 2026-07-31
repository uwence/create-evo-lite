'use strict';
// Windows non-ASCII collection-path containment classifier.
//
// Frozen contract: docs/specs/zvec-win-unicode-containment.md §5.
// Evidence:        docs/validation/zvec-win-unicode-path-matrix.md
//
// WHY THIS EXISTS
// On Windows, @zvec/zvec 0.6.0 terminates the process with 0xC0000409
// (STATUS_STACK_BUFFER_OVERRUN) for some non-ASCII collection paths. That is an
// uncatchable native fail-fast: JavaScript never regains control, so no
// try/catch and no error handler can contain it. The only containment available
// to us is to decide BEFORE `require('@zvec/zvec')` ever happens (I1).
//
// The trigger condition did NOT converge under four rounds of probing (§3.1):
// `虜-golf` (one Han char + ASCII, 8 bytes) crashes while `氵扌-项目` (13 bytes)
// does not. Therefore this module is a WHITELIST, never a blacklist (I7), and it
// is a *supported profile*, not a theorem: "not proven dangerous" is not "safe".
//
// LAYERING (§5.0) — the two layers exist because the invariants conflict:
//   Layer 1 classifyLexical()  pure predicate; no FS, no zvec (I4/I5)
//   Layer 2 evaluateProfile()  read-only FS probing; never writes (I6)
//   SAFE only when both pass; everything else is UNKNOWN, handled as unsafe (I3)
//
// `UNSAFE` is a reserved value this implementation NEVER produces (§5.2) —
// producing it would require a stable, generalizable upstream contract we do not
// have. The crash-corpus contract test therefore asserts `verdict !== 'SAFE'`,
// not `verdict === 'UNSAFE'`.
//
// This module must never require('@zvec/zvec') or ./memory-index-zvec — doing so
// would defeat its own purpose, since the load itself is on the dangerous side of
// the boundary. Requiring 'fs'/'path' is a module load, not a filesystem access;
// the lexical layer performs zero FS calls.

const win32 = require('path').win32;

// Windows path grammar is parsed with path.win32 explicitly, never the ambient
// `path`. A classifier whose answer depends on the OS running the TEST would be
// untestable on Linux CI, where these very strings are ordinary filenames.

const LEXICAL_VERDICT = { ELIGIBLE: 'LEXICALLY_ELIGIBLE', UNKNOWN: 'UNKNOWN' };

// §5.1 Layer 1 character set. Space is inside the set on purpose (`Program
// Files` is an ordinary ASCII path); trailing spaces are rejected per-segment
// below, which is the actual Windows hazard.
const SUPPORTED_CHARS = /^[A-Za-z0-9_\-.\\/: ]+$/;
const DRIVE_ABSOLUTE = /^[A-Za-z]:[\\/]/;
const RESERVED_DEVICE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
function lexEligible(reason) {
    return { verdict: LEXICAL_VERDICT.ELIGIBLE, reason };
}

function lexUnknown(reason) {
    return { verdict: LEXICAL_VERDICT.UNKNOWN, reason };
}

/**
 * Layer 1: pure lexical classification of the exact string that would be handed
 * to ZVecOpen/ZVecCreateAndOpen (I10 — not the "project path", not the "user
 * path"). No filesystem access, no zvec load, no side effects.
 *
 * @param {string} collectionPath
 * @param {string} [platform] defaults to process.platform; pass explicitly in tests
 * @returns {{verdict: string, reason: string}}
 */
function classifyLexical(collectionPath, platform) {
    const plat = platform === undefined ? process.platform : platform;
    // I9: non-Windows behaviour is unchanged. The fail-fast is a Windows native
    // fault; widening containment to other platforms would be scope creep with a
    // real cost (needless sqlite degradation on Linux/macOS).
    if (plat !== 'win32') return lexEligible('lexical:non-win32-platform');

    if (typeof collectionPath !== 'string' || collectionPath.length === 0) {
        return lexUnknown('lexical:not-a-non-empty-string');
    }

    // Namespace prefixes are checked before the character set so the reason names
    // the actual disqualifier rather than "some character is out of range".
    if (collectionPath.startsWith('\\\\?\\')) return lexUnknown('lexical:extended-length-prefix');
    if (collectionPath.startsWith('\\\\.\\')) return lexUnknown('lexical:device-namespace');
    if (collectionPath.startsWith('\\??\\')) return lexUnknown('lexical:nt-namespace');
    if (/^[\\/]{2}/.test(collectionPath)) return lexUnknown('lexical:unc-or-double-root');

    if (!SUPPORTED_CHARS.test(collectionPath)) {
        return lexUnknown('lexical:character-outside-supported-ascii-set');
    }
    if (!DRIVE_ABSOLUTE.test(collectionPath)) {
        return lexUnknown('lexical:not-a-local-drive-absolute-path');
    }

    const tail = collectionPath.slice(3);
    if (tail.length === 0) return lexUnknown('lexical:drive-root-has-no-collection-segment');

    for (const segment of tail.split('\\')) {
        // Empty segment == duplicated separator, or a trailing separator. Both
        // mean the caller and the OS may disagree about the target, so: UNKNOWN.
        if (segment.length === 0) return lexUnknown('lexical:empty-or-duplicated-separator');
        if (segment === '.' || segment === '..') return lexUnknown('lexical:relative-segment');
        if (segment.endsWith(' ')) return lexUnknown('lexical:trailing-space-in-segment');
        if (segment.endsWith('.')) return lexUnknown('lexical:trailing-dot-in-segment');
        // Any colon past the drive letter is an alternate data stream (or worse).
        if (segment.includes(':')) return lexUnknown('lexical:alternate-data-stream-or-stray-colon');
        // Windows reserves device names with ANY extension, so compare the stem.
        if (RESERVED_DEVICE.test(segment.split('.')[0])) return lexUnknown('lexical:reserved-device-name');
    }

    // Catch-all for anything the explicit segment rules above did not name:
    // forward slashes, residual `..`, redundant separators. Compared against
    // path.win32 so the answer is host-OS independent.
    if (collectionPath !== win32.normalize(collectionPath)) {
        return lexUnknown('lexical:not-normalized');
    }

    return lexEligible('lexical:supported-ascii-profile');
}

module.exports = {
    classifyLexical,
    LEXICAL_VERDICT,
};
