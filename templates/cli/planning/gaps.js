'use strict';

// Drift engine — planning scope: R003-R006, R008-R013

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const PLAN_SOURCE_PATHS = ['docs/specs', 'docs/plans', 'docs/superpowers/specs', 'docs/superpowers/plans'];
const ARCH_SOURCE_PATHS = [
    'templates/cli',
    'templates/.github',
    'templates/.codex',
    '.agents/rules',
    '.agents/workflows',
    'index.js',
    'bin/cli.js',
    'package.json',
    'docs/contracts',
    'docs/architecture',
];

function normalizePaths(list) {
    return list.map(item => item.replace(/\\/g, '/')).filter(Boolean);
}

function readChangedFilesFromEnv() {
    const raw = process.env.EVO_LITE_CHANGED_FILES;
    if (!raw) return null;
    const files = normalizePaths(raw.split(/\r?\n/).map(item => item.trim()));
    return files.length > 0 ? files : null;
}

// --- Git observation: "we looked and saw nothing" vs "we could not look" ---
//
// The governing sentence of the disposition ledger is that a failure to OBSERVE
// must never impersonate a change in FACT. Every git read below therefore
// reports HOW it went, not just what it saw: an observer that swallows a failure
// and returns an empty result is indistinguishable from a genuine absence, and
// `sync` reads absence from a complete census as proof, then tombstones a human
// decision permanently.
//
// gitOut calls execFileSync through the module object rather than a destructured
// binding, so a test can substitute a failing git without rebuilding the module
// graph — the same idiom `withPatchedExecFileSync` already serves elsewhere.
function gitOut(projectRoot, args, extra = {}) {
    return String(childProcess.execFileSync('git', args, {
        cwd: projectRoot, encoding: 'utf8', timeout: 5000, ...extra,
    })).trim();
}

// Probes must not spray git's own fatal text onto the parent's stderr: they are
// expected to fail, and that noise reads like a real error in test output.
const QUIET_GIT = Object.freeze({ stdio: ['ignore', 'pipe', 'pipe'] });

// --- Filesystem evidence, independent of whether git can be run at all ---
//
// A git probe answers "can git OPEN this repository?", which is NOT the question
// this classifier needs. Every reason git cannot open one — a deleted
// `.git/HEAD`, a dubious-ownership refusal (routine on Windows shared drives,
// Docker bind mounts, CI, and any repo cloned by another user), a corrupt object
// store, git missing from PATH — makes the probe fail exactly like "there is no
// repository here". Trusting the probe alone therefore re-arms the very
// destruction path this module exists to close: a BROKEN repo yields a silently
// empty observation under a clean census, and `sync` tombstones from it.
//
// So the probe decides nothing on its own. The filesystem is asked whether a
// repository IS there, and whether it HAS had commits.

