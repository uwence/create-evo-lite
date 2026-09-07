'use strict';

const fs = require('fs');
const path = require('path');
const { MODULE_RULES, inferModule } = require('./infer-modules');
const { getEvoConfig } = require('../runtime');
const { validateProvider } = require('./provider-contract');

// Directories to walk (relative to project root).
// Each entry: { dir, recursive }
const WALK_TARGETS = [
    { dir: 'templates/cli', recursive: true },
    { dir: 'templates/.github', recursive: true },
    { dir: 'templates/.codex', recursive: true },
    { dir: '.agents/rules', recursive: true },
    { dir: '.agents/workflows', recursive: true },
    { dir: 'docs/specs', recursive: false },
    { dir: 'docs/plans', recursive: false },
    { dir: 'docs/contracts', recursive: true },
    { dir: 'docs/architecture', recursive: true },
    { dir: 'docs', recursive: false },
];

// Single-file targets (relative to project root). Kept separate so the dir
// walker stays simple. Covered by ARCH_SOURCE_PATHS so R009 stays consistent.
const WALK_FILES = [
    'index.js',
    'bin/cli.js',
    'package.json',
];

// Extensions to include
const INCLUDE_EXT = new Set(['.js', '.md', '.json', '.yaml', '.yml']);

// WALK_TARGETS, WALK_FILES, INCLUDE_EXT and MODULE_RULES together describe
// create-evo-lite's own layout. In any other project the real source tree is
// never walked, so it produces no "unclassified" entry either: the scan returns
// a clean IR having seen none of the code. Measured on the real children —
// CodePLC 178 code files -> 0 in the IR -> 0 warnings.
//
// Until the module map itself becomes project-owned, the scan must at least
// state what it did NOT cover. Authority for "what belongs to this project" is
// git, deliberately not another hardcoded directory list: repeating that
// mistake here is what produced the silence in the first place.
const SOURCE_EXT = new Set([
    '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.vue', '.svelte',
    '.py', '.go', '.rs', '.rb', '.php', '.java', '.kt', '.scala', '.cs', '.swift',
    '.c', '.h', '.cc', '.cpp', '.hpp',
]);

// The governance runtime lives under .evo-lite/ and children track it. It is
// this tool's own code, not the project's source, so it is never "uncovered".
const COVERAGE_EXCLUDE_PREFIX = '.evo-lite/';

function listTrackedFiles(projectRoot) {
    try {
        const out = require('child_process').execFileSync('git', ['ls-files', '-z'], {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            maxBuffer: 32 * 1024 * 1024,
        });
        return out.split('\0').filter(Boolean);
    } catch (_) {
        return null;
    }
}

// Reporting heuristic, not a definition of the project: SOURCE_EXT being wrong
// produces a warning about the wrong file, never silence about a real one.
function measureCoverage(projectRoot, coveredPaths) {
    const tracked = listTrackedFiles(projectRoot);
    if (!tracked) {
        return {
            state: 'unknown',
            reason: 'not a git repository, or git unavailable — no authority for what belongs to this project',
            trackedSourceTotal: 0,
            covered: 0,
            uncovered: 0,
            samples: [],
        };
    }
    const covered = new Set(coveredPaths);
    const source = tracked.filter(f => SOURCE_EXT.has(path.extname(f).toLowerCase())
        && !f.startsWith(COVERAGE_EXCLUDE_PREFIX));
    const missing = source.filter(f => !covered.has(f));
    return {
        state: 'measured',
        trackedSourceTotal: source.length,
        covered: source.length - missing.length,
        uncovered: missing.length,
        samples: missing.slice(0, 10),
    };
}

function walkDir(absDir, recursive, projectRoot) {
    const results = [];
    if (!fs.existsSync(absDir)) return results;

    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
        const absPath = path.join(absDir, entry.name);
        if (entry.isDirectory()) {
            if (recursive) results.push(...walkDir(absPath, recursive, projectRoot));
        } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (INCLUDE_EXT.has(ext)) {
                results.push(path.relative(projectRoot, absPath).replace(/\\/g, '/'));
            }
        }
    }
    return results;
}

function loadProviders(projectRoot, warnings) {
    const config = getEvoConfig();
    const providerPaths = Array.isArray(config.providers) ? config.providers : [];
    const loaded = [];

    for (const relPath of providerPaths) {
        let provider;
        try {
            const absPath = path.resolve(projectRoot, relPath);
            provider = require(absPath);
        } catch (e) {
            warnings.push({ level: 'warning', rule: 'P001', message: `Provider load failed (${relPath}): ${e.message}` });
            continue;
        }

        const validation = validateProvider(provider);
        if (!validation.valid) {
            warnings.push({ level: 'warning', rule: 'P001', message: `Provider at ${relPath} invalid contract: ${validation.error}` });
            continue;
        }

        let available = false;
        try { available = provider.check(); } catch (_) {}
        if (!available) {
            warnings.push({ level: 'info', rule: 'P002', message: `Provider ${provider.id} not available (check() false)` });
            continue;
        }

        loaded.push(provider);
    }

    return loaded;
}

