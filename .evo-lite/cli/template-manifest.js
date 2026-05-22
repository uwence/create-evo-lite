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
