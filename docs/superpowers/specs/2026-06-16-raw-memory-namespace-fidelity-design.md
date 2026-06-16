---
id: spec:raw-memory-namespace-fidelity
status: done
created: 2026-06-16
linkedPlan: plan:raw-memory-namespace-fidelity
---

# Raw Memory Namespace Fidelity — Design Spec

## Goal

Ensure that every `.md` file written to `raw_memory/` contains the `namespace` field in its YAML frontmatter, so that a full SQLite rebuild from `.md` files preserves namespace assignments without data loss.

## Problem Statement

The `archive()` function writes `.md` files to `.evo-lite/raw_memory/` with YAML frontmatter containing `id`, `timestamp`, `type`, and `tags` — but **not `namespace`**. When `rebuild` or `syncIndexMemory` re-ingests these files into SQLite, the namespace is lost and every entry is silently assigned to the default namespace.

`evo_verify` confirms: 74 prose chunks, 0 code, 0 symbol — all existing files are `prose` namespace, so the current gap has caused no visible harm, but future entries that write to `code` or `symbol` would lose their namespace on rebuild.

## Non-Goals

- No vector embedding layer (out of scope).
- No migration command for existing files (existing files rebuild to `prose` default, which is correct).
- No changes to `tags` (frontmatter field exists but no corresponding SQLite column).
- No changes to `source` field (runtime metadata, not persisted to file).
- No changes to the `rebuild` CLI interface.

## Requirements

1. `archive()` MUST write `namespace` into the YAML frontmatter of every new `.md` file.
2. `syncIndexMemory()` MUST read `namespace` from frontmatter and pass it to `ingestArchiveFile()`.
3. `ingestArchiveFile()` MUST accept an optional `namespace` parameter and fall back to `prose` when absent (handles existing files without the field).
4. Round-trip fidelity: writing an entry with `namespace: "code"` then running `rebuild` MUST produce a `code`-namespace entry in SQLite.
5. No behavioral change when `namespace` is absent in frontmatter (backward-compatible default).

## Architecture

### Write Path (`archive()`)

**Before:**
```
---
id: "abc_12345678"
timestamp: "2026-06-16T..."
type: "task"
tags: []
---
```

**After:**
```
---
id: "abc_12345678"
timestamp: "2026-06-16T..."
type: "task"
namespace: "prose"
tags: []
---
```

Change: line 1261 in `memory.service.js` — add `namespace` to the template string.
The namespace value comes from `preflightCheck.namespace`, which is already computed before file write.

### Read Path (`syncIndexMemory()`)

Add a fourth frontmatter extraction alongside the existing `id`, `timestamp`, `type` reads:

```js
const nsMatch = markdown.match(/^namespace:\s*"([^"]+)"/m);
const namespace = nsMatch ? nsMatch[1] : DEFAULT_NAMESPACE;  // DEFAULT_NAMESPACE = 'prose'
```

Pass `namespace` to `ingestArchiveFile()` as an option.

### Ingest Path (`ingestArchiveFile()`)

`ingestArchiveFile(filePath, type, id, timestamp, options)` already accepts an `options` object.
`syncIndexMemory()` currently calls it without the `namespace` option, so it falls through to whatever default `memorize()` uses.

Fix: pass `options.namespace` from the parsed frontmatter value.

### Backward Compatibility

| Scenario | Behavior |
|----------|----------|
| Old `.md` file, no `namespace` field | `nsMatch` is null → `DEFAULT_NAMESPACE` (`prose`) used |
| New `.md` file, `namespace: "code"` | Parsed correctly, passed to SQLite |
| `syncIndexMemory` on mixed old+new files | Old → prose, New → correct namespace |

## Files Changed

- `templates/cli/memory.service.js` — three surgical edits (lines ~1261, ~1305, ~1301)
- `.evo-lite/cli/memory.service.js` — mirror sync after edit

## Acceptance Criteria

- [ ] `archive("test", "task", { namespace: "code" })` writes `namespace: "code"` to the `.md` file
- [ ] Running `rebuild` after the above produces a `code`-namespace entry in SQLite (verify via `mem recall` scoped to `code`)
- [ ] `syncIndexMemory` on an existing file without `namespace` field defaults to `prose` (no crash, no warning)
- [ ] `evo_verify` prose/code/symbol chunk counts are preserved across a `rebuild` cycle (once entries in those namespaces exist)
- [ ] No change to `rebuild` / `syncIndexMemory` CLI output format
