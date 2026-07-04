'use strict';

const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot } = require('../runtime');
const registry = require('./registry');

function isMotherRoot(root) {
    return fs.existsSync(path.join(root, 'templates', 'cli'));
}

function requireMother(root) {
    if (!isMotherRoot(root)) {
        console.error('this is a child hive — run hive commands from the mother');
        process.exitCode = 1;
        return false;
    }
    return true;
}

function registerHiveCommands(program) {
    const hive = program.command('hive').description('Mother-child hive: registry, status, and gene nurture.');

    hive.command('register <childPath>')
        .description('Register an evo-lite child project into the mother registry.')
        .option('--id <id>', 'Child id (defaults to directory basename)')
        .option('--json', 'Print JSON output')
        .action((childPath, options) => {
            const root = getWorkspaceRoot();
            if (!requireMother(root)) return;
            try {
                const entry = registry.registerChild(root, childPath, { id: options.id });
                if (options.json) console.log(JSON.stringify(entry, null, 2));
                else console.log(`✅ registered child: ${entry.id} → ${entry.path}`);
            } catch (error) {
                console.error(`❌ ${error.message}`);
                process.exitCode = 1;
            }
        });

    hive.command('list')
        .description('List registered children with version and last-nurture info.')
        .option('--json', 'Print JSON output')
        .action(options => {
            const root = getWorkspaceRoot();
            if (!requireMother(root)) return;
            const reg = registry.readRegistry(root);
            if (options.json) { console.log(JSON.stringify(reg, null, 2)); return; }
            if (reg.children.length === 0) { console.log('no children registered'); return; }
            for (const c of reg.children) {
                console.log(`${c.id}  ${c.path}  nurtured=${c.lastNurturedVersion || 'never'} (${c.lastNurturedAt || '-'})`);
            }
        });

    hive.command('status [id]')
        .description('Compare each registered child against the mother genes and version.')
        .option('--json', 'Print JSON output')
        .action((id, options) => {
            const root = getWorkspaceRoot();
            if (!requireMother(root)) return;
            const results = require('./status').hiveStatus(root, { id });
            if (options.json) { console.log(JSON.stringify(results, null, 2)); return; }
            if (results.length === 0) { console.log(id ? `unknown child: ${id}` : 'no children registered'); process.exitCode = id ? 1 : 0; return; }
            for (const r of results) {
                const detail = r.status === 'behind' ? ` (${r.childVersion} → ${r.motherVersion})`
                    : r.status === 'drifted' ? ` (${r.driftedFiles.join(', ')})` : '';
                console.log(`${r.id}: ${r.status}${detail}`);
            }
        });

    hive.command('nurture <id>')
        .description('Push managed gene families from this mother into a registered child.')
        .option('--family <key>', 'Push only one managed family (core-cli | agents-workflows | hook-scaffold)')
        .option('--check', 'Report only; exit non-zero when the child is not up-to-date')
        .option('--dry-run', 'Report the copy/skip/missing sets without writing')
        .option('--force', 'Proceed past a dirty child working tree / missing git')
        .option('--json', 'Print JSON output')
        .action((id, options) => {
            const root = getWorkspaceRoot();
            if (!requireMother(root)) return;
            const child = registry.findChild(root, id);
            if (!child) { console.error(`❌ unknown child: ${id} (run: mem hive register <path>)`); process.exitCode = 1; return; }
            let report;
            try {
                report = require('./nurture').nurtureChild(root, child, {
                    family: options.family, dryRun: options.dryRun, check: options.check, force: options.force,
                });
            } catch (error) {
                console.error(`❌ ${error.message}`);
                process.exitCode = 1;
                return;
            }
            if (options.json) console.log(JSON.stringify(report, null, 2));
            else {
                console.log(`status: ${report.status}  copied=${report.copied.length} skipped=${report.skipped.length}`);
                if (report.tag) console.log(`rollback tag: ${report.tag}`);
                if (report.missingSources.length) console.log(`❌ missing mother sources: ${report.missingSources.join(', ')}`);
                if (report.dirtyFiles.length) console.log(`⚠️ dirty in child: ${report.dirtyFiles.join(', ')} (use --force to override)`);
                if (report.depGap.missing.length) console.log(`⚠️ child missing deps: ${report.depGap.missing.join(', ')} — run npm install in <child>/.evo-lite`);
                if (report.depGap.versionDiffs.length) console.log(`ℹ️ version ranges differ: ${report.depGap.versionDiffs.map(d => d.name).join(', ')}`);
            }
            if (report.status === 'refused' || report.status === 'aborted' || report.status === 'unreachable') process.exitCode = 1;
            if (options.check && !report.upToDate) process.exitCode = 1;
        });

    return hive;
}

module.exports = { isMotherRoot, requireMother, registerHiveCommands };
