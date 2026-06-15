'use strict';

const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot } = require('./runtime');

function formatIRSummary(ir) {
    const lines = [];
    lines.push(`Architecture IR  ${ir.version}  provider: ${ir.provider}  (${ir.modules.length} modules, ${ir.files.length} files)`);
    for (const mod of ir.modules) {
        lines.push(`\n  [${mod.role}]  ${mod.id}  (${mod.fileCount} files)`);
        lines.push(`          ${mod.description}`);
    }
    const unclassified = ir.files.filter(f => !f.module).length;
    if (unclassified > 0) {
        lines.push(`\n  [unknown]  ${unclassified} unclassified files`);
    }
    if (ir.warnings && ir.warnings.length > 0) {
        const nonInfo = ir.warnings.filter(w => w.level !== 'info');
        if (nonInfo.length > 0) {
            lines.push('\nWarnings:');
            for (const w of nonInfo) {
                lines.push(`  [${w.level}] ${w.message}`);
            }
        }
    }
    return lines.join('\n');
}

function registerArchitectureCommands(program) {
    const projectRoot = getWorkspaceRoot();
    const arch = program.command('architecture').alias('arch').description('Architecture IR commands.');

    arch.command('status')
        .description('Show architecture status (cached IR or quick scan).')
        .action(async () => {
            const irPath = path.join(projectRoot, '.evo-lite', 'generated', 'architecture', 'architecture-ir.json');
            if (fs.existsSync(irPath)) {
                const ir = JSON.parse(fs.readFileSync(irPath, 'utf8'));
                console.log(formatIRSummary(ir));
                console.log(`\n  cached: ${irPath}`);
                console.log('  refresh: mem architecture scan');
            } else {
                console.log('No architecture-ir.json found. Running quick scan...\n');
                const { scanArchitecture } = require('./architecture/scan-native');
                const ir = scanArchitecture(projectRoot);
                console.log(formatIRSummary(ir));
                console.log('\n  save results: mem architecture scan');
            }
        });

    arch.command('scan')
        .description('Scan project file system, write architecture-ir.json.')
        .action(async () => {
            const { scanArchitecture, writeArchitectureIR } = require('./architecture/scan-native');
            console.log('Scanning project architecture...\n');
            const ir = scanArchitecture(projectRoot);
            const outPath = writeArchitectureIR(ir, projectRoot);
            console.log(formatIRSummary(ir));
            console.log(`\nWritten: ${outPath}`);
        });
}

module.exports = { registerArchitectureCommands };
