'use strict';

const { previewClose } = require('./close-preview');

function registerCloseCommands(program) {
    program.command('close <spec>')
        .description('Closure readiness for a spec (Phase 2: --preview only, read-only).')
        .option('--preview', 'Read-only readiness report (required in Phase 2)')
        .option('--strict', 'Exit non-zero unless READY')
        .option('--json', 'Print JSON output')
        .action((specPath, options) => {
            if (!options.preview) {
                console.error('--apply not yet implemented (Phase 3); use --preview');
                process.exitCode = 1;
                return;
            }
            const r = previewClose(specPath);
            if (options.json) {
                console.log(JSON.stringify(r, null, 2));
            } else {
                console.log(`readiness: ${r.readiness}`);
                if (r.note) console.log(`  ${r.note}`);
                for (const b of r.blockers) console.log(`  ✗ ${b.criterionId} [${b.verdict}] → ${b.remedy}`);
                if (r.actions.length) {
                    console.log('actions --apply would run:');
                    for (const a of r.actions) console.log(`  • ${a}`);
                }
            }
            if (options.strict && r.readiness !== 'READY') process.exitCode = 1;
        });
}

module.exports = { registerCloseCommands };
