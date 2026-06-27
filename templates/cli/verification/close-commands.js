'use strict';

const { previewClose } = require('./close-preview');
const { applyClose } = require('./close-apply');

function printPreview(r) {
    console.log(`readiness: ${r.readiness}`);
    if (r.note) console.log(`  ${r.note}`);
    for (const b of r.blockers) console.log(`  ✗ ${b.criterionId} [${b.verdict}] → ${b.remedy}`);
    if (r.actions.length) {
        console.log('actions --apply would run:');
        for (const a of r.actions) console.log(`  • ${a}`);
    }
}

function printApply(r) {
    if (!r.applied) {
        if (r.refused === 'dirty-tree') { console.error(r.message); return; }
        if (r.aborted) { console.error(`aborted (rolled back): ${r.error}`); return; }
        console.error(`refused: ${r.readiness || r.refused}`);
        if (r.note) console.error(`  ${r.note}`);
        for (const b of (r.blockers || [])) console.error(`  ✗ ${b.criterionId} [${b.verdict}] → ${b.remedy}`);
        return;
    }
    console.log('readiness: READY — closed (staged, not committed)');
    for (const a of r.actions) console.log(`  • ${a}`);
    console.log(`journal: ${r.journalPath}`);
    if ((r.staged || []).length) console.log(`staged: ${r.staged.join(', ')}`);
}

function registerCloseCommands(program) {
    program.command('close <spec>')
        .description('Closure for a spec: --preview (read-only) or --apply (journaled mutation).')
        .option('--preview', 'Read-only readiness report')
        .option('--apply', 'Perform the closure (only when READY); staged, not committed')
        .option('--strict', 'With --preview: exit non-zero unless READY')
        .option('--json', 'Print JSON output')
        .action((specPath, options) => {
            if (!options.preview && !options.apply) {
                console.error('specify --preview or --apply');
                process.exitCode = 1;
                return;
            }
            if (options.apply) {
                const r = applyClose(specPath);
                if (options.json) console.log(JSON.stringify(r, null, 2));
                else printApply(r);
                if (!r.applied) process.exitCode = 1;
                return;
            }
            const r = previewClose(specPath);
            if (options.json) console.log(JSON.stringify(r, null, 2));
            else printPreview(r);
            if (options.strict && r.readiness !== 'READY') process.exitCode = 1;
        });
}

module.exports = { registerCloseCommands };
