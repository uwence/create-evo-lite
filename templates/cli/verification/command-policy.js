'use strict';

const fs = require('fs');
const path = require('path');

const POLICY_REL = ['.evo-lite', 'verification', 'command-policy.json'];

// The one command evo-lite's own governance suite runs. Used when no policy
// file is present, so a freshly-nurtured child (which receives this gene but
// no policy file) can still run its command verifiers out of the box. Any
// OTHER command still requires a human to add it to command-policy.json.
const BUILTIN_DEFAULT = Object.freeze({
    version: 'evo-command-policy@1',
    allow: [{ prefix: 'node ./.evo-lite/cli/test.js' }],
});

// Any of these lets a string chain / inject / redirect through the shell.
// A legitimate `node ./.evo-lite/cli/test.js governance` contains none of them.
// Rejecting them makes prefix-matching safe against trailing injection.
const SHELL_META = /[;&|$`<>()\n\r]/;

function loadPolicy(repoRoot) {
    const fp = path.join(repoRoot, ...POLICY_REL);
    if (!fs.existsSync(fp)) return BUILTIN_DEFAULT;
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch (e) {
        throw new Error(`command-policy.json is not valid JSON: ${e.message}`);
    }
    if (!parsed || !Array.isArray(parsed.allow)) {
        throw new Error('command-policy.json must have an "allow" array');
    }
    for (const entry of parsed.allow) {
        const hasPrefix = entry && typeof entry.prefix === 'string' && entry.prefix.length > 0;
        const hasEquals = entry && typeof entry.equals === 'string';
        if (!hasPrefix && !hasEquals) {
            throw new Error(`command-policy.json allow entry needs a non-empty "prefix" or "equals": ${JSON.stringify(entry)}`);
        }
    }
    return parsed;
}

function matchesEntry(cmd, entry) {
    if (typeof entry.equals === 'string') return cmd === entry.equals;
    if (typeof entry.prefix === 'string' && entry.prefix.length > 0) {
        return cmd === entry.prefix || cmd.startsWith(entry.prefix + ' ');
    }
    return false;
}

// { allowed: boolean, reason?: string }
function checkCommand(cmd, policy) {
    if (typeof cmd !== 'string' || cmd.trim() === '') {
        return { allowed: false, reason: 'empty command' };
    }
    if (SHELL_META.test(cmd)) {
        return { allowed: false, reason: `shell metacharacters not allowed: ${cmd}` };
    }
    const allow = (policy && Array.isArray(policy.allow)) ? policy.allow : [];
    if (!allow.some(e => matchesEntry(cmd, e))) {
        return { allowed: false, reason: `command not in command-policy.json allowlist: ${cmd}` };
    }
    return { allowed: true };
}

module.exports = { loadPolicy, checkCommand, matchesEntry, SHELL_META, POLICY_REL, BUILTIN_DEFAULT };
