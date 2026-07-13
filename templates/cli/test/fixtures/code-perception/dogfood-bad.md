# CodeGraph Dogfood Report (bad fixture — missing a required section)

<!--
VALIDATOR NEGATIVE FIXTURE — a copy of dogfood-sample.md with the required
`stale-index` section removed, so validateDogfoodArtifact must reject it.
-->

repoCommit: 781cc9a4e2b1c0d9f8a7b6c5d4e3f2a1b0c9d8e7
codegraphVersion: 1.4.1
adapterVersion: 0.1.0
closureEvidenceCommit: 19137decafe0011223344556677889900aabbcc

## status

The index is complete and fresh: 214 files, 2045 symbols, 4105 relationships,
built with extraction version 24.

## search

Query for the reference normalizer resolves to a single high-ranked function.

```command
codegraph query "normalizeReference" --json
```
fingerprint: sha256:db935d5456501dbf2c781b71b71935a53b440d7afc25eb2f7876ba7b057bd467

## callers-callees

`normalizeReference` is called by `normalizeSearchResult`, `normalizeRelationship`,
and `normalizeImpactResult`.

## impact

Changing `normalizeReference` at depth 2 touches 4 symbols across two files.

## current-focus

Sub-spec ② CodeGraph Adapter & Governance Linker — Task cg-fixtures.

## Task-to-Code

Task cg-fixtures links to the code-perception fixtures directory.

## fallback

When CodeGraph is unavailable, the router degrades to `provider:native-lite`.

## limitations

Callers/callees/impact rows expose no stable entity id.
