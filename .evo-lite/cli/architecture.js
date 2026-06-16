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

    arch.command('where <file>')
        .description('Reverse lookup: which module owns <file>? Reads cached IRs.')
        .option('--json', 'Emit JSON.')
        .action((file, options) => {
            const result = lookupFile(projectRoot, file);
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
                return;
            }
            if (result.status === 'no-arch-ir') {
                console.log('architecture-ir.json not found. Run `mem architecture scan` first.');
                process.exitCode = 1;
                return;
            }
            if (result.status === 'unclassified') {
                console.log(`${result.path} → unclassified (no module rule matches)`);
                console.log('  hint: add to MODULE_RULES in templates/cli/architecture/infer-modules.js');
                return;
            }
            if (result.status === 'not-found') {
                console.log(`${result.path} → not in architecture-ir.json files[]`);
                console.log('  hint: file may be outside WALK_TARGETS, or run `mem architecture scan` to refresh');
                process.exitCode = 1;
                return;
            }
            console.log(`${result.path} → ${result.module.id} (role: ${result.module.role}, confidence: ${result.module.confidence})`);
            console.log(`  module name: ${result.module.name}`);
            if (result.linkedTasks && result.linkedTasks.length > 0) {
                console.log(`  linked tasks: ${result.linkedTasks.join(', ')}`);
            } else {
                console.log('  linked tasks: none');
            }
        });
}

function lookupFile(projectRoot, file) {
    const archIRPath = path.join(projectRoot, '.evo-lite', 'generated', 'architecture', 'architecture-ir.json');
    if (!fs.existsSync(archIRPath)) {
        return { status: 'no-arch-ir', path: file };
    }
    const archIR = JSON.parse(fs.readFileSync(archIRPath, 'utf8'));
    const normalized = String(file).replace(/\\/g, '/').replace(/^\.\//, '');
    const fileEntry = (archIR.files || []).find(f => f.path === normalized);
    if (!fileEntry) {
        return { status: 'not-found', path: normalized };
    }
    if (!fileEntry.module) {
        return { status: 'unclassified', path: normalized };
    }
    const moduleEntry = (archIR.modules || []).find(m => m.id === fileEntry.module);

    let linkedTasks = [];
    const planIRPath = path.join(projectRoot, '.evo-lite', 'generated', 'planning', 'plan-ir.json');
    if (fs.existsSync(planIRPath)) {
        const planIR = JSON.parse(fs.readFileSync(planIRPath, 'utf8'));
        linkedTasks = (planIR.tasks || [])
            .filter(t => Array.isArray(t.linkedFiles) && t.linkedFiles.some(lf => lf === normalized))
            .map(t => t.id);
    }

    return {
        status: 'ok',
        path: normalized,
        module: {
            id: moduleEntry ? moduleEntry.id : fileEntry.module,
            name: moduleEntry ? moduleEntry.name : null,
            role: fileEntry.role || (moduleEntry ? moduleEntry.role : null),
            confidence: fileEntry.confidence || (moduleEntry ? moduleEntry.confidence : null),
        },
        linkedTasks,
    };
}

module.exports = { registerArchitectureCommands, lookupFile };
