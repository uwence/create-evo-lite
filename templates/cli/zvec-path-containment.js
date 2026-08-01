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

const fs = require('fs');
const win32 = require('path').win32;

// Windows path grammar is parsed with path.win32 explicitly, never the ambient
// `path`. A classifier whose answer depends on the OS running the TEST would be
// untestable on Linux CI, where these very strings are ordinary filenames.

const LEXICAL_VERDICT = { ELIGIBLE: 'LEXICALLY_ELIGIBLE', UNKNOWN: 'UNKNOWN' };
const PROFILE_VERDICT = { IN_PROFILE: 'IN_PROFILE', UNKNOWN: 'UNKNOWN' };
// UNSAFE is declared so consumers can switch exhaustively; see §5.2 for why it
// is never returned by this implementation.
const VERDICT = { SAFE: 'SAFE', UNKNOWN: 'UNKNOWN', UNSAFE: 'UNSAFE' };

// §5.1 Layer 1 character set. Space is inside the set on purpose (`Program
// Files` is an ordinary ASCII path); trailing spaces are rejected per-segment
// below, which is the actual Windows hazard.
const SUPPORTED_CHARS = /^[A-Za-z0-9_\-.\\/: ]+$/;
const DRIVE_ABSOLUTE = /^[A-Za-z]:[\\/]/;
const RESERVED_DEVICE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
// 8.3 alias form (`PROGRA~1`). Detected here, resolved nowhere: the short-name
// identity residual belongs to [attp-win83-canonical-root-identity], and this
// spec only requires that its presence force UNKNOWN.
const SHORT_NAME_8_3 = /^[^\\/:]{1,8}~[0-9]{1,3}(\.[^\\/:.]{1,3})?$/;

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

// Read-only probe surface. Injectable so the profile layer can be tested without
// building real junctions, and so a reviewer can assert by construction that no
// mutating call exists in the set.
//
// existsSync is deliberately NOT part of this set. It returns a bare boolean
// with no error channel, so "confirmed absent" and "exists but could not be
// probed" (EACCES/EPERM/EIO) both come back as `false`. Using it to decide
// where to stop walking the ancestor chain is fail-OPEN: an unprobeable
// ancestor would be mistaken for a not-yet-created suffix and skipped, and the
// path could still reach SAFE. lstatSync with throwIfNoEntry:false keeps the
// two cases apart — `undefined` means absent, a throw means unprobeable.
const DEFAULT_FS_OPS = Object.freeze({
    lstatSync: (p) => fs.lstatSync(p, { throwIfNoEntry: false }),
    // .native returns the canonical on-disk spelling, which is what makes 8.3
    // expansion and casing divergence observable at all.
    realpathSync: (p) => fs.realpathSync.native(p),
});

function profileIn(reason) {
    return { verdict: PROFILE_VERDICT.IN_PROFILE, reason };
}

function profileUnknown(reason, extra) {
    return Object.assign({ verdict: PROFILE_VERDICT.UNKNOWN, reason }, extra || {});
}

function probeFailed(op, target, err) {
    // §5.1: a probe that FAILS is not a probe that passed. Permission denied on
    // an ancestor tells us nothing about reparse points, so it is UNKNOWN.
    return profileUnknown(
        `profile:probe-failed:${op}:${(err && err.code) || 'UNKNOWN_ERROR'}`,
        { probeFailure: { op, target } },
    );
}

// ['C:\\', 'C:\\p', 'C:\\p\\.evo-lite', ...] — the collection itself included,
// because it may already exist and may itself be a reparse point.
function ancestorChain(collectionPath) {
    const root = collectionPath.slice(0, 3);
    const chain = [root];
    let current = root.replace(/\\+$/, '');
    for (const segment of collectionPath.slice(3).split('\\')) {
        current = `${current}\\${segment}`;
        chain.push(current);
    }
    return chain;
}

/**
 * Layer 2: read-only topology probing. Never writes, never loads zvec.
 * Any probe failure yields UNKNOWN rather than a pass.
 *
 * @param {string} collectionPath
 * @param {object} [fsOps] {lstatSync, realpathSync} — read-only by contract.
 *   lstatSync must return undefined for an absent entry and throw for any other
 *   failure; a probe that cannot distinguish those two is fail-open (see
 *   DEFAULT_FS_OPS).
 * @returns {{verdict: string, reason: string}}
 */
