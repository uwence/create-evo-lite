'use strict';

// Bootstrap-safe standalone entrypoint for the runtime-mirror sync.
//
// CANONICAL RECOVERY PATH for a hard brick: when memory.js cannot load at all
// (e.g. a top-level require chain memory.service → memory-index → memory-index-util
// hits a not-yet-mirrored file), this entry still runs because it requires ONLY
// ./sync-runtime and ./runtime — both depend on nothing beyond Node builtins +
// ./template-manifest. NEVER add a require here (or in that closure) for
// memory.service, db, commander, or any feature/gene module. A closure whitelist
// test (T-sr-entry) enforces this.

const { syncRuntime, verifyRuntimeLock } = require('./sync-runtime');
const { getWorkspaceRoot } = require('./runtime');

function main(argv) {
    const args = argv.slice(2);
    const json = args.includes('--json');
    const check = args.includes('--check');
    const projectRoot = process.env.EVO_LITE_WORKSPACE_ROOT || getWorkspaceRoot();

    if (check) {
        const result = verifyRuntimeLock(projectRoot);
        if (json) {
            process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        } else if (result.status === 'no-lock') {
            console.log('runtime-mirror lock missing. Run sync-runtime-entry to generate it.');
        } else if (result.status === 'ok') {
            console.log(`✅ runtime mirror in-sync (${result.lockPath}, ${result.generatedAt}).`);
        } else {
            console.log('❌ runtime mirror drifted from templates/cli/.');
            for (const m of result.mismatches) console.log(`  drift: ${m.path}`);
            for (const m of result.missing) console.log(`  missing: ${m}`);
        }
        // Match the existing `mem sync-runtime --check`: ONLY status 'ok' exits 0.
        // 'no-lock' still prints its remedy but exits 1 (drift/missing likewise).
        return result.status === 'ok' ? 0 : 1;
    }

    const result = syncRuntime(projectRoot);
    if (json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        return 0;
    }
    if (result.status === 'no-templates') {
        console.log('templates/cli/ not found. Nothing to sync.');
        return 0;
    }
    console.log('Runtime mirror synced from templates/cli/ (standalone entry).');
    console.log(`  copied: ${result.copied.length}`);
    console.log(`  unchanged: ${result.skipped.length}`);
    if (result.missingTemplates.length > 0) {
        console.log(`  missing in templates: ${result.missingTemplates.join(', ')}`);
    }
    console.log(`  lock: ${result.lockPath}`);
    return 0;
}

process.exitCode = main(process.argv);
