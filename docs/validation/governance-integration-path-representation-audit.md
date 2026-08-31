# Governance / Integration — path-representation audit

Audited snapshot: **`main@3614b5c`** (working tree clean).

> **Measurement only.**
>
> This audit changed no production code, no test code, no runtime state, and no
> spec or plan. It authorizes no repair. It exists so the measurement below does
> not have to be performed a second time.

## 1. Question

Do representation differences — 8.3 short names, junction/symlink indirection,
drive-letter casing, separator or relative/absolute spelling — in the
interception and comparison sites of `governance.js` and `integration.js` change
a **test verdict**?

Worth asking because `[hook-install-provenance]` produced a real 8.3 incident,
and because this tree carries lexical `path.resolve()` comparisons alongside the
`fs.realpathSync.native` *physical* identity primitive the containment work
introduced. Two notions of path identity coexist here on purpose.

## 2. Frozen scope

```text
templates/cli/test/governance.js     21949 lines
templates/cli/test/integration.js     4373 lines
.evo-lite/cli/test/governance.js     hash-identical to its template
.evo-lite/cli/test/integration.js    hash-identical to its template
```

Mirror identity was measured, not assumed (`git hash-object`):

```text
governance.js    bea4162d9bdcb30795fd0c9b0862e16006451e40   templates == mirror
integration.js   9b50008929e4b1286a787ba0ad43a9266ea9ece3   templates == mirror
```

so one analysis covers all four files. Helpers were read only to explain an
identified decision point (`zvec-path-containment.js`, `memory-index.js`,
`verification/close-apply.js`).

### The candidate domain, in three passes

**Pass 1 — keyword seed.** Every line matching
`require.cache|realpathSync|path.resolve|path.relative`: **142 lines,
87 deduplicated shapes.** This is an *initial mechanical seed*, **not** a
complete enumeration of path decisions, and must not be described as one. It
misses, for example, `if (String(p) === markerPath)` — an unambiguous
interception key containing none of the four keywords
(`governance.js:18634`, `19076`, `integration.js:4273`).

**Pass 2 — construct sweep.** Selected by *risk-bearing construct* rather than
by keyword, over the same four files, excluding every pass-1 line:

```text
144  path-ish .includes(          40  path-ish equality
 44  path-ish .startsWith/.endsWith
 31  fsOps injection objects      30  fs monkeypatching
 11  Module._load / new Proxy      4  String(x) === comparisons
---
304  raw construct hits
-61  dropped: receiver is output/stdout/message text, not a path
243  reviewed
180  actual path decisions  /  149 deduplicated shapes
```

**Combined classified domain: 322 lines, 236 deduplicated shapes.**

**Pass 3 — negative-judgement backstop.** Passes 1 and 2 both select by
heuristic, so neither can prove exhaustiveness — and pass 2 was itself caught
missing `governance.js:2979`, whose path variable is named `planRel` and so
matches no path-ish token. Pass 3 therefore drops candidate selection entirely
and enumerates **every** negative judgement in both files, on the argument
in §6:

```text
718  negative judgements in the two files
180  keyed on a path or a path collection
 22  whose evidence is a DIRECT comparison
     all 22 inspected individually
```

The other 158 draw their evidence from a filesystem listing or a call counter.
Pass 3 did **not** clear them as a class, and they must not be read as cleared:
a counter can itself be gated by a representation-sensitive comparison, which
makes it an indirect carrier of exactly the same failure. §7 of this document
is that case — `fs.markerWrite === 0` is counter evidence, and the counter only
increments when a `norm()`-ed path comparison matches. It is classified B on a
site-specific same-origin proof, not because counters are safe.

## 3. Classification contract

```text
A  REPRESENTATION-SAFE       spelling cannot change the judgement
B  DEPENDENT BUT HARMLESS    spelling changes plumbing, not evidence or verdict
C  DEPENDENT VERDICT         an alternate representation can make a guard or
                             probe fire or not fire, or change the outcome
```

Only **C** would have qualified to request repair authorization.

## 4. Result

```text
A   majority
B   minority
C   0     in the measured domain:
              322 classified sites (passes 1 and 2)
            + all 22 directly comparison-keyed negative judgements (pass 3)
```

