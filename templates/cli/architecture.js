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

    arch.command('diff')
        .description('Run architecture drift checks (R001, R002, R007), write drift-report.json.')
        .action(async () => {
            const { runArchitectureDrift, loadReport, saveReport, mergeFindings } = require('./architecture/diff');
            const archIRPath = path.join(projectRoot, '.evo-lite', 'generated', 'architecture', 'architecture-ir.json');
            const archIR = fs.existsSync(archIRPath) ? JSON.parse(fs.readFileSync(archIRPath, 'utf8')) : null;

            console.log('Running architecture drift checks...\n');
            const newFindings = runArchitectureDrift(projectRoot, archIR);

            const existing = loadReport(projectRoot);
            existing.findings = mergeFindings(existing.findings, newFindings, 'architecture');
            existing.project = { name: path.basename(projectRoot), root: '.' };
            const outPath = saveReport(projectRoot, existing);

            if (newFindings.length === 0) {
                console.log('No architecture drift findings.');
            } else {
                for (const f of newFindings) {
                    console.log(`[${f.level}] ${f.rule}: ${f.message}`);
                    if (f.suggestedAction) console.log(`  → ${f.suggestedAction}`);
                }
            }
            console.log(`\nWritten: ${outPath}`);
        });
}

module.exports = { registerArchitectureCommands };
