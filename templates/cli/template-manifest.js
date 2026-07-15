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
            'memory-index-util.js',
            'memory-index.js',
            'memory-index-zvec.js',
            'memory-ab.js',
            'memory.service.js',
            'runtime.js',
            'safety.js',
            'inspector.js',
            'recall-rules.js',
            'spec-portfolio.js',
            'template-manifest.js',
            'test.js',
            'test/harness.js',
            'test/governance.js',
            'test/integration.js',
            'planning.js',
            'hooks.js',
            'planning/gaps.js',
            'planning/parse-markdown.js',
            'planning/progress.js',
            'planning/scan.js',
            'planning/traceability.js',
            'planning/lint.js',
            'planning/backfill-evidence.js',
            'transaction.js',
            'verification/contract-schema.json',
            'verification/validate-contract.js',
            'verification/commands.js',
            'verification/derive-verdicts.js',
            'verification/run-verifiers.js',
            'verification/command-policy.js',
            'verification/evidence-store.js',
            'verification/compute-status.js',
            'verification/engine.js',
            'verification/close-preview.js',
            'verification/close-commands.js',
            'verification/close-apply.js',
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
            'sync-runtime-entry.js',
            'hive/registry.js',
            'hive/status.js',
            'hive/nurture.js',
            'hive/commands.js',
            'hive/feedback.js',
            'code-perception/provider-contract.js',
            'code-perception/normalize.js',
            'code-perception/native-lite.js',
            'code-perception/provider-loader.js',
            'code-perception/provider-router.js',
            'test/fixtures/code-perception/fixture-provider.js',
            'test/fixtures/code-perception/fixture-status.json',
            'test/fixtures/code-perception/fixture-query.json',
            'test/fixtures/code-perception/fixture-callers.json',
            'test/fixtures/code-perception/fixture-impact.json',
            'code-perception/cache.js',
            'code-perception/status.js',
            'code-perception/governance-linker.js',
            'code-perception/post-commit-code-perception.js',
            'code-perception/dogfood-validate.js',
            'code-perception/providers/codegraph-exec.js',
            'code-perception/providers/codegraph.js',
            'test/fixtures/code-perception/codegraph-fixture-manifest.json',
            'test/fixtures/code-perception/codegraph-version.txt',
            'test/fixtures/code-perception/codegraph-help.txt',
            'test/fixtures/code-perception/codegraph-status.json',
            'test/fixtures/code-perception/codegraph-files.json',
            'test/fixtures/code-perception/codegraph-query.json',
            'test/fixtures/code-perception/codegraph-callers.json',
            'test/fixtures/code-perception/codegraph-callees.json',
            'test/fixtures/code-perception/codegraph-impact.json',
            'test/fixtures/code-perception/codegraph-affected.json',
            'test/fixtures/code-perception/codegraph-malformed.json',
            'test/fixtures/code-perception/codegraph-node.txt',
            'test/fixtures/code-perception/codegraph-explore.txt',
            'test/fixtures/code-perception/fake-codegraph.js',
            'test/fixtures/code-perception/dogfood-sample.md',
            'test/fixtures/code-perception/dogfood-bad.md',
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
        // sync-always rule genes: nurture-managed, byte-identical across the hive.
        key: 'agents-rules',
        scope: 'sync-always',
        activeRoot: 'workspace',
        templateRoot: 'root',
        relativeDir: ['.agents', 'rules'],
        files: ['hive-feedback.md', 'spec-intake.md', 'zvec-optin.md'],
    },
    {
        // copy-on-init rules: seeded once at scaffold, then owned by the project
        // (child-customizable; never nurtured, never .bak-churned on re-init).
        key: 'agents-rules-init',
        scope: 'copy-on-init',
        activeRoot: 'workspace',
        templateRoot: 'root',
        relativeDir: ['.agents', 'rules'],
        files: [
            'architecture.md',
            'evo-lite.md',
            'execution-model.md',
            'memory-distillation.md',
            'project-archive.md',
            'subagent-checkpoint.md',
        ],
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
    const spec = typeof file === 'string' ? { path: file } : file;
    const relativeParts = [...family.relativeDir, ...spec.path.split('/')];
    const label = path.posix.join(...relativeParts);
    const activeBase = family.activeRoot === 'cli' ? paths.activeCliDir : paths.workspaceRoot;
    const templateBase = family.templateRoot === 'cli' ? paths.templateCliPath : paths.templateRootPath;

    return {
        family: family.key,
        scope: family.scope,
        label,
        mergeAnchors: Array.isArray(spec.mergeAnchors) ? spec.mergeAnchors : [],
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
    buildEntry,
    buildManagedTemplateEntries,
};
