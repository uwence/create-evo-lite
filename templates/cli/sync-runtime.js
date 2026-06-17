'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOCK_REL_PATH = path.join('.evo-lite', 'generated', 'runtime-mirror.lock.json');

function getTemplateCliDir(projectRoot) {
    const override = process.env.EVO_LITE_TEMPLATE_CLI_DIR;
    if (override) return path.resolve(override);
    return path.join(projectRoot, 'templates', 'cli');
}

function getTemplateRootDir(projectRoot) {
    const override = process.env.EVO_LITE_TEMPLATE_ROOT_DIR;
    if (override) return path.resolve(override);
    return path.join(projectRoot, 'templates');
}

function getActiveCliDir(projectRoot) {
    return path.join(projectRoot, '.evo-lite', 'cli');
}

function getLockPath(projectRoot) {
    return path.join(projectRoot, LOCK_REL_PATH);
}

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readEntries(projectRoot) {
    const templateCliPath = getTemplateCliDir(projectRoot);
    const templateRootPath = getTemplateRootDir(projectRoot);
    if (!fs.existsSync(templateCliPath) || !fs.existsSync(templateRootPath)) {
        return null;
    }
    const manifest = require('./template-manifest');
    return manifest.buildManagedTemplateEntries({
        workspaceRoot: projectRoot,
        activeCliDir: getActiveCliDir(projectRoot),
        templateRootPath,
        templateCliPath,
        scopes: ['sync-always'],
    });
}

function ensureParent(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function syncRuntime(projectRoot, options = {}) {
    const entries = readEntries(projectRoot);
    if (!entries) {
        return { copied: [], skipped: [], missingTemplates: [], lockPath: null, status: 'no-templates' };
    }
    const dryRun = !!options.dryRun;
    const copied = [];
    const skipped = [];
    const missingTemplates = [];
    const checksums = {};

    for (const entry of entries) {
        if (!fs.existsSync(entry.templateFile)) {
            missingTemplates.push(entry.label);
            continue;
        }
        const templateBytes = fs.readFileSync(entry.templateFile);
        const templateHash = sha256(templateBytes);
        const relActive = path.relative(projectRoot, entry.activeFile).replace(/\\/g, '/');
        checksums[relActive] = templateHash;

        const activeExists = fs.existsSync(entry.activeFile);
        const activeBytes = activeExists ? fs.readFileSync(entry.activeFile) : null;
        const activeHash = activeBytes ? sha256(activeBytes) : null;

        if (activeHash === templateHash) {
            skipped.push(entry.label);
            continue;
        }

        if (!dryRun) {
            ensureParent(entry.activeFile);
            fs.writeFileSync(entry.activeFile, templateBytes);
        }
        copied.push(entry.label);
    }

    const lockPath = getLockPath(projectRoot);
    if (!dryRun) {
        ensureParent(lockPath);
        const lock = {
            version: 'evo-runtime-mirror@1',
            generatedAt: new Date().toISOString(),
            entries: checksums,
        };
        fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
    }

    return {
        copied,
        skipped,
        missingTemplates,
        lockPath: path.relative(projectRoot, lockPath).replace(/\\/g, '/'),
        status: 'ok',
    };
}

function verifyRuntimeLock(projectRoot) {
    const lockPath = getLockPath(projectRoot);
    if (!fs.existsSync(lockPath)) {
        return { status: 'no-lock', mismatches: [], missing: [], lockPath: null };
    }
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const mismatches = [];
    const missing = [];

    for (const [relPath, expectedHash] of Object.entries(lock.entries || {})) {
        const absPath = path.join(projectRoot, relPath);
        if (!fs.existsSync(absPath)) {
            missing.push(relPath);
            continue;
        }
        const actualHash = sha256(fs.readFileSync(absPath));
        if (actualHash !== expectedHash) {
            mismatches.push({ path: relPath, expected: expectedHash, actual: actualHash });
        }
    }

    return {
        status: mismatches.length === 0 && missing.length === 0 ? 'ok' : 'drifted',
        mismatches,
        missing,
        lockPath: path.relative(projectRoot, lockPath).replace(/\\/g, '/'),
        generatedAt: lock.generatedAt || null,
    };
}

function registerSyncRuntimeCommands(program) {
    const { getWorkspaceRoot } = require('./runtime');

    program.command('sync-runtime')
        .description('Copy templates/cli/** to .evo-lite/cli/** and refresh the runtime-mirror lock. Use this when you edit templates/cli/* — never edit .evo-lite/cli/ directly.')
        .option('--check', 'Exit non-zero if mirror drifts from templates (no writes).')
        .option('--json', 'Emit JSON.')
        .action(options => {
            const projectRoot = getWorkspaceRoot();
            if (options.check) {
                const result = verifyRuntimeLock(projectRoot);
                if (options.json) {
                    console.log(JSON.stringify(result, null, 2));
                } else if (result.status === 'no-lock') {
                    console.log('runtime-mirror lock missing. Run `mem sync-runtime` to generate it.');
                } else if (result.status === 'ok') {
                    console.log(`✅ runtime mirror in-sync (${result.lockPath}, ${result.generatedAt}).`);
                } else {
                    console.log(`❌ runtime mirror drifted from templates/cli/.`);
                    for (const m of result.mismatches) console.log(`  drift: ${m.path}`);
                    for (const m of result.missing) console.log(`  missing: ${m}`);
                    console.log('Fix: run `mem sync-runtime` (do not edit .evo-lite/cli/ directly).');
                }
                if (result.status !== 'ok') {
                    process.exitCode = 1;
                }
                return;
            }

            const result = syncRuntime(projectRoot);
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
                return;
            }
            if (result.status === 'no-templates') {
                console.log('templates/cli/ not found. Nothing to sync.');
                return;
            }
            console.log(`Runtime mirror synced from templates/cli/.`);
            console.log(`  copied: ${result.copied.length}`);
            console.log(`  unchanged: ${result.skipped.length}`);
            if (result.missingTemplates.length > 0) {
                console.log(`  missing in templates: ${result.missingTemplates.join(', ')}`);
            }
            console.log(`  lock: ${result.lockPath}`);
        });
}

module.exports = {
    LOCK_REL_PATH,
    syncRuntime,
    verifyRuntimeLock,
    registerSyncRuntimeCommands,
};