**No C candidates. No repair requested, none justified.**

This is bounded evidence, not a proof. No exhaustive proof was attempted over
every possible indirect observer or counter dependency, and no AST scan was
built. Two independent misses of this audit's own selection heuristics were
found during the work and are recorded above rather than papered over.

The bound is enough for the decision it supports. **No C observed** is what
makes repair unjustified today; proving that no unknown C exists anywhere in
the repository was never the standard, and adopting it would be the runaway
governance this project has already ruled against.

## 5. Family summary

| Family | Sites | Judgement | Comparison | Spelling can differ? | Can change verdict? | Class |
|---|---|---|---|---|---|---|
| module cache keys | 58 lines (gov 47 / int 11) | reload a module or not | `require.cache[require.resolve(x)]` | NO | — | A |
| failure injectors | gov ×9, `13335`–`13507`; int `695` | turn this write into an injected fault | `path.resolve(a) === / startsWith path.resolve(b)` | UNESTABLISHED | NO — a miss makes `assert.throws` fail loudly | B |
| pure observers | int `634` / `638` | "same-text no-op must not write or audit" | same | UNESTABLISHED | NO — same-run positive control, §6 | B |
| realpath stub keys | gov `13635` / `13646` / `13658` | installer's verbatim message contract | `p === projectRoot \|\| p === realRoot` | **YES, already encountered** | NO — verbatim assertion turns red | B |
| identity stubs | 24 sites | containment verdict | `realpathSync: (p) => p` | NO | — | A |
| same-origin expectations | gov `13237` / `13826` / `14355`-`14361` / `14581` / `14602` | guard's root-containment decision | both sides use `fs.realpathSync.native` | NO by construction | — | A |
| interception counters | gov `20196` / `20224` / `20225` | "a forbidden write happened 0 times" | both sides pass through the same `norm()` | NO | NO | B |
| traversal containment | gov `9669` / `9673` / `9762` / `12649` | is a path escape blocked | `startsWith(resolve(dir) + path.sep)` | UNESTABLISHED | NO — a miss turns red | A/B |
| **pass 2** — fs monkeypatch keys | gov `18634` / `19076`, int `4273`, +10 | inject EBUSY / a false `existsSync` on one path | `String(p) === somePath` | UNESTABLISHED | NO — a miss un-injects the fault and the awaited error never arrives | B |
| **pass 2** — path equality outside the seed | 30 sites | branch on "is this the file we mean" | `xPath === yPath` | UNESTABLISHED | NO — same-origin operands, misses turn red | A/B |
| **pass 2** — collection membership | 79 `.includes` / 37 prefix sites | was this file staged, copied, registered | `list.includes('a/b.js')`, `n.startsWith(basename)` | **NO** | NO | A |

The membership family deserves its own note, because a forward-slash literal
compared against producer output is exactly the shape that *should* be
representation-fragile on Windows. It is not, and the reason is upstream:
`verification/close-apply.js:184` normalises at the boundary —
`path.relative(root, p).replace(/\\/g, '/')` — so the producer emits one
spelling on every OS. The manifest families are static source constants for the
same reason. Where the collection is producer-emitted, each negative membership
assertion additionally sits beside a positive one on the same collection in the
same run (`gov 16436` guards `16438`, `gov 16629` guards `16631`,
`int 2187` guards `2189`, `gov 2506` guards `2508`).

Two rows carry the general answer. `realpath stub keys` shows the class is
already understood in-tree — the divergence was *hit and accommodated*
(`macOS: mkdtemp gives /var/…, realpath gives /private/var/…`).
`same-origin expectations` is the standing defence: the test computes its
expected value with the **same primitive production uses**, so no spelling gap
can open between the two sides.

## 6. Three decisive controls

**Injection miss is loud.** An injector that fails to match passes the call
through, production succeeds, and the surrounding `assert.throws` gets nothing
to catch. It fails red; it cannot fail silent.

