'use strict';

// Module boundary rules for the native scanner.
// Ordered: first match wins. More-specific rules come before broader ones.

const MODULE_RULES = [
    {
        id: 'module:cli-entry',
        name: 'CLI Entry',
        description: 'Main CLI entry point and command router (package entry + bin shim + runtime memory.js)',
        paths: ['templates/cli/memory.js', 'index.js', 'bin/cli.js', 'package.json'],
        role: 'entry',
        confidence: 1.0,
    },
    {
        id: 'module:hook-scaffold',
        name: 'Hook Scaffold',
        description: 'Templated host-side hook integrations (git post-commit, Claude/Codex/Copilot wrappers)',
        paths: [
            'templates/.github/',
            'templates/.codex/',
        ],
        role: 'governance',
        confidence: 1.0,
    },
    {
        id: 'module:memory-service',
        name: 'Memory Service',
        description: 'Core memory operations: memorize, recall, commit, verify, archive',
        paths: ['templates/cli/memory.service.js'],
        role: 'service',
        confidence: 1.0,
    },
    {
        id: 'module:inspector',
        name: 'Inspector',
        description: 'Local HTTP inspector with read-only dashboard',
        paths: ['templates/cli/inspector.js'],
        role: 'ui',
        confidence: 1.0,
    },
    {
        id: 'module:test',
        name: 'Test',
        description: 'Test harness and integration fixtures',
        paths: ['templates/cli/test.js'],
        role: 'test',
        confidence: 1.0,
    },
    {
        id: 'module:planning',
        name: 'Planning',
        description: 'Planning IR scanner: spec/plan markdown parsing',
        paths: ['templates/cli/planning.js', 'templates/cli/planning/'],
        role: 'scanner',
        confidence: 1.0,
    },
    {
        id: 'module:architecture',
        name: 'Architecture',
        description: 'Architecture IR scanner: native file-system module inference',
        paths: ['templates/cli/architecture.js', 'templates/cli/architecture/'],
        role: 'scanner',
        confidence: 1.0,
    },
    {
        id: 'module:dashboard',
        name: 'Dashboard',
        description: 'Dashboard data aggregator: merges plan-ir, architecture-ir, drift-report into dashboard-data.json',
        paths: ['templates/cli/dashboard-data.js'],
        role: 'feature',
        confidence: 1.0,
    },
    {
        id: 'module:architecture-wiki',
        name: 'Architecture Governance Wiki',
        description: 'Static architecture and governance wiki: projection, rendering, source pages, and CLI build orchestration',
        paths: ['templates/cli/wiki/'],
        role: 'feature',
        confidence: 1.0,
    },
    {
        id: 'module:runtime',
        name: 'Runtime',
        description: 'Infrastructure: path resolution, DB, models, safety, recall-rules, template-manifest',
        paths: [
            'templates/cli/runtime.js',
            'templates/cli/db.js',
            'templates/cli/models.js',
            'templates/cli/safety.js',
            'templates/cli/recall-rules.js',
            'templates/cli/template-manifest.js',
        ],
        role: 'runtime',
        confidence: 1.0,
    },
    {
        id: 'module:agents-workflow',
        name: 'Agents & Workflow',
        description: 'Evo-Lite governance rules and workflow definitions',
        paths: ['.agents/rules/', '.agents/workflows/'],
        role: 'governance',
        confidence: 1.0,
    },
    {
        id: 'module:docs-planning',
        name: 'Docs & Planning',
        description: 'Project specs, plans, contracts, and research documents',
        paths: ['docs/specs/', 'docs/plans/', 'docs/contracts/', 'docs/architecture/', 'docs/'],
        role: 'docs',
        confidence: 0.8,
    },
];

/**
 * Given a relative file path (forward slashes), return the matching module rule or null.
 * First match wins.
 */
function inferModule(relPath) {
    for (const rule of MODULE_RULES) {
        for (const pat of rule.paths) {
            if (pat.endsWith('/')) {
                if (relPath.startsWith(pat)) return rule;
            } else {
                if (relPath === pat) return rule;
            }
        }
    }
    return null;
}

module.exports = { MODULE_RULES, inferModule };
