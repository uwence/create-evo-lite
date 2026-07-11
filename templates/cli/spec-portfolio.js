'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseSpecFile, parseFrontmatter } = require('./planning/parse-markdown');
const { getWorkspaceRoot } = require('./runtime');

const SIZE_THRESHOLDS = Object.freeze({ acCount: 8, phaseCount: 3, dependsOnCount: 12, chars: 40000 });
const DEFAULT_AGING_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function readJsonSafe(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return null;
    }
}

function loadAgingDays(projectRoot) {
    const config = readJsonSafe(path.join(projectRoot, '.evo-lite', 'config.json'));
    const days = config && config.specPortfolio && config.specPortfolio.agingDays;
    return typeof days === 'number' && days > 0 ? days : DEFAULT_AGING_DAYS;
}

function loadPlanIR(projectRoot) {
    const ir = readJsonSafe(path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json'));
    if (!ir || !Array.isArray(ir.plans)) return { plans: [] };
    return ir;
}

function listSpecFiles(projectRoot) {
    const dir = path.join(projectRoot, 'docs', 'specs');
    if (!fs.existsSync(dir)) return [];
    try {
        return fs.readdirSync(dir)
            .filter(f => f.endsWith('.md'))
            .map(f => path.join(dir, f));
    } catch (_) {
        return [];
    }
}

function gitLastCommitISO(projectRoot, relFile) {
    try {
        const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', relFile], {
            cwd: projectRoot, encoding: 'utf8', timeout: 5000,
        }).trim();
        return out || null;
    } catch (_) {
        return null;
    }
}

function mtimeISO(absPath) {
    try {
        return fs.statSync(absPath).mtime.toISOString();
    } catch (_) {
        return null;
    }
}

// lastTouchedAt = max of `git log -1 --format=%cI -- <file>` across the spec file and
// each linked plan file; falls back to file mtime when git is unavailable/file untracked.
// Never throws.
function resolveLastTouchedAt(projectRoot, relFiles) {
    let max = null;
    let maxEpoch = -Infinity;
    for (const relFile of relFiles) {
        if (!relFile) continue;
        const posixRel = relFile.replace(/\\/g, '/');
        let iso = gitLastCommitISO(projectRoot, posixRel);
        if (!iso) {
            iso = mtimeISO(path.join(projectRoot, relFile));
        }
        if (!iso) continue;
        const epoch = Date.parse(iso);
        if (Number.isNaN(epoch)) continue;
        if (epoch > maxEpoch) {
            maxEpoch = epoch;
            max = iso;
        }
    }
    return max;
}

// The LAST ```json fenced block in the file that contains a `"criteria"` key.
function extractLastCriteriaArray(content) {
    const re = /```json\s*\n([\s\S]*?)```/g;
    let match;
    let lastBlock = null;
    while ((match = re.exec(content)) !== null) {
        if (match[1].includes('"criteria"')) lastBlock = match[1];
    }
    if (!lastBlock) return [];
    try {
        const parsed = JSON.parse(lastBlock);
        return Array.isArray(parsed.criteria) ? parsed.criteria : [];
    } catch (_) {
        return [];
    }
}

