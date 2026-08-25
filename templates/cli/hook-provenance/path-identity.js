'use strict';
// The single authority for "do these two paths name the same location".
// Both the runnability locator and the workspace-scope classifier call this and
// nothing else; two private copies of this ladder would drift, and the whole
// point is that only a positively resolved difference may be called a difference.
const fs = require('fs');
const path = require('path');

const SEP = String.fromCharCode(92); // backslash, kept out of string literals

function canonPath(p) {
    let out = path.resolve(p).split(SEP).join('/');
    if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
    return out;
}

// Returns 'SAME' | 'DISTINCT' | 'UNESTABLISHED'.
// Exact canonical equality is the ONLY lexical shortcut. A case-only difference
// is NOT equality: on a case-sensitive filesystem hooks/Foo and hooks/foo are two
// real directories, so treating them as equal would fabricate a positive.
function pathIdentity(a, b, fsOps = fs) {
    const ca = canonPath(a);
    const cb = canonPath(b);
    if (ca === cb) return 'SAME';

    let ra;
    let rb;
    try {
        ra = canonPath(fsOps.realpathSync.native(ca));
        rb = canonPath(fsOps.realpathSync.native(cb));
    } catch (_) {
        return 'UNESTABLISHED';
    }
    return ra === rb ? 'SAME' : 'DISTINCT';
}

module.exports = { pathIdentity, canonPath };