function evaluateProfile(collectionPath, fsOps) {
    const ops = fsOps || DEFAULT_FS_OPS;
    if (typeof collectionPath !== 'string' || !DRIVE_ABSOLUTE.test(collectionPath)) {
        return profileUnknown('profile:input-not-lexically-eligible');
    }

    // 8.3 aliases are a topology question (which long name does this alias?), so
    // §5.1 places them in Layer 2. Note that a LITERAL short name never reaches
    // here through classifyCollectionPath: '~' is outside the Layer 1 character
    // set, so `C:\PROGRA~1\...` is already UNKNOWN for a charset reason. This
    // check covers callers that invoke evaluateProfile() directly. On the
    // composite path the working 8.3 defense is the realpath divergence check
    // below, which catches a short name that the OS expands.
    for (const segment of collectionPath.slice(3).split('\\')) {
        if (SHORT_NAME_8_3.test(segment)) {
            return profileUnknown('profile:8dot3-short-name-alias-suspected');
        }
    }

    const chain = ancestorChain(collectionPath);
    let deepestExisting = null;
    for (const ancestor of chain) {
        let stat;
        try {
            stat = ops.lstatSync(ancestor);
        } catch (err) {
            // Could not be probed. Not knowing whether this ancestor is a
            // reparse point is exactly the case that must NOT continue.
            return probeFailed('lstatSync', ancestor, err);
        }
        // `undefined` is the ONLY value that means "confirmed absent" (Node's
        // throwIfNoEntry:false contract). Everything below the first absent
        // ancestor is a suffix the collection will create, so there is nothing
        // there to probe yet. Any other falsy value is an unusable probe result,
        // not an absence claim, and falls through to UNKNOWN below.
        if (stat === undefined) break;
        if (!stat || typeof stat.isSymbolicLink !== 'function') {
            return profileUnknown('profile:lstat-result-not-interpretable');
        }
        // Node reports Windows directory junctions as symbolic links, so this one
        // predicate covers both junction and symlink reparse points.
        if (stat.isSymbolicLink()) {
            return profileUnknown('profile:reparse-point-in-ancestor-chain', { at: ancestor });
        }
        deepestExisting = ancestor;
    }

    if (deepestExisting === null) {
        // Not even the drive root probed as existing. Nothing was verified, so
        // nothing may be claimed.
        return profileUnknown('profile:no-existing-ancestor-to-probe');
    }

    let real;
    try {
        real = ops.realpathSync(deepestExisting);
    } catch (err) {
        return probeFailed('realpathSync', deepestExisting, err);
    }
    if (typeof real !== 'string') return profileUnknown('profile:realpath-result-not-a-string');

    const realTrimmed = real.replace(/\\+$/, '');
    const inputTrimmed = deepestExisting.replace(/\\+$/, '');
    const resolvedFull = realTrimmed + collectionPath.slice(inputTrimmed.length);

    // The whole point: an ASCII-looking path may resolve to a non-ASCII target.
    // Re-run Layer 1 on what the OS says the path really is.
    const lexicalOfReal = classifyLexical(resolvedFull, 'win32');
    if (lexicalOfReal.verdict !== LEXICAL_VERDICT.ELIGIBLE) {
        return profileUnknown('profile:realpath-target-not-lexically-eligible', {
            resolvedReason: lexicalOfReal.reason,
        });
    }

    // Case-insensitive because Windows path comparison is; any REMAINING
    // difference means something was rewritten (8.3 expansion, alias), and an
    // unexplained rewrite is not evidence of being in profile.
    if (realTrimmed.toLowerCase() !== inputTrimmed.toLowerCase()) {
        return profileUnknown('profile:realpath-diverges-from-input');
    }

    return profileIn('profile:in-supported-profile');
}

/**
 * Composite decision. SAFE requires BOTH layers; everything else is UNKNOWN and
 * must be handled as unsafe (I3). UNSAFE is never returned (§5.2).
 *
 * @param {string} collectionPath the exact path destined for ZVecOpen/ZVecCreateAndOpen
 * @param {object} [options] {platform, fsOps}
 * @returns {{verdict: string, layer: string, reason: string, lexical: object, profile: object|null}}
 */
function classifyCollectionPath(collectionPath, options) {
    const opts = options || {};
    const platform = opts.platform === undefined ? process.platform : opts.platform;
    const lexical = classifyLexical(collectionPath, platform);

    if (platform !== 'win32') {
        // I9. Note this returns SAFE without touching the filesystem.
        return { verdict: VERDICT.SAFE, layer: 'platform', reason: lexical.reason, lexical, profile: null };
    }
    if (lexical.verdict !== LEXICAL_VERDICT.ELIGIBLE) {
        return { verdict: VERDICT.UNKNOWN, layer: 'lexical', reason: lexical.reason, lexical, profile: null };
    }

    const profile = evaluateProfile(collectionPath, opts.fsOps);
    if (profile.verdict !== PROFILE_VERDICT.IN_PROFILE) {
        return { verdict: VERDICT.UNKNOWN, layer: 'profile', reason: profile.reason, lexical, profile };
    }
    return { verdict: VERDICT.SAFE, layer: 'both', reason: 'supported-ascii-profile', lexical, profile };
}

module.exports = {
    classifyLexical,
    evaluateProfile,
    classifyCollectionPath,
    DEFAULT_FS_OPS,
    VERDICT,
    LEXICAL_VERDICT,
    PROFILE_VERDICT,
};