function mergeProviderIR(ir, providerResult) {
    if (!providerResult || typeof providerResult !== 'object') return;

    // Files: provider wins if confidence > native
    if (Array.isArray(providerResult.files)) {
        const fileMap = new Map(ir.files.map(f => [f.path, f]));
        for (const pf of providerResult.files) {
            const existing = fileMap.get(pf.path);
            if (!existing || (pf.confidence || 0) > (existing.confidence || 0)) {
                fileMap.set(pf.path, Object.assign({}, existing, pf));
            }
        }
        ir.files = Array.from(fileMap.values());
    }

    // Modules: provider wins if confidence > native
    if (Array.isArray(providerResult.modules)) {
        const modMap = new Map(ir.modules.map(m => [m.id, m]));
        for (const pm of providerResult.modules) {
            const existing = modMap.get(pm.id);
            if (!existing || (pm.confidence || 0) > (existing.confidence || 0)) {
                modMap.set(pm.id, Object.assign({}, existing, pm));
            }
        }
        ir.modules = Array.from(modMap.values());
    }

    // Edges and flows are purely additive
    if (Array.isArray(providerResult.edges)) ir.edges = [...(ir.edges || []), ...providerResult.edges];
    if (Array.isArray(providerResult.flows)) ir.flows = [...(ir.flows || []), ...providerResult.flows];
}

function scanArchitecture(projectRoot) {
    const warnings = [];
    const allFiles = [];

    // Walk all targets
    for (const target of WALK_TARGETS) {
        const absDir = path.join(projectRoot, target.dir);
        try {
            const found = walkDir(absDir, target.recursive, projectRoot);
            allFiles.push(...found);
        } catch (e) {
            warnings.push({ level: 'error', message: `Walk failed for ${target.dir}: ${e.message}` });
        }
    }

    // Include single-file targets (root entries, package.json, etc.)
    for (const relFile of WALK_FILES) {
        const absFile = path.join(projectRoot, relFile);
        if (!fs.existsSync(absFile)) continue;
        const ext = path.extname(relFile).toLowerCase();
        if (!INCLUDE_EXT.has(ext)) continue;
        allFiles.push(relFile.replace(/\\/g, '/'));
    }

    // Deduplicate (docs root walk may overlap with docs/specs etc.)
    const seen = new Set();
    const uniqueFiles = allFiles.filter(f => { if (seen.has(f)) return false; seen.add(f); return true; });

    // Classify files into modules
    const moduleMap = new Map(); // moduleId → { rule, files[] }
    const fileObjects = [];

    for (const relPath of uniqueFiles) {
        const rule = inferModule(relPath);
        if (rule) {
            if (!moduleMap.has(rule.id)) {
                moduleMap.set(rule.id, { rule, files: [] });
            }
            moduleMap.get(rule.id).files.push(relPath);
            fileObjects.push({ path: relPath, module: rule.id, role: rule.role, confidence: rule.confidence });
        } else {
            fileObjects.push({ path: relPath, module: null, role: 'unknown', confidence: 0 });
            warnings.push({ level: 'info', rule: 'R007', message: `Unclassified file: ${relPath}` });
        }
    }

    // Build module list (only modules that have files, in rule order)
    const modules = [];
    for (const rule of MODULE_RULES) {
        const entry = moduleMap.get(rule.id);
        if (entry) {
            modules.push({
                id: rule.id,
                name: rule.name,
                description: rule.description,
                paths: rule.paths,
                fileCount: entry.files.length,
                role: rule.role,
                confidence: rule.confidence,
            });
        }
    }

    const ir = {
        version: 'evo-arch-ir@1',
        generatedAt: new Date().toISOString(),
        project: { name: path.basename(projectRoot), root: '.' },
        provider: 'native',
        modules,
        files: fileObjects,
        coverage: measureCoverage(projectRoot, uniqueFiles),
        warnings,
    };

    // Apply optional providers declared in .evo-lite/config.json
    const providers = loadProviders(projectRoot, ir.warnings);
    for (const provider of providers) {
        try {
            const providerResult = provider.scan(projectRoot, ir);
            mergeProviderIR(ir, providerResult);
            ir.provider = provider.id;
        } catch (e) {
            ir.warnings.push({ level: 'warning', rule: 'P003', message: `Provider ${provider.id} scan() threw: ${e.message}` });
        }
    }

    return ir;
}

function writeArchitectureIR(ir, projectRoot) {
    const outDir = path.join(projectRoot, '.evo-lite', 'generated', 'architecture');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'architecture-ir.json');
    fs.writeFileSync(outPath, JSON.stringify(ir, null, 2), 'utf8');
    return outPath;
}

module.exports = { scanArchitecture, writeArchitectureIR };
