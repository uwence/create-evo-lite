'use strict';

const fs = require('fs');
const path = require('path');
const { MODULE_RULES, inferModule } = require('./infer-modules');

// Directories to walk (relative to project root).
// Each entry: { dir, recursive }
const WALK_TARGETS = [
    { dir: 'templates/cli', recursive: true },
    { dir: '.agents/rules', recursive: false },
    { dir: '.agents/workflows', recursive: false },
    { dir: 'docs/specs', recursive: false },
    { dir: 'docs/plans', recursive: false },
    { dir: 'docs/contracts', recursive: false },
    { dir: 'docs', recursive: false },
];

// Extensions to include
const INCLUDE_EXT = new Set(['.js', '.md', '.json', '.yaml', '.yml']);

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

    return {
        version: 'evo-arch-ir@1',
        generatedAt: new Date().toISOString(),
        project: { name: path.basename(projectRoot), root: '.' },
        provider: 'native',
        modules,
        files: fileObjects,
        warnings,
    };
}

function writeArchitectureIR(ir, projectRoot) {
    const outDir = path.join(projectRoot, '.evo-lite', 'generated', 'architecture');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'architecture-ir.json');
    fs.writeFileSync(outPath, JSON.stringify(ir, null, 2), 'utf8');
    return outPath;
}

module.exports = { scanArchitecture, writeArchitectureIR };
