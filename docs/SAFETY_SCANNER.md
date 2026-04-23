# Evo-Lite Safety Scanner (P1)

The safety scanner runs inside the central `prepareForWrite` pipeline. Every
long-term write — `memorize`, `archive`, `rememberOffline`, `importMemories`,
and the GitHub Actions auto-archive workflow — passes through it before any
content is persisted to `.evo-lite/memory.db`, `.evo-lite/raw_memory/`, or
`.evo-lite/offline_memories.json`.

## What gets scanned

`cli/safety.js` exports `scanForSecrets(text) → { hits, severity, redacted }`.
The scanner combines two layers:

### 1. Named regex rules

| Rule kind         | Severity | Description                                            |
|-------------------|----------|--------------------------------------------------------|
| `private_key`     | block    | PEM-encoded private key blocks (RSA / EC / OPENSSH …)  |
| `aws_access_key`  | block    | `AKIA…` / `ASIA…` access key ids                       |
| `github_token`    | block    | `ghp_/gho_/ghu_/ghs_/ghr_` tokens                      |
| `slack_token`     | block    | `xox[baprs]-…`                                         |
| `openai_key`      | block    | `sk-…` keys (≥20 chars after the prefix)               |
| `jwt`             | block    | Three-segment base64url JWTs                           |
| `email`           | warn     | Email addresses (PII)                                  |
| `cn_phone`        | warn     | China mainland mobile numbers                          |

### 2. Shannon-entropy heuristic

Continuous `[A-Za-z0-9_+/=-]` runs of length ≥ 24 are scored with Shannon
entropy. A score ≥ 4.2 yields a `high_entropy` (severity = `warn`) hit. This
catches generic long-lived secrets that don't match a named rule.

## Severity tiers

| Severity | Default behavior on write                                                                 |
|----------|--------------------------------------------------------------------------------------------|
| `pass`   | Content is written verbatim.                                                              |
| `warn`   | Content is **redacted** in place to `<REDACTED:<kind>>`. Original bytes are not persisted. |
| `block`  | Write is **rejected** with a thrown error. Nothing is written to disk or the database.     |

## Whitelisting / explicit overrides

If you genuinely need to persist content that the scanner flags, pass
`allowSecrets: true` to the underlying API call (or `--allow-secrets` on the
CLI surfaces that expose it). Use this sparingly — for instance, a `note` that
discusses a public test fixture token that intentionally looks like a real
secret.

## Logging

The scanner never writes matched bytes anywhere. The `appendLog` calls only
record:

- the rule kind that fired,
- the offset and length of the match within the input,
- the source label (e.g. `archive`, `cli`).

`verify` surfaces a one-line counter:

```
🛡️ [安全/红线]: rules=N, blocks=N, redactions=N, last_block=<timestamp> (<kind@offset+length>)
```

This means you can audit historical rejections without re-leaking the bytes
that triggered them.
