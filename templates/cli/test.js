'use strict';
const { TEST_SCOPE, shouldRun, IS_CHILD_RUNTIME } = require('./test/harness');
const { runGovernanceTests } = require('./test/governance');
const { runIntegrationTests } = require('./test/integration');

async function runTests() {
    if (!shouldRun('governance')) {
        console.error(`Unknown test scope: ${TEST_SCOPE}`);
        process.exit(1);
    }

    // 'all' MUST run both suites so `npm test` / CI exercise the governance guards too;
    // 'governance' runs only the governance suite.
    if (TEST_SCOPE === 'governance' || TEST_SCOPE === 'all') {
        // The dogfood strict-gate's own subtest spawns this command to check the gate's exit
        // behavior. In that nested run (EVO_LITE_DOGFOOD_SPAWN_TEST=1) skip the heavy governance
        // suite and run ONLY the gate below — otherwise the suite would re-run itself recursively.
        const gateOnly = process.env.EVO_LITE_DOGFOOD_SPAWN_TEST === '1';
        if (!gateOnly) {
            await runGovernanceTests();
        }

        if (process.argv.includes('--require-live-codegraph')) {
            const fs = require('fs'); const path = require('path');
            const root = process.env.EVO_LITE_WORKSPACE_ROOT || require('./runtime').getWorkspaceRoot();
            const artifactPath = path.join(root, 'docs', 'code-perception-codegraph-dogfood.md');
            if (!fs.existsSync(artifactPath)) {
                console.error('live-codegraph-artifact-missing: ' + artifactPath);
                process.exit(1);
            }
            let text = ''; try { text = fs.readFileSync(artifactPath, 'utf8'); } catch (e) { console.error('live-codegraph-artifact-missing: ' + e.message); process.exit(1); }
            const { validateDogfoodArtifact } = require('./code-perception/dogfood-validate');
            const result = validateDogfoodArtifact(text, { requireClosureEvidence: true });
            if (!result.valid) {
                console.error('live-codegraph-artifact-invalid: ' + result.findings.map(f => f.code + ':' + f.message).join('; '));
                process.exit(1);
            }
            console.log('live-codegraph dogfood artifact valid (' + artifactPath + ')');
        }

        if (TEST_SCOPE === 'governance') return;
    }

    // Integration suite loads mother-only modules (e.g. templates/cli/planning/progress.js)
    // that don't exist in a child hive checkout. A child running the default/'all' scope
    // must stop after governance rather than crash trying to load them.
    if (IS_CHILD_RUNTIME) {
        console.log('⏭️ skipped (child runtime): CLI integration tests (need templates/ tree)');
        return;
    }

    await runIntegrationTests();
}

runTests().catch(err => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
});