function computeSizeMetrics(content, body) {
    const criteria = extractLastCriteriaArray(content);
    const acCount = criteria.length;

    let phaseCount = (body.match(/^### Phase /gm) || []).length;
    if (phaseCount === 0) {
        phaseCount = (body.match(/^#{2,3} .*Phase/gmi) || []).length;
    }

    const dependsOnSet = new Set();
    for (const criterion of criteria) {
        if (criterion && Array.isArray(criterion.dependsOn)) {
            for (const dep of criterion.dependsOn) dependsOnSet.add(dep);
        }
    }

    return {
        acCount,
        phaseCount,
        dependsOnCount: dependsOnSet.size,
        chars: content.length,
    };
}

function isSizeExceeded(size) {
    return size.acCount > SIZE_THRESHOLDS.acCount
        || size.phaseCount > SIZE_THRESHOLDS.phaseCount
        || size.dependsOnCount > SIZE_THRESHOLDS.dependsOnCount
        || size.chars > SIZE_THRESHOLDS.chars;
}

function parseRelations(frontmatter) {
    if (!frontmatter || !frontmatter.relations) return [];
    try {
        const parsed = JSON.parse(frontmatter.relations);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

// buildSpecRegistry(projectRoot, opts) never throws for normal degradation
// (no git, no docs/specs dir, no plan-ir) — it returns a registry with an
// empty specs array / null lastTouchedAt per entry instead.
function buildSpecRegistry(projectRoot, opts = {}) {
    const write = opts.write !== false;
    const agingDays = loadAgingDays(projectRoot);
    const ir = loadPlanIR(projectRoot);
    const plansById = new Map();
    for (const plan of ir.plans) {
        if (plan && plan.id) plansById.set(plan.id, plan);
    }

    const specs = [];
    for (const absPath of listSpecFiles(projectRoot)) {
        let parsed = null;
        try {
            parsed = parseSpecFile(absPath);
        } catch (_) {
            parsed = null;
        }
        if (!parsed) continue;

        let content = '';
        try {
            content = fs.readFileSync(absPath, 'utf8');
        } catch (_) {
            content = '';
        }
        const { frontmatter, body } = parseFrontmatter(content);
        const relSpecPath = path.relative(projectRoot, absPath).replace(/\\/g, '/');

        // Bidirectional linked-plan resolution: spec-declared linkedPlans UNION
        // plans in plan-ir whose linkedSpec points back at this spec.
        const linkedSet = new Set(parsed.linkedPlans || []);
        for (const plan of ir.plans) {
            if (plan && plan.linkedSpec === parsed.id && plan.id) linkedSet.add(plan.id);
        }
        const linkedPlans = Array.from(linkedSet).sort();

        // A referenced plan absent from plan-ir is conservatively treated as not-done.
        const notDonePlans = linkedPlans.filter(planId => {
            const plan = plansById.get(planId);
            return !plan || plan.status !== 'done';
        });
        const anyPlanNotDone = notDonePlans.length > 0;

        const touchFiles = [relSpecPath];
        for (const planId of linkedPlans) {
            const plan = plansById.get(planId);
            if (plan && plan.sourcePath) touchFiles.push(plan.sourcePath);
        }
        const lastTouchedAt = resolveLastTouchedAt(projectRoot, touchFiles);
        const idleDays = lastTouchedAt ? Math.floor((Date.now() - Date.parse(lastTouchedAt)) / DAY_MS) : 0;

        const size = computeSizeMetrics(content, body);
        const sizeExceeded = isSizeExceeded(size);
        const sizeWaiver = (frontmatter && frontmatter.sizeWaiver) || null;

        const status = (frontmatter && frontmatter.status) || parsed.status;
        const warnings = [];
        let state;

        if (status === 'done') {
            state = 'shipped';
        } else if (status === 'parked') {
            state = 'parked';
            if (linkedPlans.length > 0 && anyPlanNotDone) warnings.push('zombie-plan');
        } else if (linkedPlans.length === 0) {
            state = 'adopted';
            if (idleDays > agingDays) warnings.push('aging-no-plan');
        } else {
            state = 'active';
            if (anyPlanNotDone && idleDays > agingDays) warnings.push('aging-inactive');
        }

        if (sizeExceeded && !sizeWaiver) warnings.push('size-exceeded');

        specs.push({
            id: parsed.id,
            file: relSpecPath,
            state,
            linkedPlans,
            lastTouchedAt,
            idleDays,
            size,
            sizeExceeded,
            sizeWaiver,
            relations: parseRelations(frontmatter),
            relationMode: (frontmatter && frontmatter.relationMode) || null,
            notDonePlans,
            warnings,
        });
    }

    const registry = {
        version: 'evo-spec-registry@1',
        generatedAt: new Date().toISOString(),
        agingDays,
        specs,
    };

    if (write) {
        try {
            const outPath = path.join(projectRoot, '.evo-lite', 'generated', 'spec-registry.json');
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, JSON.stringify(registry, null, 2), 'utf8');
        } catch (_) {
            // Registry write is best-effort; never throw for normal degradation.
        }
    }

    return registry;
}

// --- adoptSpec: intake gate ---

const RELATION_KINDS = new Set(['independent', 'spawned-from', 'supersedes', 'blocks']);

function usageError(message) {
    const err = new Error(message);
    err.code = 'EUSAGE';
    return err;
}

function kebabCase(str) {
    return String(str || '')
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function deriveKebabFromFilename(filePath) {
    const base = path.basename(filePath).replace(/\.md$/i, '');
    const stripped = base.replace(/^spec[-_ ]*/i, '');
    return kebabCase(stripped) || kebabCase(base);
}

function extractH1Title(body) {
    const m = body.match(/^#\s+(.+)$/m);
    return m ? m[1].trim() : null;
}

function deriveKebabId(body, filePath) {
    const title = extractH1Title(body);
    if (title) {
        const kebab = kebabCase(title);
        if (kebab) return kebab;
    }
    return deriveKebabFromFilename(filePath);
}

// Splits a broken-frontmatter draft into the opening block (from the first
// `---` line to the matching closing `---` line, or the first 30 lines if no
// closing fence is found) and the remaining content after that block.
function splitBrokenFrontmatterBlock(content) {
    const lines = content.split(/\r?\n/);
    let closingIdx = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '---') { closingIdx = i; break; }
    }
    if (closingIdx !== -1) {
        return {
            block: lines.slice(0, closingIdx + 1),
            remainder: lines.slice(closingIdx + 1).join('\n'),
        };
    }
    return {
        block: lines.slice(0, 30),
        remainder: lines.slice(30).join('\n'),
    };
}

function demoteBrokenFrontmatter(content) {
    const { block, remainder } = splitBrokenFrontmatterBlock(content);
    const commentBlock = [
        '<!-- adopted: original broken frontmatter preserved below -->',
        '<!--',
        ...block,
        '-->',
    ].join('\n');
    return `${commentBlock}\n\n${remainder.replace(/^\n+/, '')}`;
}

function serializeFrontmatter(orderedEntries) {
    const lines = ['---'];
    for (const [key, value] of orderedEntries) {
        lines.push(`${key}: ${value}`);
    }
    lines.push('---');
    return lines.join('\n');
}

function todayISODate(now) {
    const d = now instanceof Date ? now : new Date();
    return d.toISOString().slice(0, 10);
}

function validateRelations(relations, knownIds) {
    for (const rel of relations) {
        if (!rel || !RELATION_KINDS.has(rel.kind)) {
            throw usageError(`adoptSpec: invalid relation kind: ${rel && rel.kind} — must be one of ${Array.from(RELATION_KINDS).join(', ')}`);
        }
        if (!rel.target || !knownIds.includes(rel.target)) {
            throw usageError(`adoptSpec: unknown relation target: ${rel && rel.target} — known spec ids: ${knownIds.join(', ') || '(none)'}`);
        }
    }
}

// Source-path containment gate: the FIRST thing adoptSpec does, before any
// read. Resolves filePath to a canonical (symlink-free) real path and
// verifies it is (1) an in-workspace, (2) non-symlink, (3) .md, (4) regular
// file. All failures are EUSAGE. This closes the P0 escape where an
// absolute/relative/symlinked source outside the workspace could be
// read+moved into the repo by adoptSpec's later renameSync.
function resolveContainedSource(projectRoot, filePath) {
    const rootReal = fs.realpathSync(projectRoot);
    const absSrc = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);

    let lst;
    try {
        lst = fs.lstatSync(absSrc);
    } catch (_) {
        throw usageError(`adoptSpec: cannot read draft file: ${filePath}`);
    }
    if (lst.isSymbolicLink()) {
        throw usageError(`adoptSpec: refuses symlink source: ${filePath}`);
    }
    if (!lst.isFile()) {
        throw usageError(`adoptSpec: cannot read draft file: ${filePath}`);
    }

    const srcReal = fs.realpathSync(absSrc);

    const rel = path.relative(rootReal, srcReal);
    const contained = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
    if (!contained) {
        throw usageError(`adoptSpec: draft must live inside the workspace: ${filePath}`);
    }

    if (path.extname(srcReal).toLowerCase() !== '.md') {
        throw usageError(`adoptSpec: draft must be a .md file: ${filePath}`);
    }
    if (!fs.statSync(srcReal).isFile()) {
        throw usageError(`adoptSpec: cannot read draft file: ${filePath}`);
    }

    return srcReal;
}

// adoptSpec: normalizes a loose draft spec into docs/specs/, runs the size
// gate (WARN-only, never blocks), and enforces relation declarations when
// other adopted/active specs already exist (EUSAGE, blocks). Never calls
// process.exit — invalid usage throws Error with err.code = 'EUSAGE'.
function adoptSpec(projectRoot, filePath, opts = {}) {
    const absSrc = resolveContainedSource(projectRoot, filePath);
    let rawContent;
    try {
        rawContent = fs.readFileSync(absSrc, 'utf8');
    } catch (_) {
        throw usageError(`adoptSpec: cannot read draft file: ${filePath}`);
    }
    if (!rawContent || !rawContent.trim()) {
        throw usageError(`adoptSpec: empty draft: ${filePath}`);
    }

    let { frontmatter, body } = parseFrontmatter(rawContent);

    if (rawContent.trim().startsWith('---') && Object.keys(frontmatter).length === 0) {
        body = demoteBrokenFrontmatter(rawContent);
        frontmatter = {};
    }

    let kebab;
    if (frontmatter.id) {
        if (!frontmatter.id.startsWith('spec:')) {
            throw usageError(`adoptSpec: existing id must start with "spec:": ${frontmatter.id}`);
        }
        // Same sanitization as the derived-id branch: never trust the author's
        // explicit id suffix verbatim as a filename (path-traversal / spaces).
        kebab = kebabCase(frontmatter.id.slice('spec:'.length));
        if (!kebab) {
            throw usageError(`adoptSpec: unusable spec id: ${frontmatter.id}`);
        }
    } else {
        kebab = deriveKebabId(body, absSrc);
    }
    const id = `spec:${kebab}`;

    let status = frontmatter.status;
    if (!status || status === 'draft') status = 'adopted';

    const created = frontmatter.created || todayISODate(opts.now);

    const targetPath = path.join(projectRoot, 'docs', 'specs', `${kebab}.md`);
    if (fs.existsSync(targetPath) && path.resolve(targetPath) !== path.resolve(absSrc)) {
        throw usageError(`adoptSpec: target exists: ${path.relative(projectRoot, targetPath)}`);
    }

    const reservedKeys = new Set(['id', 'status', 'owner', 'created', 'relations']);
    const orderedEntries = [['id', id], ['status', status]];
    if (frontmatter.owner) orderedEntries.push(['owner', frontmatter.owner]);
    orderedEntries.push(['created', created]);
    for (const key of Object.keys(frontmatter)) {
        if (!reservedKeys.has(key)) orderedEntries.push([key, frontmatter[key]]);
    }

    // --- Relation enforcement (in-memory, BEFORE any fs mutation) ---
    // Registry excludes the spec being adopted: it isn't at the target yet, and
    // even if the source lives under docs/specs it must not count as in-flight.
    const preRegistry = buildSpecRegistry(projectRoot, { write: false });
    const others = preRegistry.specs.filter(s => s.id !== id
        && path.resolve(projectRoot, s.file) !== path.resolve(absSrc));
    const inFlight = others.filter(s => s.state === 'adopted' || s.state === 'active');
    const knownIds = others.map(s => s.id);

    let relations = [];
    let writeRelationsLine = false;
    let writeRelationMode = false;

    if (opts.independent === true) {
        relations = [];
        writeRelationMode = true;
    } else if (Array.isArray(opts.relations) && opts.relations.length > 0) {
        validateRelations(opts.relations, knownIds);
        relations = opts.relations.map(r => ({ kind: r.kind, target: r.target }));
        writeRelationsLine = true;
    } else if (inFlight.length > 0) {
        throw usageError(`adoptSpec: relation declaration required (opts.relations or opts.independent); in-flight specs: ${inFlight.map(s => s.id).join(', ')}`);
    }

    // --- All blocking gates passed; build final content and size metrics ---
    const finalOrderedEntries = orderedEntries.slice();
    if (writeRelationsLine) {
        finalOrderedEntries.push(['relations', JSON.stringify(relations)]);
    } else if (writeRelationMode) {
        finalOrderedEntries.push(['relationMode', 'independent']);
    }
    const finalContent = `${serializeFrontmatter(finalOrderedEntries)}\n${body}`;

    const size = computeSizeMetrics(finalContent, body);
    const warnings = [];
    if (isSizeExceeded(size)) warnings.push('size-exceeded');

    // --- Filesystem mutation (only reachable once every EUSAGE gate passed) ---
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const isSamePath = path.resolve(absSrc) === path.resolve(targetPath);
    if (!isSamePath) {
        const relSrc = path.relative(projectRoot, absSrc).replace(/\\/g, '/');
        const relDst = path.relative(projectRoot, targetPath).replace(/\\/g, '/');
        let movedViaGit = false;
        try {
            execFileSync('git', ['mv', '--', relSrc, relDst], { cwd: projectRoot, stdio: 'pipe' });
            movedViaGit = true;
        } catch (_) {
            movedViaGit = false;
        }
        if (!movedViaGit) {
            fs.renameSync(absSrc, targetPath);
            try {
                execFileSync('git', ['add', '--', relDst], { cwd: projectRoot, stdio: 'pipe' });
            } catch (_) {
                // best-effort; untracked/no-git is fine here.
            }
        }
    }

    fs.writeFileSync(targetPath, finalContent, 'utf8');

    buildSpecRegistry(projectRoot, { write: true });

    return { id, targetPath, warnings, relations, size };
}

// --- parkSpec / reactivateSpec: status transitions ---

// Reads filePath, parses its frontmatter, and lets mutateFn transform the
// ordered [key, value] entries (original key order preserved; mutateFn may
// add/remove/replace entries), then rewrites the file using the SAME
// serializeFrontmatter helper adoptSpec uses. This is the one shared
// frontmatter serializer/rewriter for the module — never duplicate this
// read-mutate-serialize-write cycle elsewhere.
function rewriteSpecFrontmatter(filePath, mutateFn) {
    const content = fs.readFileSync(filePath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(content);
    const orderedEntries = Object.keys(frontmatter).map(key => [key, frontmatter[key]]);
    const finalEntries = mutateFn(orderedEntries) || orderedEntries;
    const finalContent = `${serializeFrontmatter(finalEntries)}\n${body}`;
    fs.writeFileSync(filePath, finalContent, 'utf8');
}

// Resolves specId -> absolute spec file path via the registry (id->file).
// Unknown id -> EUSAGE listing known spec ids.
function findSpecFileById(projectRoot, specId, callerLabel) {
    const registry = buildSpecRegistry(projectRoot, { write: false });
    const entry = registry.specs.find(s => s.id === specId);
    if (!entry) {
        const known = registry.specs.map(s => s.id);
        throw usageError(`${callerLabel}: unknown spec id: ${specId} — known spec ids: ${known.join(', ') || '(none)'}`);
    }
    return path.resolve(projectRoot, entry.file);
}

// Sets `key` to `value` in place (preserving position) if present, otherwise
// appends it at the end. Returns a new array; does not mutate the input.
function setEntry(entries, key, value) {
    let found = false;
    const out = entries.map(([k, v]) => {
        if (k === key) { found = true; return [k, value]; }
        return [k, v];
    });
    if (!found) out.push([key, value]);
    return out;
}

function removeEntry(entries, key) {
    return entries.filter(([k]) => k !== key);
}

// parkSpec: rewrites frontmatter to status: parked (+ parkedUntil verbatim
// when opts.until is set), rebuilds the registry, and returns the parked
// state. Cascade (zombie-plan warning) is derived by buildSpecRegistry, not
// computed here. Unknown id -> EUSAGE.
function parkSpec(projectRoot, specId, opts = {}) {
    const absPath = findSpecFileById(projectRoot, specId, 'parkSpec');
    const until = opts.until;

    rewriteSpecFrontmatter(absPath, (entries) => {
        let out = setEntry(entries, 'status', 'parked');
        out = removeEntry(out, 'parkedUntil');
        if (until) out = setEntry(out, 'parkedUntil', until);
        return out;
    });

    buildSpecRegistry(projectRoot, { write: true });

    return { id: specId, state: 'parked', parkedUntil: until || null };
}

// reactivateSpec: rewrites frontmatter status back to 'adopted' (the
// derivation layer in buildSpecRegistry re-computes 'active' vs 'adopted'
// from linked-plan presence) and removes parkedUntil, rebuilds the registry,
// and returns the DERIVED state from the fresh registry entry. Unknown id ->
// EUSAGE.
function reactivateSpec(projectRoot, specId) {
    const absPath = findSpecFileById(projectRoot, specId, 'reactivateSpec');

    rewriteSpecFrontmatter(absPath, (entries) => {
        let out = setEntry(entries, 'status', 'adopted');
        out = removeEntry(out, 'parkedUntil');
        return out;
    });

    const registry = buildSpecRegistry(projectRoot, { write: true });
    const entry = registry.specs.find(s => s.id === specId);
    return { id: specId, state: entry ? entry.state : 'adopted' };
}

function formatWarningLine(spec, warning) {
    if (warning === 'aging-no-plan' || warning === 'aging-inactive') {
        return `⚠️ ${spec.id} 已 ${spec.idleDays} 天无活动 (${spec.state}) — 请表态: mem spec park|reactivate`;
    }
    if (warning === 'size-exceeded') {
        return `⚠️ ${spec.id} 体量超标 (AC=${spec.size.acCount}, Phase=${spec.size.phaseCount}) — 建议拆分或在 frontmatter 声明 sizeWaiver`;
    }
    if (warning === 'zombie-plan') {
        // Only the not-done plans are "仍活跃" — a done plan must never be named here.
        const plans = (spec.notDonePlans || spec.linkedPlans || []).join(', ');
        return `⚠️ ${spec.id} 已 parked 但关联 plan 仍活跃 (${plans}) — zombie plan`;
    }
    return `⚠️ ${spec.id} ${warning}`;
}

function formatPortfolioReport(registry) {
    if (!registry) return [];

    const counts = { adopted: 0, active: 0, parked: 0, shipped: 0 };
    const specs = Array.isArray(registry.specs) ? registry.specs : [];
    for (const spec of specs) {
        if (Object.prototype.hasOwnProperty.call(counts, spec.state)) counts[spec.state]++;
    }

    const lines = [
        `📋 [Spec Portfolio]: adopted=${counts.adopted} active=${counts.active} parked=${counts.parked} shipped=${counts.shipped}`,
    ];
    for (const spec of specs) {
        for (const warning of (spec.warnings || [])) {
            lines.push(formatWarningLine(spec, warning));
        }
    }
    return lines;
}

// --- CLI wiring: `mem spec adopt|status|park|reactivate` ---

function collectRelation(val, acc) {
    acc.push(val);
    return acc;
}

// Splits on the FIRST ':' only — spec ids themselves contain colons
// (e.g. `spawned-from:spec:foo` -> kind `spawned-from`, target `spec:foo`).
function parseRelationArg(val) {
    const idx = String(val).indexOf(':');
    const kind = idx === -1 ? String(val) : val.slice(0, idx);
    const target = idx === -1 ? '' : val.slice(idx + 1);
    return { kind, target };
}

function reportCliError(err) {
    console.error('❌ ' + err.message);
    process.exitCode = err.code === 'EUSAGE' ? 2 : 1;
}

function registerSpecPortfolioCommands(program) {
    const projectRoot = getWorkspaceRoot();
    const spec = program.command('spec').description('Spec portfolio governance: adopt, status, park, reactivate.');

    spec.command('adopt <file>')
        .description('Adopt a draft spec into docs/specs/, running the size gate and relation enforcement.')
        .option('--relation <kv>', 'Relation to another spec as kind:specId (repeatable)', collectRelation, [])
        .option('--independent', 'Declare this spec has no relations to existing in-flight specs')
        .option('--json', 'Print JSON output')
        .action((file, options) => {
            try {
                const relations = (options.relation || []).map(parseRelationArg);
                const result = adoptSpec(projectRoot, file, { relations, independent: !!options.independent });
                if (options.json) {
                    console.log(JSON.stringify(result, null, 2));
                } else {
                    const relTarget = path.relative(projectRoot, result.targetPath).replace(/\\/g, '/');
                    console.log(`✅ adopted ${result.id} → ${relTarget}`);
                    if (result.warnings.includes('size-exceeded')) {
                        console.log(`⚠️ 体量超标 (AC=${result.size.acCount}, Phase=${result.size.phaseCount})`);
                    }
                }
            } catch (err) {
                reportCliError(err);
            }
        });

    spec.command('status')
        .description('Show the spec portfolio registry and governance warnings.')
        .option('--json', 'Print JSON output')
        .action((options) => {
            const registry = buildSpecRegistry(projectRoot, { write: true });
            if (options.json) {
                console.log(JSON.stringify(registry, null, 2));
                return;
            }
            for (const line of formatPortfolioReport(registry)) {
                console.log(line);
            }
        });

    spec.command('park <id>')
        .description('Park a spec (optionally recording a free-text until note).')
        .option('--until <text>', 'Free-text note on when/why this spec is parked')
        .option('--json', 'Print JSON output')
        .action((id, options) => {
            try {
                const result = parkSpec(projectRoot, id, { until: options.until });
                if (options.json) {
                    console.log(JSON.stringify(result, null, 2));
                } else {
                    console.log(`⏸️ parked ${result.id}` + (result.parkedUntil ? ` (until: ${result.parkedUntil})` : ''));
                }
            } catch (err) {
                reportCliError(err);
            }
        });

    spec.command('reactivate <id>')
        .description('Reactivate a parked spec back to adopted/active.')
        .option('--json', 'Print JSON output')
        .action((id, options) => {
            try {
                const result = reactivateSpec(projectRoot, id);
                if (options.json) {
                    console.log(JSON.stringify(result, null, 2));
                } else {
                    console.log(`▶️ reactivated ${result.id} → ${result.state}`);
                }
            } catch (err) {
                reportCliError(err);
            }
        });

    return spec;
}

module.exports = {
    SIZE_THRESHOLDS,
    DEFAULT_AGING_DAYS,
    buildSpecRegistry,
    formatPortfolioReport,
    adoptSpec,
    parkSpec,
    reactivateSpec,
    registerSpecPortfolioCommands,
    // Exported for unit testing (timezone-safe epoch compare, not lexicographic).
    resolveLastTouchedAt,
};
