'use strict';

// code-perception dogfood-validate — pure validator for the live CodeGraph
// dogfood report artifact (docs/code-perception-codegraph-dogfood.md).
//
// This is the closure gate for ac-live-codegraph-dogfood: it RE-COMPUTES
// each declared `fingerprint: sha256:<hex>` against the immediately-
// preceding fenced block's inner content (a tampered block is caught, not
// just "a hex string is present"), and asserts required metadata + the 9
// required section headings.
//
// Pure: takes text, returns a result object. NEVER throws — a non-string
// input degrades to {valid:false, findings:[{code:'not-text'}]} and any
// unexpected parsing error degrades to a findings entry rather than a throw.
// The fs read (and workspace-root resolution) lives in the test.js strict
// gate, not here.

const crypto = require('node:crypto');

const REQUIRED_METADATA_FIELDS = ['repoCommit', 'codegraphVersion', 'adapterVersion'];

const REQUIRED_SECTIONS = [
    'status', 'search', 'callers-callees', 'impact', 'current-focus',
    'Task-to-Code', 'stale-index', 'fallback', 'limitations',
];

const METADATA_LINE_RE = /^(repoCommit|codegraphVersion|adapterVersion|closureEvidenceCommit):[ \t]*(.*)$/;
const FINGERPRINT_LINE_RE = /^fingerprint:[ \t]*(.*)$/;
const SHA256_HEX_RE = /^sha256:([0-9a-f]{64})$/;
const FENCE_RE = /^```/;

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractMetadata(lines) {
    const values = {};
    for (const line of lines) {
        const m = METADATA_LINE_RE.exec(line);
        if (m) {
            values[m[1]] = m[2].trim();
        }
    }
    return values;
}

function checkMetadata(values, requireClosureEvidence, findings) {
    for (const field of REQUIRED_METADATA_FIELDS) {
        if (!values[field]) {
            findings.push({ code: 'missing-metadata', message: 'missing ' + field });
        }
    }
    if (requireClosureEvidence && !values.closureEvidenceCommit) {
        findings.push({ code: 'missing-closure-evidence', message: 'missing closureEvidenceCommit' });
    }
}

function checkSections(text, findings) {
    for (const name of REQUIRED_SECTIONS) {
        const headingRe = new RegExp('^##[ \\t]+' + escapeRegExp(name) + '[ \\t]*$', 'm');
        if (!headingRe.test(text)) {
            findings.push({ code: 'missing-section', message: 'missing section: ' + name });
        }
    }
}

// Scans for fenced (```) blocks; for each block immediately followed (next
// non-blank line) by a `fingerprint: sha256:<hex>` line, recomputes sha256
// over the block's inner content (the lines between the fences, joined by
// '\n' — i.e. the single trailing newline before the closing fence is
// stripped) and compares it to the declared hex.
function checkFingerprints(lines, findings) {
    let matched = 0;
    let blockIndex = 0;
    let i = 0;

    while (i < lines.length) {
        if (!FENCE_RE.test(lines[i])) {
            i += 1;
            continue;
        }

        const start = i + 1;
        let end = -1;
        for (let j = start; j < lines.length; j += 1) {
            if (FENCE_RE.test(lines[j])) {
                end = j;
                break;
            }
        }
        if (end === -1) {
            // Unterminated fence — nothing further to pair; stop scanning.
            break;
        }

        blockIndex += 1;
        const inner = lines.slice(start, end).join('\n');

        let k = end + 1;
        while (k < lines.length && lines[k].trim() === '') {
            k += 1;
        }

        if (k < lines.length) {
            const fpMatch = FINGERPRINT_LINE_RE.exec(lines[k]);
            if (fpMatch) {
                const shaMatch = SHA256_HEX_RE.exec(fpMatch[1].trim());
                if (!shaMatch) {
                    findings.push({
                        code: 'fingerprint-malformed',
                        message: 'block ' + blockIndex + ': malformed fingerprint line',
                    });
                } else {
                    const declared = shaMatch[1];
                    const computed = crypto.createHash('sha256').update(inner, 'utf8').digest('hex');
                    if (declared === computed) {
                        matched += 1;
                    } else {
                        findings.push({
                            code: 'fingerprint-mismatch',
                            message: 'block ' + blockIndex + ': declared ' + declared.slice(0, 8) +
                                '... != computed ' + computed.slice(0, 8) + '...',
                        });
                    }
                }
            }
        }

        i = end + 1;
    }

    if (matched === 0) {
        findings.push({ code: 'no-fingerprints', message: 'no recomputed-and-matching fingerprint found' });
    }
}

function validateDogfoodArtifact(text, options) {
    if (typeof text !== 'string') {
        return { valid: false, findings: [{ code: 'not-text', message: 'input must be a string' }] };
    }

    const opts = (options && typeof options === 'object') ? options : {};
    const requireClosureEvidence = opts.requireClosureEvidence !== false;
    const findings = [];

    try {
        const lines = text.split('\n');
        const metadata = extractMetadata(lines);
        checkMetadata(metadata, requireClosureEvidence, findings);
        checkSections(text, findings);
        checkFingerprints(lines, findings);
    } catch (error) {
        return {
            valid: false,
            findings: [{ code: 'validation-error', message: error && error.message ? error.message : String(error) }],
        };
    }

    return { valid: findings.length === 0, findings };
}

module.exports = { validateDogfoodArtifact };
