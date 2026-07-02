'use strict';
const { TEST_SCOPE, shouldRun } = require('./test/harness');
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
        await runGovernanceTests();
        if (TEST_SCOPE === 'governance') return;
    }

    await runIntegrationTests();
}

runTests().catch(err => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
});
