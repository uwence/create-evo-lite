# [backlog-edit-cli-gap] Existing Backlog Text Edit — Design Spec

## 0. Status and Authorization Boundary

This document freezes the design for the `backlog-edit-cli-gap` issue against:

```text
BASE
main@bd0e526797923cc759a2c2f90a3563ba5999dd8c

STATUS
DESIGN FROZEN
IMPLEMENTATION NOT AUTHORIZED
IMPLEMENTATION PLAN NOT AUTHORIZED
```

This phase may add only this design spec. It must not modify the live or template CLI runtime, integration tests, `.evo-lite/active_context.md`, backlog state, or any product source.

## 1. Problem Statement

The context CLI can add backlog items and change focus, but it cannot safely revise the description of an existing backlog item while preserving its stable ID and checkbox state. The missing operation is deliberately narrow:

```text
context edit <id> "<new-text>"
```

The operation is not a generic Markdown editor. It edits one pending BACKLOG item's opaque text payload and nothing else.

At the frozen base, invoking the proposed shape is rejected by the command parser, so no current behavior overlaps this design:

```text
node ./.evo-lite/cli/memory.js context edit 3d78 "probe replacement"
→ error: too many arguments for 'context'. Expected 0 arguments but got 3.
```

The rejected probe leaves `.evo-lite/active_context.md` byte-identical.

## 2. Goals

- Add exactly one command shape: `context edit <id> "<new-text>"`.
- Reuse the existing backlog ID grammar and case-insensitive resolution semantics.
- Replace only the text payload of one existing pending backlog item.
- Preserve the original Markdown bytes outside the payload span.
- Fail closed before writing for invalid, missing, ambiguous, or non-pending targets.
- Define identical-text edits as successful no-ops with no file write and no audit event.
- Keep live/template implementations and tests byte-equivalent when implementation is later authorized.

## 3. Non-Goals

This design does not add:

- a top-level `edit` alias;
- `--content`, `--file`, stdin, or other text sources;
- multiline Markdown, batch editing, regex matching, or partial matching;
- backlog ID changes, checkbox/status changes, implicit creation, deletion, or reordering;
- editing outside the BACKLOG section;
- a second ID grammar or interpretation of bracketed payload text as an ID;
- changes to the size-warning contract, active context resync behavior, or `attp-hive-rollout` state;
- an implementation plan or implementation code in this phase.

## 4. Frozen Command Contract

### 4.1 Syntax

The only public command is:

```text
context edit <id> "<new-text>"
```

Both positional arguments are required. Commander owns ordinary shell argument parsing; the service receives the resulting raw argument strings. No text-source helper or option is attached to this command.

### 4.2 ID contract

`<id>` reuses the existing canonical backlog ID grammar:

```regex
[A-Za-z0-9_-]{1,32}
```

Resolution is case-insensitive. The identity of a backlog line always comes from the first `[id]` immediately following its checkbox, as recognized by the existing backlog ID parser. The command must scan all ID-bearing backlog lines, including checked and unchecked lines, before deciding whether the target is editable.

Resolution outcomes are:

| Matches across all backlog IDs | Result |
| --- | --- |
| 0 | fail with `not found` |
| 1 checked item | fail with `not pending` |
| 1 pending item | continue |
| more than 1, regardless of checkbox state | fail with `ambiguous` or `multiple IDs` |

Therefore a pending `[abc]` and a checked `[ABC]` are ambiguous. The implementation must not first filter to pending items and thereby hide a duplicate identity.

### 4.3 New-text contract

Validation order is significant:

1. Inspect the raw `<new-text>` argument for `\r` or `\n`; either character fails the single-line rule.
2. Apply `trim()`.
3. Reject an empty trimmed result.
4. Treat the trimmed result as an opaque text payload.

The newline check occurs before `trim()` so leading or trailing line breaks cannot be silently removed and accepted.

