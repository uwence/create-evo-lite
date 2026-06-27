'use strict';

const fs = require('fs');
const { parseSpecCriteria, validateCriteria } = require('./validate-contract');
const engine = require('./engine');

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

    vc.command('run <spec>')
        .description('Run machine verifiers and write commit-bound evidence (fail-closed on a dirty tree).')
        .action((specPath) => {
            const res = engine.runSpec(specPath);
            if (!res.ok) {
                console.error(res.error === 'dirty-tree'
                    ? '❌ working tree is dirty — commit changes first; evidence must bind to a real commit'
                    : `❌ ${res.error}`);
                process.exitCode = 1;
                return;
            }
            for (const w of res.written) console.log(`${w.verdict === 'PASS' ? '✅' : '❌'} ${w.criterionId} ${w.verdict}`);
            console.log(`ran ${res.written.length} machine verifier(s)`);
        });

    vc.command('status <spec>')
        .description('Show live four-state verdicts for a spec.')
        .option('--strict', 'Exit non-zero if any criterion is not PASS')
        .option('--json', 'Print JSON output')
        .action((specPath, options) => {
            const verdicts = engine.statusSpec(specPath);
            if (options.json) {
                console.log(JSON.stringify(verdicts, null, 2));
            } else {
                for (const v of verdicts) console.log(`${v.verdict.padEnd(11)} ${v.criterionId}  ${v.detail || ''}`);
            }
            if (options.strict && verdicts.some(v => v.verdict !== 'PASS')) process.exitCode = 1;
        });

    vc.command('attest <spec> <criterionId>')
        .description('Record a manual attestation (PASS) for a manual criterion.')
        .requiredOption('--by <name>', 'Who is attesting')
        .option('--note <text>', 'Attestation note')
        .action((specPath, criterionId, options) => {
            engine.attestSpec(specPath, criterionId, { by: options.by, note: options.note });
            console.log(`✅ attested ${criterionId} by ${options.by}`);
        });
}

module.exports = { registerVerificationCommands };
