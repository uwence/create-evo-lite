const TAKEOVER_FOCUS_QUERY_ALIASES = Object.freeze([
    {
        source: 'focus-keyword',
        match: /runtime hook/i,
        queries: ['runtime hook', 'hook dogfood'],
    },
    {
        source: 'focus-keyword',
        match: /template sync|workflow drift|managed workflow/i,
        queries: ['template sync', 'workflow drift'],
    },
    {
        source: 'focus-keyword',
        match: /baseline commit|fresh repo|fresh-repo|first commit/i,
        queries: ['baseline init commit', 'bootstrap gap'],
    },
    {
        source: 'focus-keyword',
        match: /context track|meta-commit|runtime state/i,
        queries: ['context track', 'runtime state meta commit'],
    },
]);

const TAKEOVER_VERIFY_QUERY_ALIASES = Object.freeze([
    {
        source: 'verify-keyword',
        match: /context track/i,
        queries: ['context track', 'runtime state meta commit'],
    },
]);

const TAKEOVER_HIT_RULES = Object.freeze([
    {
        label: 'HookRuntimeDogfood',
        pattern: /template-only edits do not count as live runtime dogfood/i,
        effect: 'inspect live .evo-lite hook path before syncing templates',
    },
    {
        label: 'WorkflowTemplateSync',
        pattern: /(managed workflow drift|workflow template sync|template sync drift|\.agents\/workflows\/evo\.md is out of sync)/i,
        effect: 'diff managed workflow files before mirroring live and template changes',
    },
    {
        label: 'ContextTrackClosure',
        pattern: /(context track|runtime state meta-commit|snapshot evo-lite runtime state|chore\(meta\): snapshot evo-lite runtime state)/i,
        effect: 'pair context track with a dedicated runtime state snapshot commit',
    },
    {
        label: 'BaselineInitCommit',
        pattern: /(baseline init commit|fresh-repo bootstrap|bootstrap complete path|scaffold does not create a clean baseline init commit)/i,
        effect: 'separate scaffold baseline from the first business commit',
    },
]);

module.exports = {
    TAKEOVER_FOCUS_QUERY_ALIASES,
    TAKEOVER_VERIFY_QUERY_ALIASES,
    TAKEOVER_HIT_RULES,
};