Ordinary square brackets, Chinese text, punctuation, and quotes are allowed payload bytes. For example:

```text
context edit 3d78 "[BLOCKED] 等待 host contract"
```

produces a target line shaped as:

```text
- [ ] [3d78] [BLOCKED] 等待 host contract
```

`[BLOCKED]` is payload and is never reinterpreted as a task ID.

## 5. Validation and Error Taxonomy

All validation and target resolution must finish before the first filesystem write. The frozen evaluation order is:

```text
validate raw newText newline
→ trim / non-empty
→ validate id syntax
→ scan ALL backlog IDs
→ 0 match = not found
→ >1 match = ambiguous
→ unique but checked = not pending
→ compare current payload for no-op
→ byte-surgical replacement
```

Errors must remain distinguishable through stable message fragments:

| Condition | Required message fragment |
| --- | --- |
| malformed ID | `invalid backlog id` |
| no matching ID | `not found` |
| duplicate case-insensitive ID | `ambiguous` or `multiple IDs` |
| unique checked target | `not pending` |
| empty or whitespace-only text | `new-text` and `empty` |
| raw CR or LF present | `new-text` and `single-line` |

Every validation, resolution, ambiguity, or pending-state error returns non-zero through the existing CLI error path. These fail-closed outcomes must not write `active_context.md` and must not append a `CONTEXT_EDIT` event.

## 6. Byte-Surgical Mutation Contract

### 6.1 Source of offsets

Semantic parsing may identify the BACKLOG section and candidate lines, but the mutation must operate on offsets into the original `active_context.md` string. It must not reconstruct the section through `split`, `join`, normalized line arrays, parsed objects, or Markdown reserialization.

The implementation must derive:

- the BACKLOG body start and end offsets in the original document;
- each candidate line's absolute start and end offsets without consuming its line ending;
- the target payload start immediately after the original checkbox, original ID token, and original separator whitespace;
- the target payload end immediately before its original line ending.

The final document is constructed only as:

```text
original[0:payloadStart]
+ trimmedNewText
+ original[payloadEnd:end]
```

This preserves, byte for byte:

- the target line prefix;
- checkbox spelling and state;
- original ID spelling and case;
- whitespace separating the ID and payload;
- the target line's `LF` or `CRLF` ending;
- every other backlog line;
- BACKLOG anchors and surrounding whitespace;
- META, FOCUS, TRAJECTORY, and all other sections.

The only permitted byte delta for a changed edit is the target payload span.

### 6.2 Payload boundary precondition

An editable line must have an existing payload span after the recognized checkbox/ID prefix and its separator. A structurally malformed line must not be repaired opportunistically by `edit`; it fails through the existing context-structure validation path or a closed edit-specific error before writing.

### 6.3 Atomicity and audit

After all validation succeeds, the implementation computes the complete final document before issuing exactly one call through the existing synchronous active-context write path. Only after that write succeeds may it call the existing best-effort `appendLog` path once with a `CONTEXT_EDIT` event describing the resulting target line. Because `appendLog` absorbs its own logging errors by existing contract, an audit sink problem cannot turn an already-applied edit into a reported command failure.

If validation, target resolution, ambiguity detection, or pending-state validation fails, the command must not report success; the file remains byte-identical and no edit audit event is attempted. If the context write itself throws, that error propagates and no edit audit event is attempted.

## 7. Identical-Text No-Op

After trimming `<new-text>`, compare it with the target's current payload exactly and case-sensitively. If they are identical:

- return success;
- do not rewrite or touch `active_context.md`;
- do not append `CONTEXT_EDIT`;
- do not alter timestamps or any other runtime state.

No new public CLI flag, output mode, or output field is introduced for this case. The service may use an internal boolean to select the no-op path, but `changed` is not frozen as part of a public return contract because no current consumer requires it.

## 8. Service and CLI Responsibilities

When implementation is separately authorized, responsibility is divided as follows:

### Service

