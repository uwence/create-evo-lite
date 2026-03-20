# Remember Boundary Decision

## Status

Accepted

## Decision

`remember` will remain a **lightweight searchable cache**, not a rebuild-guaranteed long-term archive path.

The durable closure path in Evo-Lite remains:

```text
active_context -> context track -> archive
```

`remember` may still be useful for:

- short-lived searchable hints
- workaround breadcrumbs
- temporary recall aids that are helpful during active development

`remember` is **not** the primary place for:

- closed-loop task completion records
- architecture decisions that must survive rebuilds
- bug postmortems that should be preserved as structured assets
- anything that needs `raw_memory/`-based recovery guarantees

## Why

Evo-Lite is aimed at keeping AI-assisted project work usable for people who are not necessarily full-time software engineers. That means the main closure path must stay:

- stable
- low-ambiguity
- easy for both humans and AI agents to follow

If `remember` is upgraded into a second long-term asset path too early, the system becomes harder to reason about:

- users must guess whether to use `remember` or `archive`
- AI can start treating lightweight notes as durable knowledge assets
- rebuild semantics become less clear
- the product boundary between searchable cache and structured archive becomes blurry again

Keeping `remember` intentionally lightweight preserves a simpler model:

- `active_context` tracks the live state
- `track/archive` preserve durable project knowledge
- `remember` helps with lightweight recall without competing with the main closure path

## Consequences

### Positive

- The main flow stays explicit and easier to teach.
- Rebuild semantics remain centered on structured archives.
- AI agents are less likely to confuse convenience notes with durable memory assets.

### Trade-offs

- Some useful hints stored only through `remember` may not survive archive-based rebuild.
- Users need to consciously promote important knowledge into `track/archive`.

## Operational Guidance

Use `remember` when:

- the note is useful to recall later
- the cost of losing it during rebuild is acceptable
- it does not need to become part of the project's durable handoff story

Use `track/archive` when:

- the work item is closed-loop
- the knowledge should survive rebuild and migration
- the result should be inspectable as a structured project asset

## Revisit Conditions

This decision should be revisited only if one of these becomes clearly valuable:

1. `remember` gains an optional promotion mode that writes both to the database and a structured archive path.
2. Users repeatedly lose important knowledge because they naturally reach for `remember` first.
3. The extra complexity of dual durable paths can be justified by a clear gain in daily usability.
