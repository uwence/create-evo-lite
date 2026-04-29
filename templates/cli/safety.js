// Evo-Lite secrets / PII scanner (P1).
//
// Pure function module: no I/O, no logging side effects. Callers are responsible
// for deciding what to do with the report. The scanner intentionally does NOT
// keep matched bytes in any global state — once redaction is produced, only the
// rule kind and offset survive in metadata so that downstream loggers can record
// "what triggered" without re-leaking the secret.

const RULES = [
    {
        kind: 'private_key',
        severity: 'block',
        description: 'PEM-encoded private key block.',
        regex: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |DSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g,
    },
    {
        kind: 'aws_access_key',
        severity: 'block',
        description: 'AWS access key id.',
        regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    },
    {
        kind: 'github_token',
        severity: 'block',
        description: 'GitHub personal/app/refresh/server token.',
        regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g,
    },
    {
        kind: 'slack_token',
        severity: 'block',
        description: 'Slack bot/user/refresh token.',
        regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    },
    {
        kind: 'openai_key',
        severity: 'block',
        description: 'OpenAI-style sk- key.',
        regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    },
    {
        kind: 'jwt',
        severity: 'block',
        description: 'JSON Web Token (three base64url segments).',
        regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    },
    {
        kind: 'email',
        severity: 'warn',
        description: 'Email address (PII).',
        regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    },
    {
        kind: 'cn_phone',
        severity: 'warn',
        description: 'China mainland mobile phone number.',
        regex: /(?<!\d)1[3-9]\d{9}(?!\d)/g,
    },
];

const ENTROPY_MIN_LENGTH = 24;
const ENTROPY_THRESHOLD = 4.2;
const ENTROPY_TOKEN_REGEX = /[A-Za-z0-9_+/=-]{24,}/g;

function shannonEntropy(text) {
    if (!text) return 0;
    const counts = new Map();
    for (const ch of text) {
        counts.set(ch, (counts.get(ch) || 0) + 1);
    }
    const len = text.length;
    let entropy = 0;
    for (const count of counts.values()) {
        const p = count / len;
        entropy -= p * Math.log2(p);
    }
    return entropy;
}

function getRules() {
    return RULES.map(rule => ({
        kind: rule.kind,
        severity: rule.severity,
        description: rule.description,
    }));
}

function getRuleCount() {
    return RULES.length + 1; // regex rules + entropy heuristic
}

function scanForSecrets(text, options = {}) {
    if (typeof text !== 'string' || text.length === 0) {
        return { hits: [], severity: 'pass', redacted: text || '' };
    }

    const allowKinds = new Set(options.allowKinds || []);
    const enableEntropy = options.disableEntropy !== true;
    const hits = [];
    const replacements = [];

    for (const rule of RULES) {
        if (allowKinds.has(rule.kind)) continue;
        rule.regex.lastIndex = 0;
        let match;
        while ((match = rule.regex.exec(text)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            hits.push({
                kind: rule.kind,
                severity: rule.severity,
                start,
                end,
                length: match[0].length,
            });
            replacements.push({ start, end, kind: rule.kind });
            // Avoid pathological zero-length loops.
            if (match.index === rule.regex.lastIndex) rule.regex.lastIndex += 1;
        }
    }

    if (enableEntropy && !allowKinds.has('high_entropy')) {
        ENTROPY_TOKEN_REGEX.lastIndex = 0;
        let match;
        while ((match = ENTROPY_TOKEN_REGEX.exec(text)) !== null) {
            if (match[0].length < ENTROPY_MIN_LENGTH) continue;
            // Skip ranges already claimed by a stronger rule above.
            const start = match.index;
            const end = start + match[0].length;
            const overlaps = replacements.some(r => !(end <= r.start || start >= r.end));
            if (overlaps) continue;
            const score = shannonEntropy(match[0]);
            if (score < ENTROPY_THRESHOLD) continue;
            hits.push({
                kind: 'high_entropy',
                severity: 'warn',
                start,
                end,
                length: match[0].length,
                entropy: Number(score.toFixed(2)),
            });
            replacements.push({ start, end, kind: 'high_entropy' });
        }
    }

    let severity = 'pass';
    for (const hit of hits) {
        if (hit.severity === 'block') {
            severity = 'block';
            break;
        }
        if (hit.severity === 'warn') severity = 'warn';
    }

    // Build redacted version (used when severity == 'warn' or when caller asks).
    let redacted = text;
    if (replacements.length > 0) {
        const sorted = replacements.slice().sort((a, b) => b.start - a.start);
        for (const r of sorted) {
            redacted = redacted.slice(0, r.start) + `<REDACTED:${r.kind}>` + redacted.slice(r.end);
        }
    }

    return { hits, severity, redacted };
}

// Build a log-safe summary (no matched bytes, only kind+offset+length).
function summarizeHits(hits) {
    return hits
        .map(h => `${h.kind}@${h.start}+${h.length}`)
        .join(',');
}

module.exports = {
    getRuleCount,
    getRules,
    scanForSecrets,
    summarizeHits,
};
