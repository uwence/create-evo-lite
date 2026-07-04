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

    return hive;
}

module.exports = { isMotherRoot, requireMother, registerHiveCommands };
