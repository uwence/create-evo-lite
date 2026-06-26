const path = require('path');

const MANAGED_TEMPLATE_FAMILIES = Object.freeze([
    {
        key: 'core-cli',
        scope: 'sync-always',
        activeRoot: 'cli',
        templateRoot: 'cli',
        relativeDir: [],
        files: [
            'memory.js',
            'db.js',
            'models.js',
            'memory.service.js',
            'runtime.js',
            'safety.js',
            'inspector.js',
            'recall-rules.js',
            'template-manifest.js',
            'test.js',
            'planning.js',
            'hooks.js',
            'planning/gaps.js',
            'planning/parse-markdown.js',
            'planning/progress.js',
            'planning/scan.js',
            'planning/traceability.js',
            'planning/lint.js',
            'planning/backfill-evidence.js',
            'verification/contract-schema.json',
            'verification/validate-contract.js',
            'architecture.js',
            'architecture/diff.js',
            'architecture/infer-modules.js',
            'architecture/provider-contract.js',
            'architecture/scan-native.js',
            'architecture/providers/github-issues.js',
            'architecture/providers/gitnexus.js',
            'dashboard-data.js',
            'mcp-server.js',
            'mcp-validate.js',
            'sync-runtime.js',
        ],
    },
    {
        key: 'agents-workflows',
        scope: 'sync-always',
        activeRoot: 'workspace',
        templateRoot: 'root',
        relativeDir: ['.agents', 'workflows'],
        files: ['evo.md', 'commit.md', 'mem.md', 'walkthrough.md'],
    },
    {
        key: 'hook-scaffold',
        scope: 'sync-always',
        activeRoot: 'workspace',
        templateRoot: 'root',
        relativeDir: [],
        files: [
            '.github/copilot-instructions.md',
            '.github/hooks/evo-lite.json',
            '.github/hooks/evo-lite-hook.js',
            '.github/hooks/evo-lite-codex-stop-hook.js',
            '.github/hooks/dogfood-commit-hook.js',
            '.codex/hooks.json',
        ],
    },
]);

function buildEntry(family, file, paths) {
    const relativeParts = [...family.relativeDir, ...file.split('/')];
    const label = path.posix.join(...relativeParts);
    const activeBase = family.activeRoot === 'cli' ? paths.activeCliDir : paths.workspaceRoot;
    const templateBase = family.templateRoot === 'cli' ? paths.templateCliPath : paths.templateRootPath;

    return {
        family: family.key,
        scope: family.scope,
        label,
        activeFile: path.join(activeBase, ...relativeParts),
        templateFile: path.join(templateBase, ...relativeParts),
    };
}

function buildManagedTemplateEntries(options = {}) {
    const scopes = Array.isArray(options.scopes) && options.scopes.length > 0
        ? new Set(options.scopes)
        : null;

    return MANAGED_TEMPLATE_FAMILIES.flatMap(family => {
        if (scopes && !scopes.has(family.scope)) {
            return [];
        }
        return family.files.map(file => buildEntry(family, file, options));
    });
}

module.exports = {
    MANAGED_TEMPLATE_FAMILIES,
    buildManagedTemplateEntries,
};
