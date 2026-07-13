# CodeGraph Dogfood Report (sample fixture)

<!--
VALIDATOR FIXTURE — not a real capture. Produced by hand to drive
validateDogfoodArtifact (Task cg-dogfood-validate). Fingerprint convention:
`fingerprint: sha256:<hex>` where <hex> is the sha256 of the immediately-
preceding fenced block's INNER content (the text between the ``` fences, with
the single trailing newline before the closing fence stripped).
-->

repoCommit: 781cc9a4e2b1c0d9f8a7b6c5d4e3f2a1b0c9d8e7
codegraphVersion: 1.4.1
adapterVersion: 0.1.0
closureEvidenceCommit: 19137decafe0011223344556677889900aabbcc

## status

The index is complete and fresh: 214 files, 2045 symbols, 4105 relationships,
built with extraction version 24. No pending changes; the working tree matches
the index.

## search

Query for the reference normalizer resolves to a single high-ranked function.

```command
codegraph query "normalizeReference" --json
```
fingerprint: sha256:db935d5456501dbf2c781b71b71935a53b440d7afc25eb2f7876ba7b057bd467

```result
[
  {
    "node": { "name": "normalizeReference", "kind": "function", "filePath": "templates/cli/code-perception/normalize.js", "startLine": 54 },
    "score": 18.42
  }
]
```
fingerprint: sha256:d19a248796f4f498c36e8b63f73f7478aca6f8d506d9ffc5cd5a19f19f090779

## callers-callees

`normalizeReference` is called by `normalizeSearchResult`, `normalizeRelationship`,
and `normalizeImpactResult`; it calls `isPlainObject`, `coerceEnum`, and
`makeReferenceId`. The relationship rows carry no entity id — only name, kind,
filePath, and startLine — matching the real upstream callers/callees `--json`.

## impact

Changing `normalizeReference` at depth 2 touches 4 symbols across two files
(the three normalize entry points plus `getFiles` in the native-lite provider),
with 5 traversed edges.

## current-focus

Sub-spec ② CodeGraph Adapter & Governance Linker — Task cg-fixtures establishes
the committed pinned-upstream fixtures every later task tests against.

## Task-to-Code

Task cg-fixtures links to `templates/cli/test/fixtures/code-perception/*` and the
`T-cg-fixtures` section of `templates/cli/test/governance.js`.

## stale-index

If `codegraph status` reports `reindexRecommended: true` or a non-`complete`
index state, the adapter surfaces a staleness diagnostic and the governance
linker must not treat symbol-graph answers as authoritative until a re-index.

## fallback

When CodeGraph is unavailable or reports an incompatible index, the router
degrades to `provider:native-lite`, which answers file/module/source questions
from git + the Architecture/Planning IR and never fabricates a symbol graph.

## limitations

Callers/callees/impact rows expose no stable entity id, so downstream references
are synthesized from `filePath` + `name` + `startLine`. `explore`/`node` output
is opaque prose (no `--json`); only a single explicitly-marked `file:line` token
is machine-extractable from each.