**The empty-array observer has a same-run positive control.**
`integration.js:673` decides "a same-text no-op must not write or audit" from an
**empty** `operations` array — the shape a stub that never fired also produces.
It is safe because `integration.js:664` asserts `['write', 'audit']` through the
*same* helper, `contextPath`, and production entry point in the *same* run: a
key mismatch turns 664 red before 673 can lie. That safety is
**adjacency-derived, not intrinsic** — delete 664, or move it to a different
runtime root, and 673 becomes a C.

**The hardcoded literal stub key was measured firing, and mutated.**
`governance.js:17771` keys a stub on the literal `C:\evo\project`. Measured
against the real classifier:

```text
probed spellings   ["C:\", "C:\evo", "C:\evo\project"]
literal-key hits   1
verdict            profile:reparse-point-in-ancestor-chain @ C:\evo\project

MUTATION — stub that can never fire
verdict            SAFE  →  loader calls 1, degraded false  →  the test turns red
```

The assertion is falsifiable and the reparse branch is what carries it.
`ancestorChain()` is pure string arithmetic — touching neither the `path` module
nor the filesystem — so the spellings it probes are a deterministic function of
the test's own input, and host-OS independent.

### Why the directly comparison-keyed negative judgements are covered

The first two controls generalise into one sound step:

```text
a representation miss is SILENT only when the assertion is
satisfied by the non-matching branch
```

A positive assertion that depends on the match turns red when the key misses.
An injector that misses lets production succeed, so the awaited error never
arrives — red. An observer whose array is asserted non-empty — red. The miss
survives only where the asserted value is the one a miss produces: **empty,
zero, absent, false**. That is why pass 3 enumerates negative judgements rather
than comparisons, and it is why those 22 were each inspected.

**The step this does NOT license** is concluding that a direct comparison is
the only thing that can carry a silent miss. It is not. A comparison can gate
an observer or a counter, and the negative assertion can then read that
counter — one level of indirection, same failure:

```text
representation-sensitive comparison
    → observer / counter never increments
        → assert counter === 0 passes
```

Pass 3 clears the direct form only. Anything reached through an intermediate
observer stands or falls on its own site-specific proof, the way §7 does.

## 7. Residual observations

**`C1b` / `C2b` named controls are not actually executed.**
`governance.js:20598` and `20625` assert `fs.markerWrite === 0` and
`fs.indexWrite === 0`, and name "control C1b" / "control C2b" in their failure
messages. Those names appear **only inside the message strings**. The two
executed positive controls (`peekEngineDecision === 1`,
`readContainmentState === 1`) prove the *module-level* instrumentation attached;
they do not independently prove the *fs* interception keys match — and the file
itself notes the adjacent `existsSync` check "alone cannot prove write count 0".

A **coverage observation, not a representation defect**: on the representation
axis both sides derive from one `WORKSPACE_ROOT`-rooted string and pass through
the same `norm()`, so the answer there is NO. `named control absent` is not
`observable verdict is currently wrong`.

**RECORDED ONLY — no backlog entry, no work item, no repair authorized.** If a
future real failure shows the missing independent controls let a false green
survive, that is the moment to open work on it, as a real defect.

**Methodology note.** This audit's first probe was silently mangled: the probe
script lost one level of backslash escaping in transit before the shell ever saw
it, so the JS literal collapsed and the test path became `C:evoproject...`. It
was rejected at the lexical layer, the stub never fired once, and the output was
indistinguishable from "the guarded behaviour did not occur". Caught, and the
measurement redone with paths built from `String.fromCharCode(92)` — and with
the written file re-read rather than the source trusted. Recorded as a clean
demonstration of the principle, not an open defect:

```text
stub miss
    !=
proof that the guarded behaviour does not occur
```

## 8. Closure

```text
MEASUREMENT COMPLETE            in the bounded domain of §4, not as a proof
no path.resolve → realpathSync.native sweep performed or warranted
no code repair justified        because no C was observed, not because
                                none could exist
repair NOT AUTHORIZED
```

## 9. Reopen criterion

Reopen this audit **only** on evidence demonstrating all three together:

```text
an alternate path representation actually arising
+ a viable fixture reproducing it
+ a changed PASS / FAIL / classification
```

Suspicious-looking code, or the mere presence of `path.resolve()`, is
explicitly **not** sufficient. That was the gate this audit ran under, and it is
the gate any reopening must clear.