- validate raw newline and normalized text rules;
- validate the ID with the existing grammar;
- locate BACKLOG offsets in the original document;
- scan and resolve all backlog IDs case-insensitively;
- enforce ambiguity before pending-state checks;
- locate the exact payload span;
- recognize identical-text no-op;
- perform the single surgical write and changed-edit audit.

### CLI

- register only `context edit <id> <new-text>`;
- pass both positional values directly to the service without adding alternate text sources;
- use the existing error-to-non-zero behavior;
- avoid registering a top-level alias.

No generic section-edit abstraction is introduced.

## 9. Acceptance Matrix

Each failure test must hash or otherwise compare `active_context.md` before and after the command and prove byte identity. Success tests must compare complete file bytes, not only parsed values.

| Case | Input / fixture | Expected result | Byte-level assertion |
| --- | --- | --- | --- |
| Normal edit | unique pending ID and distinct valid text | success; one `CONTEXT_EDIT` | only target payload bytes change |
| Case-insensitive lookup | stored `[AbC]`, command ID `abc` | success | stored ID case remains `[AbC]` |
| Not found | valid ID absent from all backlog items | non-zero, `not found` | whole file identical |
| Invalid ID | ID outside the canonical grammar | non-zero, `invalid backlog id` | whole file identical |
| Duplicate pending IDs | `[abc]` and `[ABC]`, both pending | non-zero, ambiguous | whole file identical |
| Duplicate mixed status | pending `[abc]` and checked `[ABC]` | non-zero, ambiguous before pending check | whole file identical |
| Checked-only target | one checked matching ID | non-zero, `not pending` | whole file identical |
| Empty text | `""` or whitespace only | non-zero, empty-text error | whole file identical |
| Raw multiline | CR, LF, or CRLF anywhere in raw input | non-zero, single-line error before trim | whole file identical |
| Opaque payload | `[]`, Chinese, punctuation, and quotes | success | payload preserved literally; no ID reinterpretation |
| Same text | trimmed input equals current payload | success no-op; no audit | whole file identical, including metadata |
| Line ending preservation | LF and CRLF fixtures | success | original target EOL and all other bytes preserved |
| Surface rejection | top-level alias, `--content`, `--file`, or extra arguments | parser rejection | whole file identical |

The integration suite must also prove that existing context commands retain their prior behavior and that all later-authorized live/template changes are byte-identical.

## 10. Expected Implementation Surface

This list is forecasting for a later implementation review; it grants no permission to modify these files now:

```text
.evo-lite/cli/memory.service.js
templates/cli/memory.service.js

.evo-lite/cli/memory.js
templates/cli/memory.js

.evo-lite/cli/test/integration.js
templates/cli/test/integration.js
```

Expected responsibilities are service behavior, command registration/routing, and integration coverage respectively. Product source changes are not expected.

## 11. Alternatives Rejected

### Parse and reserialize the BACKLOG section

Rejected because it can normalize whitespace, checkbox spelling, ID case, blank lines, or line endings outside the intended payload. That violates the minimal-delta contract.

### Generic context field editor

Rejected because it would create cross-section mutation authority and a larger safety surface than this backlog-specific gap requires.

### Alternate text inputs or bulk matching

Rejected because options, files, stdin, multiline content, regex, and batch edits create additional parsing and failure modes without serving the approved use case.

### Pending-only resolution

Rejected because it can hide a duplicate checked ID and incorrectly treat an ambiguous identity as unique.

## 12. Review and Next Gate

Spec-level review must confirm:

- the command surface is exactly one nested command;
- the raw-newline-before-trim rule is unambiguous;
- duplicate detection covers all checked and pending IDs before status validation;
- offset-based replacement preserves every non-payload byte;
- identical text is a write-free and audit-free success;
- error cases prove byte identity;
- the expected implementation surface remains limited to the three live/template pairs.

Approval of this spec does not authorize an implementation plan or implementation. Those require separate explicit gates.
