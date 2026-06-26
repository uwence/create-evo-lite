'use strict';

const fs = require('fs');
const { parseSpecCriteria, validateCriteria } = require('./validate-contract');

function registerVerificationCommands(program) {
    const vc = program.command('verify-contract').description('Verification contract (criteria/evidence) tools.');
    vc.command('lint <spec>')
        .description('Validate a spec\'s machine-readable acceptance criteria block.')
        .option('--json', 'Print JSON output')
        .action((specPath, options) => {
            let text;
            try {
                text = fs.readFileSync(specPath, 'utf8');
            } catch (e) {
                console.error(`Cannot read spec: ${specPath}`);
                process.exitCode = 1;
                return;
            }
            const parsed = parseSpecCriteria(text);
            const findings = parsed.error
                ? [{ id: specPath, level: 'error', message: parsed.error }]
                : validateCriteria(parsed.criteria);
            if (options.json) {
                console.log(JSON.stringify({ criteria: parsed.criteria, findings }, null, 2));
            } else if (findings.length === 0) {
                console.log(`✅ ${parsed.criteria.length} criteria valid in ${specPath}`);
            } else {
                for (const f of findings) console.error(`[${f.level}] ${f.id}: ${f.message}`);
            }
            if (findings.some(f => f.level === 'error')) process.exitCode = 1;
        });
}

module.exports = { registerVerificationCommands };