// The `.git` entry for projectRoot or any ancestor: a directory (ordinary repo)
// or a regular file (gitfile: linked worktree / submodule).
function findGitEntry(projectRoot) {
    let dir = path.resolve(projectRoot);
    for (;;) {
        const candidate = path.join(dir, '.git');
        try {
            const st = fs.lstatSync(candidate);
            if (st.isDirectory() || st.isFile()) return candidate;
        } catch (_) { /* not here — keep walking up */ }
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

// Resolves the entry to the actual git directory. A malformed gitfile still
// counts as evidence a repository is here — that IS the broken-repo case.
function resolveGitDir(projectRoot) {
    const entry = findGitEntry(projectRoot);
    if (!entry) return null;
    try {
        if (fs.lstatSync(entry).isDirectory()) return entry;
        const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(entry, 'utf8'));
        if (!m) return entry;
        const target = m[1].trim();
        return path.isAbsolute(target) ? target : path.resolve(path.dirname(entry), target);
    } catch (_) {
        return entry;
    }
}

function isNonEmptyFile(p) {
    try { return fs.statSync(p).size > 0; } catch (_) { return false; }
}

function hasAnyRef(refsDir) {
    const stack = [refsDir];
    while (stack.length) {
        const dir = stack.pop();
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
        for (const e of entries) {
            if (e.isDirectory()) stack.push(path.join(dir, e.name));
            else return true;   // refs/heads/<anything>, including a nested feat/x
        }
    }
    return false;
}

// Has this repository EVER had a commit? Asked of the filesystem, because the
// state that makes this matter is precisely the one where git cannot answer.
//
// The reflog is first on purpose: this project's own memory records a Windows
// incident where `.git/refs/heads/main` was NUL-filled, and `.git/logs/HEAD` is
// exactly what made the sha recoverable. A repo in that state must read as
// BROKEN, never as "freshly initialised, no commits yet".
function hasCommitHistoryEvidence(gitDir) {
    if (!gitDir) return false;
    if (isNonEmptyFile(path.join(gitDir, 'logs', 'HEAD'))) return true;
    if (fs.existsSync(path.join(gitDir, 'packed-refs'))) return true;
    if (hasAnyRef(path.join(gitDir, 'refs', 'heads'))) return true;
    // A linked worktree keeps refs in the common dir, not in its own gitdir.
    try {
        const common = fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim();
        if (common) {
            const commonDir = path.isAbsolute(common) ? common : path.resolve(gitDir, common);
            if (fs.existsSync(path.join(commonDir, 'packed-refs'))) return true;
            if (hasAnyRef(path.join(commonDir, 'refs', 'heads'))) return true;
        }
    } catch (_) { /* not a linked worktree */ }
    return false;
}

// The verdicts:
//
//   'no-repository' — no `.git` at projectRoot or any ancestor. A NORMAL, fully
//                     supported state: most fixtures and many real projects are
//                     exactly this. Reporting it as an observation failure would
//                     mark every such census permanently incomplete and `sync`
//                     would never tombstone anything again — strictly worse than
//                     the bug this boundary exists to fix.
//   'no-commits'    — a repository that exists and has no commit history yet
//                     (a fresh `git init`). Also normal: there is genuinely
//                     nothing to read.
//   'unavailable'   — a repository IS here, and we still could not read what we
//                     asked for. Permissions, ownership refusal, a corrupt or
//                     truncated ref, a missing HEAD, a timeout, git absent. We
//                     could not LOOK, and that must never be reported as "there
//                     is nothing there".
//
// Only 'unavailable' may degrade a census. `memo` is an optional per-round cache
// so one workspace is classified once for the whole round.
function classifyGitFailure(projectRoot, memo = null) {
    if (memo && memo.kind) return memo.kind;
    const gitDir = resolveGitDir(projectRoot);
    let kind;
    try {
        gitOut(projectRoot, ['rev-parse', '--git-dir'], QUIET_GIT);
        try {
            gitOut(projectRoot, ['rev-parse', '--verify', 'HEAD'], QUIET_GIT);
            // git opened the repo and resolved HEAD, yet the caller's own read
            // still failed — unambiguously an observation failure.
            kind = 'unavailable';
        } catch (_) {
            kind = hasCommitHistoryEvidence(gitDir) ? 'unavailable' : 'no-commits';
        }
    } catch (_) {
        // git could not even open it. Only the ABSENCE of a repository makes
        // that a normal answer; anything else means a repository is here and
        // unreadable.
        kind = gitDir ? 'unavailable' : 'no-repository';
    }
    if (memo) memo.kind = kind;
    return kind;
}

function firstLine(err) {
    const msg = err && err.message ? String(err.message) : String(err);
    return msg.split('\n')[0].trim().slice(0, 200);
}

// A census-round observation sink. A check that could not LOOK records why here;
// a check that looked and saw nothing records nothing. The findings a degraded
// round did manage to produce are still returned — degrade the census, never the
// collection (AC7).
function createObservation() {
    const errors = [];
    const gitMemo = {};
    return {
        errors,
        gitMemo,
        unavailable(what, err) {
            const line = `${what} could not be observed: ${firstLine(err)}`;
            if (!errors.includes(line)) errors.push(line);
        },
    };
}

// Returns { files, error } — never a bare array. checkR006 short-circuits on an
// empty set, so an unreadable diff used to produce zero findings that look
// exactly like a clean tree.
function observeChangedFiles(projectRoot, options = {}, memo = null) {
    if (Array.isArray(options.changedFiles)) {
        return { files: normalizePaths(options.changedFiles), error: null };
    }

    if (options.changedFilesFromEnv) {
        const envFiles = readChangedFilesFromEnv();
        if (envFiles) return { files: envFiles, error: null };
    }

    const args = options.lastCommit
        ? ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', 'HEAD']
        : ['diff', '--name-only', 'HEAD'];
    try {
        const out = gitOut(projectRoot, args);
        return { files: out ? normalizePaths(out.split('\n')) : [], error: null };
    } catch (err) {
        if (classifyGitFailure(projectRoot, memo) !== 'unavailable') {
            return { files: [], error: null };   // genuinely nothing to read
        }
        return { files: [], error: { what: `R006 changed-file set (git ${args[0]})`, err } };
    }
}

// Legacy array-shaped accessor, kept so any caller outside this module keeps the
// shape it has always had. The census uses observeChangedFiles directly, because
// only that shape can tell absence from unavailability.
function getChangedFiles(projectRoot, options = {}) {
    return observeChangedFiles(projectRoot, options).files;
}

// Root-level project-meta files that are not product code. Listed explicitly
// so the exemption stays a single, testable predicate rather than ad-hoc filters.
const ROOT_META_FILES = new Set([
    'CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 'RTK.md',
    '.gitignore', '.gitattributes', '.editorconfig',
    'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
]);

function isGovernanceInfraFile(file) {
    const f = String(file || '').replace(/\\/g, '/').replace(/^\.\//, '');
    // R006 is a business-code traceability rule. Evo-Lite runtime state,
    // host-adapter config, and project-meta files are governance / host
    // infrastructure, not product code, so they must not be reported as
    // unlinked product files. Runtime state is also covered by specialized
    // rules (archive-evidence backfill, freshness, runtime-lock verification).
    if (f === '.evo-lite' || f.startsWith('.evo-lite/')) return true; // runtime state + mirror
    if (f === '.claude' || f.startsWith('.claude/')) return true;     // host adapter: commands, settings, skills
    // Root-level meta only (no path separator → top of repo), so nested
    // product files like docs/README.md or src/foo.lock stay traceable.
    const base = f.includes('/') ? '' : f;
    if (!base) return false;
    if (ROOT_META_FILES.has(base)) return true;
    if (/^README[^/]*\.md$/i.test(base)) return true;                 // README.md, README.zh-CN.md, …
    if (/\.lock$/i.test(base)) return true;                           // *.lock lockfiles
    return false;
}

function normalizeBacklogItem(line) {
    return String(line || '')
        .trim()
        .replace(/^[-*]\s*/, '')
        .replace(/^\[[ xX]\]\s*/, '')
        .trim()
        .toLowerCase();
}

function isPlaceholderBacklogItem(item) {
    const normalized = String(item || '').trim();
    return normalized === '' ||
        /^暂无活跃任务[。.]?$/.test(normalized) ||
        /^(no active tasks?|none|empty|n\/a)[.]?$/.test(normalized);
}

function hasArchiveEvidence(task) {
    return (task.evidence || []).some(item =>
        /^(archive:|raw:|mem_)/i.test(item) || /raw_memory\//i.test(item)
    );
}

// --- Disposition identity: canonical ids, rule versions and declared facts ---

// R011 is 2 because both its fact inputs and its claim semantics changed: it
// stopped asserting "this spec should be closed" from checkbox state and began
// reporting an authoritative closure verdict. The bump lapses every existing
// R011 disposition ONCE; every later change of fact is the fingerprint's job.
const PLANNING_RULE_VERSIONS = Object.freeze({
    R003: 1, R004: 1, R005: 1, R006: 1, R008: 1,
    R009: 1, R010: 1, R011: 2, R012: 1, R013: 1,
});

// Mechanical id migrations — only for rules whose new id is derivable from the
// old one. R006 and R010 are NOT here: their ids depend on facts that exist
// inside the check function and cannot be recovered from a display string.
// R005/R008/R011/R012 need no entry — their subject id is already self-prefixed.
const ID_MIGRATIONS = {
    R003: () => 'R003:repo:specs',
    R004: () => 'R004:repo:plans',
    R009: f => `R009:ir:${f.id.slice('R009:'.length)}`,
    R013: f => `R013:context:${f.id.slice('R013:'.length)}`,
};

function sha256(value) {
    return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

// --- R003 ---

function checkR003(projectRoot) {
    const dirs = ['docs/specs', 'docs/superpowers/specs'];
    const hasSpecs = dirs.some(d => {
        const abs = path.join(projectRoot, d);
        return fs.existsSync(abs) && fs.readdirSync(abs).some(f => f.endsWith('.md'));
    });
    if (hasSpecs) return [];
    return [{
        id: 'R003', rule: 'R003', scope: 'planning', level: 'info',
        type: 'no-specs',
        message: 'No spec files found in docs/specs/ or docs/superpowers/specs/',
        evidence: [],
        suggestedAction: 'Create a spec file in docs/specs/ with id: spec:<slug> frontmatter',
        factInputs: {},
    }];
}

// --- R004 ---

function checkR004(projectRoot) {
    const dirs = ['docs/plans', 'docs/superpowers/plans'];
    const hasPlans = dirs.some(d => {
        const abs = path.join(projectRoot, d);
        return fs.existsSync(abs) && fs.readdirSync(abs).some(f => f.endsWith('.md'));
    });
    if (hasPlans) return [];
    return [{
        id: 'R004', rule: 'R004', scope: 'planning', level: 'info',
        type: 'no-plans',
        message: 'No plan files found in docs/plans/ or docs/superpowers/plans/',
        evidence: [],
        suggestedAction: 'Create a plan file in docs/plans/ with id: plan:<slug> frontmatter',
        factInputs: {},
    }];
}

// --- R005 ---

function checkR005(planIR) {
    if (!planIR) return [];
    return (planIR.tasks || [])
        .filter(t => !t.readOnly && t.status !== 'planning-only' && (!t.linkedFiles || t.linkedFiles.length === 0))
        .map(t => ({
            id: `R005:${t.id}`, rule: 'R005', scope: 'planning', level: 'warning',
            type: 'no-linked-files',
            message: `Task ${t.id} has no linkedFiles`,
            evidence: [t.sourcePath],
            suggestedAction: `Add "- files: <path>" to task ${t.id} in ${t.sourcePath}`,
            factInputs: {},
        }));
}

// --- R006 ---

// An occurrence identity, NOT the file's bytes. Hashing content — or even the
// (oldBlob,newBlob) pair — lets a lapsed disposition revive by rollback:
//   C1 A->B (dispositioned) / C2 B->A (stale) / C3 A->B  <- identical to C1.
// A working-tree diff has no such identity, so those findings are marked
// non-dispositionable rather than given a fingerprint that collides.
function changeOccurrence(projectRoot, options, observation = null) {
    if (!options.lastCommit) return null;
    try {
        return gitOut(projectRoot, ['rev-parse', 'HEAD']);
    } catch (err) {
        // A null occurrence is not merely "non-dispositionable": it also REWRITES
        // factInputs.occurrence, so a live decision would lapse because git
        // hiccuped rather than because the change did.
        if (observation && classifyGitFailure(projectRoot, observation.gitMemo) === 'unavailable') {
            observation.unavailable('R006 change occurrence (git rev-parse HEAD)', err);
        }
        return null;
    }
}

function changeStatusOf(projectRoot, file, options, observation = null) {
    if (!options.lastCommit) return 'worktree';
    try {
        return (gitOut(projectRoot, ['diff-tree', '--no-commit-id', '--name-status',
            '-r', '--root', 'HEAD', '--', file]) || 'M').split(/\s+/)[0];
    } catch (err) {
        if (observation && classifyGitFailure(projectRoot, observation.gitMemo) === 'unavailable') {
            observation.unavailable(`R006 change status of ${file} (git diff-tree)`, err);
        }
        return 'M';
    }
}

function checkR006(projectRoot, planIR, options = {}, observation = null) {
    if (!planIR) return [];
    const observed = observeChangedFiles(projectRoot, options, observation && observation.gitMemo);
    if (observed.error && observation) observation.unavailable(observed.error.what, observed.error.err);
    const changedFiles = observed.files.filter(f => !isGovernanceInfraFile(f));
    if (changedFiles.length === 0) return [];

    const linkedFiles = new Set((planIR.tasks || []).flatMap(t => t.linkedFiles || []));
    const occurrence = changeOccurrence(projectRoot, options, observation);
    return changedFiles.filter(f => !linkedFiles.has(f)).map((f) => ({
        id: `R006:file:${f}`, rule: 'R006', scope: 'planning', level: 'warning',
        type: 'unlinked-file',
        message: `Changed file not linked to any task: ${f}`,
        evidence: [f],
        suggestedAction: `Link ${f} to a task in docs/plans/ or create a new task`,
        factInputs: { path: f, status: changeStatusOf(projectRoot, f, options, observation), occurrence },
        dispositionable: occurrence != null,
    }));
}

// --- R008 ---

function checkR008(planIR) {
    if (!planIR) return [];
    return (planIR.tasks || [])
        .filter(t => !t.readOnly &&
            !t.planR008Exempt &&
            (t.status === 'implemented' || t.status === 'verified') &&
            !hasArchiveEvidence(t))
        .map(t => ({
            id: `R008:${t.id}`, rule: 'R008', scope: 'planning', level: 'warning',
            type: 'no-evidence',
            message: `Task ${t.id} (${t.status}) has no archive evidence`,
            evidence: [t.sourcePath],
            suggestedAction: `Run mem archive after completing ${t.id} to record evidence`,
            factInputs: { taskStatus: t.status, archiveHits: t.archiveHits || 0 },
        }));
}

// --- R009 ---

function checkR009(projectRoot) {
    const findings = [];

    function checkNewerThan(irMtime, absPath) {
        if (!fs.existsSync(absPath)) return false;
        const stat = fs.statSync(absPath);
        if (stat.isFile()) return stat.mtimeMs > irMtime;
        for (const entry of fs.readdirSync(absPath, { withFileTypes: true })) {
            if (checkNewerThan(irMtime, path.join(absPath, entry.name))) return true;
        }
        return false;
    }

    function check(irPath, sourcePaths, label) {
        if (!fs.existsSync(irPath)) return;
        const irMtime = fs.statSync(irPath).mtimeMs;
        for (const src of sourcePaths) {
            const abs = path.resolve(projectRoot, src);
            if (checkNewerThan(irMtime, abs)) {
                findings.push({
                    id: `R009:${label}`, rule: 'R009', scope: 'planning', level: 'info',
                    type: 'stale-ir',
                    message: `${label} IR is stale — ${src} is newer`,
                    evidence: [path.relative(projectRoot, irPath).replace(/\\/g, '/')],
                    suggestedAction: label === 'plan' ? 'Run: mem plan scan' : 'Run: mem architecture scan',
                    factInputs: {},
                });
                return;
            }
        }
    }

    check(
        path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json'),
        PLAN_SOURCE_PATHS,
        'plan'
    );
    check(
        path.join(projectRoot, '.evo-lite', 'generated', 'architecture', 'architecture-ir.json'),
        ARCH_SOURCE_PATHS,
        'architecture'
    );
    return findings;
}

// --- R010 ---

function checkR010(projectRoot, planIR) {
    if (!planIR) return [];
    const ctxPath = path.join(projectRoot, '.evo-lite', 'active_context.md');
    if (!fs.existsSync(ctxPath)) return [];

    const content = fs.readFileSync(ctxPath, 'utf8');
    const section = content.match(/<!-- BEGIN_BACKLOG -->([\s\S]*?)<!-- END_BACKLOG -->/);
    if (!section) return [];

    const backlogItems = section[1].split('\n')
        .map(l => l.trim()).filter(l => l.startsWith('-'))
        .map(normalizeBacklogItem)
        .filter(item => !isPlaceholderBacklogItem(item));
    if (backlogItems.length === 0) return [];

    // A task with no title does not participate in title matching — coercing
    // it to '' would make `item.includes('')` (always true) suppress every
    // backlog item, silently erasing the whole rule's output. Absence of a
    // title must not read as absence of a finding.
    const taskTitles = (planIR.tasks || []).map(t => t.title).filter(Boolean).map(t => t.toLowerCase());
    const taskIds = (planIR.tasks || []).map(t => t.id.toLowerCase());

    return backlogItems
        .filter(item => {
            return !taskTitles.some(t => item.includes(t) || t.includes(item)) &&
                   !taskIds.some(id => item.includes(id));
        })
        .map(item => {
            // The bracketed label is the item's identity. The old id used the first 40
            // characters of prose, which fractures on any rewording and silently orphans
            // the decision for what is the same item. The digest covers the FULL
            // normalized text, never the truncated display message.
            const normalizedItemText = String(item).replace(/\s+/g, ' ').trim();
            const labelMatch = /^\s*\[([^\]]+)\]/.exec(normalizedItemText);
            const backlogKey = labelMatch ? labelMatch[1] : sha256(normalizedItemText).slice(0, 16);
            return {
                id: `R010:backlog:${backlogKey}`, rule: 'R010', scope: 'planning', level: 'info',
                type: 'untracked-backlog',
                message: `Backlog item not in Planning IR: "${normalizedItemText.slice(0, 80)}"`,
                evidence: ['.evo-lite/active_context.md'],
                suggestedAction: 'Add a task to docs/plans/ that covers this backlog item',
                factInputs: { itemTextDigest: sha256(normalizedItemText) },
            };
        });
}

// --- R011 ---

// R011 is a closure ROUTER, not a closure judge.
//
// It used to read `t.status === 'implemented'` — a hand-ticked checkbox — and
// tell the operator to set `status: done`. close-preview.js had already ruled
// that task completion is "Advisory only — NEVER affects readiness", so R011
// was a second, weaker authority over a question that already had a designed
// one, recommending the exact terminal act that ruling governs.
//
// Checkboxes now decide one thing only: that a spec is worth CHECKING. The
// verdict comes from readinessOf(), which R011 renders and never recomputes.
const R011_TYPE_BY_READINESS = Object.freeze({
    'READY': 'spec-closure-ready',
    'BLOCKED': 'spec-closure-not-ready',
    'NO-CONTRACT': 'spec-closure-uncontracted',
});
// Frozen ARRAYS, not Sets — this repo has been bitten by Object.freeze(new Set())
// reporting frozen while add() still works. Lookup is .includes().
const R011_INFO_TYPES = Object.freeze(['spec-closure-ready']);
const R011_NON_DISPOSITIONABLE = Object.freeze(['spec-closure-ready', 'spec-closure-unobservable']);

// The one derivation. Every state goes through it, including unobservable:
// two hand-written strings that happen to agree are not an identity contract.
function r011ClosureState(type) {
    return String(type).replace(/^spec-closure-/, '');
}

// Presence evidence, for the operator's eyes only.
//
// This function CONSUMES a verdict; it does not reach one. `hasPositiveEvidence`
// is progress.js's conclusion, and reading `gitRefs` / `linkedFilesTotal` /
// `linkedFilesExist` here to re-derive it would rebuild the predicate one layer
// down — AC2 forbids any duplicate of an evidence predicate in this file, and
// that is the same "weaker second authority" shape this whole change deletes.
// The confidence band is deliberately NOT read: the spec keeps it in progress.js
// so a display heuristic cannot look authoritative.
//
// readOnly tasks are excluded, matching R005 (gaps.js:365) and R008 (gaps.js:436):
// they are exempt from implementation evidence by design, so listing one as
// having "no evidence of its own" would be a false prompt to a human.
//
// Best-effort by design. Presence never selects a state and never reaches
// factInputs, so failing to read it withholds context — it makes no claim about
// the spec, and must not degrade the census the way an unreadable READINESS does.
function r011Unevidenced(planIR, plans, projectRoot, options) {
    const evaluate = options.evidenceFn
        || ((task, root) => require('./progress').evaluateTask(task, root));
    const planIds = plans.map(p => p.id);
    const tasks = (planIR.tasks || []).filter(t => planIds.includes(t.linkedPlan) && !t.readOnly);
    try {
        return tasks.filter(t => {
            const e = evaluate(t, projectRoot);
            return !!e && !!e.evidence && e.evidence.hasPositiveEvidence === false;
        }).map(t => t.id);
    } catch (_) {
        return null;   // null = "not read", distinct from [] = "read, none found"
    }
}

function r011EvidenceClause(unevidenced) {
    if (unevidenced === null) return ' (linked task evidence could not be read)';
    if (!unevidenced.length) return '';
    return ` — tasks with no evidence of their own: ${unevidenced.join(', ')}`;
}

function r011Message(spec, plans, type, blockerIds, unevidenced) {
    const shape = plans.length > 1
        ? `all ${plans.length} linked plans are checkbox-complete`
        : `linked plan ${plans[0].id} is checkbox-complete`;
    if (type === 'spec-closure-ready') {
        return `Spec ${spec.id} is [${spec.status}] and its acceptance contract is satisfied — ${shape}`;
    }
    if (type === 'spec-closure-not-ready') {
        return `Spec ${spec.id} is [${spec.status}] and ${shape}, but its acceptance contract is not satisfied: `
            + `${blockerIds.join(', ')}${r011EvidenceClause(unevidenced)}`;
    }
    return `Spec ${spec.id} is [${spec.status}] and ${shape}, but has no machine-readable acceptance contract`
        + ` — checkbox state is not closure evidence${r011EvidenceClause(unevidenced)}`;
}

function r011Action(spec, type) {
    if (type === 'spec-closure-ready') {
        // A PATH, not an id: close-commands.js passes this argument straight to
        // fs.readFileSync. `mem close spec:foo --preview` is ENOENT, not a preview.
        return `Run the close transaction: mem close ${spec.sourcePath} --preview`;
    }
    if (type === 'spec-closure-not-ready') {
        return `Resolve the failing criteria in ${spec.sourcePath}, then re-check readiness`;
    }
    return `Add or repair the acceptance criteria block in ${spec.sourcePath} so closure has an authoritative verdict`;
}

function checkR011(projectRoot, planIR, options = {}, observation = null) {
    if (!planIR) return [];
    const specMap = new Map((planIR.specs || []).map(s => [s.id, s]));

    // Group plans by spec: a spec is only "done in practice" when EVERY linked
    // plan is complete. A parked/draft sibling with open (or no) tasks keeps the
    // spec open by design — e.g. a shipped Phase 4a plan + a parked Phase 4b
    // plan on the same spec must NOT trigger the status: done nag. Grouping also
    // guarantees one finding per spec (the per-plan loop emitted duplicate
    // `R011:<spec>` ids when two complete plans shared a spec).
    const bySpec = new Map();
    for (const plan of (planIR.plans || [])) {
        if (!plan.linkedSpec) continue;
        if (!bySpec.has(plan.linkedSpec)) bySpec.set(plan.linkedSpec, []);
        bySpec.get(plan.linkedSpec).push(plan);
    }

    const findings = [];
    for (const [specId, plans] of bySpec) {
        const spec = specMap.get(specId);
        if (!spec || spec.status === 'done') continue;

        const isComplete = plan => {
            const planTasks = (planIR.tasks || []).filter(t => t.linkedPlan === plan.id);
            return planTasks.length > 0 && planTasks.every(t => t.readOnly || t.status === 'implemented');
        };
        if (!plans.every(isComplete)) continue;

        const readinessFn = options.readinessFn
            || ((sp) => require('../verification/close-preview').readinessOf(sp, { root: projectRoot }));
        const specPath = path.join(projectRoot, spec.sourcePath);
        let verdict;
        try {
            verdict = readinessFn(specPath, spec);
            // One protocol guard over the whole authority result, not one patch
            // per field. A verdict this rule cannot consume is a failure to
            // OBSERVE the authority, not a fact about the spec — so it goes to
            // the unobservable path already designed for "we could not look":
            // no advice, not dispositionable, census degraded. No fifth state,
            // and nothing guessed.
            //
            // Two ways the old code failed without it. An unmappable `readiness`
            // left `type` undefined and both renderers fell through to their
            // last branch, asserting the spec "has no machine-readable
            // acceptance contract" and telling the operator to add one — a
            // positive claim about a spec that may well have one, on a finding
            // a human was then invited to dispose of. And a `blockers` that is
            // not a well-formed array crashed `.map` OUTSIDE this try, taking
            // the whole census down instead of degrading it.
            //
            // The element check is not paranoia: `[{}]` passes Array.isArray and
            // renders as the blocker id "undefined=undefined", which then enters
            // the message AND the fingerprint — a fabricated fact, silently.
            //
            // `blockers` is a contract field of readinessOf's frozen surface, so
            // absent is NOT tolerated here. The `|| []` this replaces was old
            // defensive slack, and slack must not be read back as the contract.
            const readiness = verdict && verdict.readiness;
            const blockers = verdict && verdict.blockers;
            const validBlockers = Array.isArray(blockers) && blockers.every(b =>
                b && typeof b === 'object'
                && typeof b.criterionId === 'string' && b.criterionId.length > 0
                && typeof b.verdict === 'string' && b.verdict.length > 0);
            if (!R011_TYPE_BY_READINESS[readiness] || !validBlockers) {
                throw new Error('R011 received unsupported closure readiness result: '
                    + JSON.stringify(verdict));
            }
        } catch (err) {
            // Retain the finding, withdraw the advice. Suppressing it would remove
            // it from the census, and `sync` reads an absence from a COMPLETE
            // census as proof — tombstoning a human decision terminally. Degrading
            // the census is the conservative direction; erasing the finding is not.
            if (observation) {
                observation.unavailable(`R011 closure readiness for ${spec.id}`, err);
            }
            // Every type-derived field comes from this one `type`, exactly as the
            // healthy branch below does. Hand-writing `level: 'warning'` and
            // `dispositionable: false` here would agree with the tables today and
            // silently stop agreeing the day either table changes — the same
            // "two hand-written things that agree is not an identity contract"
            // this file already refuses for closureState.
            const type = 'spec-closure-unobservable';
            findings.push({
                id: `R011:${spec.id}`,
                rule: 'R011',
                scope: 'planning',
                level: R011_INFO_TYPES.includes(type) ? 'info' : 'warning',
                type,
                message: `Spec ${spec.id} closure readiness could not be read: ${err && err.message ? err.message : String(err)}`,
                evidence: [spec.sourcePath],
                suggestedAction: null,
                dispositionable: !R011_NON_DISPOSITIONABLE.includes(type),
                factInputs: { closureState: r011ClosureState(type) },
            });
            continue;
        }

        const type = R011_TYPE_BY_READINESS[verdict.readiness];
        // No `|| []` fallback: the guard above has already established that
        // blockers is a well-formed array. Leaving the fallback would state,
        // in code, that absent blockers are legal — which is exactly the slack
        // the guard exists to remove.
        const blockerIds = verdict.blockers.map(b => `${b.criterionId}=${b.verdict}`).sort();

        findings.push({
            id: `R011:${spec.id}`,
            rule: 'R011',
            scope: 'planning',
            level: R011_INFO_TYPES.includes(type) ? 'info' : 'warning',
            type,
            message: r011Message(spec, plans, type, blockerIds, r011Unevidenced(planIR, plans, projectRoot, options)),
            evidence: [spec.sourcePath],
            suggestedAction: r011Action(spec, type),
            dispositionable: !R011_NON_DISPOSITIONABLE.includes(type),
            factInputs: verdict.validationIdentity
                ? { closureState: r011ClosureState(type), blockers: blockerIds, validationIdentity: verdict.validationIdentity }
                : { closureState: r011ClosureState(type), blockers: blockerIds },
        });
    }
    return findings;
}

// --- R012 ---

// Squash to alphanumerics so "Phase 1" (prose) matches "phase1" (slug) and
// punctuation/spacing differences never break the focus → plan resolution.
function squashForMatch(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function readFocusText(projectRoot) {
    const focusPath = path.join(projectRoot, '.evo-lite', 'active_context.md');
    if (!fs.existsSync(focusPath)) return '';
    const md = fs.readFileSync(focusPath, 'utf8');
    const m = md.match(/<!--\s*BEGIN_FOCUS\s*-->([\s\S]*?)<!--\s*END_FOCUS\s*-->/);
    return m ? m[1].trim() : '';
}

// R012 — phantom focus: the current focus points at a plan that has not really
// started (status: draft, or 0 tasks done). The >24h staleness alert only
// caught this indirectly; this names the plan and its task count directly.
function checkR012(projectRoot, planIR, options = {}) {
    if (!planIR) return [];
    const focusText = options.focusText != null ? options.focusText : readFocusText(projectRoot);
    if (!focusText) return [];
    const squashedFocus = squashForMatch(focusText);
    if (!squashedFocus) return [];

    const findings = [];
    for (const plan of (planIR.plans || [])) {
        const slug = String(plan.id || '').replace(/^plan:/, '');
        const squashedSlug = squashForMatch(slug);
        const squashedTitle = squashForMatch(plan.title);
        const referenced =
            (plan.id && focusText.includes(plan.id)) ||                       // literal plan:<slug>
            (squashedSlug && squashedFocus.includes(squashedSlug)) ||         // slug words in prose
            (squashedTitle && squashedFocus.includes(squashedTitle));         // plan title in prose
        if (!referenced) continue;

        const planTasks = (planIR.tasks || []).filter(t => t.linkedPlan === plan.id);
        const total = planTasks.length;
        const done = planTasks.filter(t => t.status === 'implemented' || t.status === 'verified').length;
        const unstarted = plan.status === 'draft' || done === 0;
        if (!unstarted) continue; // focus points at a started/advanced plan — healthy

        findings.push({
            id: `R012:${plan.id}`,
            rule: 'R012',
            scope: 'planning',
            level: 'warning',
            type: 'phantom-focus',
            message: `Focus points at plan ${plan.id} [${plan.status}] with ${done}/${total} tasks done — it is not a started, active plan`,
            evidence: [plan.sourcePath].filter(Boolean),
            suggestedAction: `Advance focus to a started plan (mem focus), or begin ${plan.id}`,
            factInputs: { planStatus: plan.status, doneCount: done, totalCount: total },
        });
    }
    return findings;
}

// --- R013 ---

// Read the structured META git fields from active_context.md. These are the ONLY
// machine-checkable git-state source R013 trusts — FOCUS prose is never parsed.
function readMetaGitState(projectRoot) {
    const p = path.join(projectRoot, '.evo-lite', 'active_context.md');
    if (!fs.existsSync(p)) return null;
    const md = fs.readFileSync(p, 'utf8');
    const m = md.match(/<!--\s*BEGIN_META\s*-->([\s\S]*?)<!--\s*END_META\s*-->/);
    if (!m) return null;
    const block = m[1];
    const field = (name) => {
        const fm = block.match(new RegExp(`${name}:\\s*(\\S+)`, 'i'));
        return fm ? fm[1] : null;
    };
    return { headSha: field('headSha'), ahead: field('ahead'), behind: field('behind') };
}

// Read live git state via argv-form git (never string-interpolated). Injectable
// via options.gitState for tests.
//
// Returns { git, error }. A bare null used to mean two incompatible things —
// "not a git repo, so R013 has nothing to check" and "git blew up, so R013
// could not check" — and checkR013 silently emitted nothing for both.
// EXISTENCE, not resolvability.
//
// `git rev-parse @{u}` resolves the REMOTE-TRACKING REF, which `fetch --prune`
// deletes the moment the remote branch goes away — while `branch.<name>.merge`
// still declares an upstream. Asking `@{u}` would call that "no upstream", and
// R013:sync would vanish under a clean census. But the ahead/behind it compares
// is not "now in agreement" — it is UNKNOWABLE, which is the definition of an
// observation failure under this module's own rule. The declaration lives in
// config, so that is what is asked.
//
// A detached HEAD genuinely cannot declare an upstream, and is not a failure.
function hasDeclaredUpstream(projectRoot) {
    let branch;
    try { branch = gitOut(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], QUIET_GIT); }
    catch (_) { return false; }
    if (!branch || branch === 'HEAD') return false;
    try {
        return gitOut(projectRoot, ['config', '--get', `branch.${branch}.merge`], QUIET_GIT) !== '';
    } catch (_) {
        return false;   // `config --get` exits 1 when the key is not set
    }
}

function observeGitState(projectRoot, memo = null) {
    let headSha;
    try {
        headSha = gitOut(projectRoot, ['rev-parse', 'HEAD']);
    } catch (err) {
        if (classifyGitFailure(projectRoot, memo) !== 'unavailable') {
            return { git: null, error: null }; // no repo / unborn HEAD — R013 stays silent, by design
        }
        return { git: null, error: { what: 'R013 live git state (git rev-parse HEAD)', err } };
    }

    let hasUpstream = true, ahead = 0, behind = 0, error = null;
    try {
        const lr = gitOut(projectRoot, ['rev-list', '--left-right', '--count', '@{u}...HEAD']).split(/\s+/);
        behind = parseInt(lr[0], 10) || 0; ahead = parseInt(lr[1], 10) || 0;
    } catch (err) {
        hasUpstream = false;
        // "no upstream configured" is the normal answer and must stay silent. An
        // upstream that EXISTS but could not be counted is an observation failure
        // that would otherwise erase every R013:sync finding without a trace.
        if (hasDeclaredUpstream(projectRoot)) {
            error = { what: 'R013 ahead/behind (git rev-list @{u}...HEAD)', err };
        }
    }

    return {
        git: {
            headSha, ahead, behind, hasUpstream,
            isAncestorOfHead: (sha) => {
                if (sha === headSha) return true;
                try { gitOut(projectRoot, ['merge-base', '--is-ancestor', sha, 'HEAD'], QUIET_GIT); return true; }
                catch (_) { return false; }
            },
        },
        error,
    };
}

function checkR013(projectRoot, options = {}, observation = null) {
    const meta = options.metaState != null ? options.metaState : readMetaGitState(projectRoot);
    if (!meta || !meta.headSha) return []; // no structured state to check
    let git;
    if (options.gitState != null) {
        git = options.gitState;
    } else {
        const observed = observeGitState(projectRoot, observation && observation.gitMemo);
        git = observed.git;
        if (observed.error && observation) observation.unavailable(observed.error.what, observed.error.err);
    }
    if (!git) return [];
    const findings = [];
    if (!git.isAncestorOfHead(meta.headSha)) {
        findings.push({
            id: 'R013:head', rule: 'R013', scope: 'planning', level: 'warning', type: 'active-context-remote-drift',
            message: `active_context META headSha ${meta.headSha} is not HEAD (${git.headSha}) nor an ancestor — the recorded project position is stale`,
            evidence: ['.evo-lite/active_context.md'],
            suggestedAction: 'Run `mem commit` / `context track` to refresh the META git fields, or update focus',
            factInputs: { declaredHeadSha: meta.headSha },
        });
    }
    if (git.hasUpstream) {
        const metaAhead = meta.ahead == null ? null : parseInt(meta.ahead, 10);
        const metaBehind = meta.behind == null ? null : parseInt(meta.behind, 10);
        if ((metaAhead != null && metaAhead !== git.ahead) || (metaBehind != null && metaBehind !== git.behind)) {
            findings.push({
                id: 'R013:sync', rule: 'R013', scope: 'planning', level: 'warning', type: 'active-context-remote-drift',
                message: `active_context META ahead/behind (${meta.ahead}/${meta.behind}) disagrees with git (${git.ahead}/${git.behind})`,
                evidence: ['.evo-lite/active_context.md'],
                suggestedAction: 'Refresh META via `mem commit` / `context track`',
                factInputs: { declaredAhead: meta.ahead, declaredBehind: meta.behind },
            });
        }
    }
    return findings;
}

// --- Public ---

function runPlanningDriftCensus(projectRoot, planIR, options = {}) {
    const errors = [];
    if (!planIR) errors.push('plan-ir.json is missing or unreadable — run `mem plan scan`');

    // Observation failures are collected DURING the round and folded into
    // `errors` after it. They degrade `complete`; they never remove a finding.
    const observation = createObservation();

    const findings = [
        ...checkR003(projectRoot), ...checkR004(projectRoot), ...checkR005(planIR),
        ...checkR006(projectRoot, planIR, options, observation), ...checkR008(planIR),
        ...checkR009(projectRoot), ...checkR010(projectRoot, planIR),
        ...checkR011(projectRoot, planIR, options, observation), ...checkR012(projectRoot, planIR, options),
        ...checkR013(projectRoot, options, observation),
    ].map(f => ({
        ...f,
        id: (ID_MIGRATIONS[f.rule] || (() => f.id))(f),
        ruleId: f.rule,
        ruleVersion: PLANNING_RULE_VERSIONS[f.rule],
        factInputs: f.factInputs || {},
    }));

    errors.push(...observation.errors);
    return { findings, complete: errors.length === 0, errors };
}

function runPlanningDrift(projectRoot, planIR, options = {}) {
    return runPlanningDriftCensus(projectRoot, planIR, options).findings;
}

module.exports = {
    runPlanningDrift,
    runPlanningDriftCensus,
    PLANNING_RULE_VERSIONS,
    checkR006,
    checkR008,
    checkR009,
    checkR011,
    r011ClosureState,
    checkR012,
    checkR013,
    getChangedFiles,
    observeChangedFiles,
    // The ONE git-failure classifier. spec-portfolio imports it rather than
    // growing a second implementation that could disagree about where the
    // "normal absence" / "could not observe" boundary sits.
    classifyGitFailure,
    hasArchiveEvidence,
    isGovernanceInfraFile,
    normalizeBacklogItem,
    isPlaceholderBacklogItem,
    PLAN_SOURCE_PATHS,
    ARCH_SOURCE_PATHS,
};
