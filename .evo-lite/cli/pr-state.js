'use strict';

const service = require('./pr-state.service');

function resultExitCode(result) {
    if (result === 'pass') return 0;
    if (result === 'drift') return 1;
    return 2;
}

function renderText(report) {
    const lines = [`pr-state: ${report.result}`];
    if (report.pr && report.pr.number) {
        const repository = report.pr.repository ? `${report.pr.repository}#` : '#';
        lines.push(`pr: ${repository}${report.pr.number}`);
    }
    if (report.expected && Object.keys(report.expected).length > 0) {
        lines.push(`expected: ${JSON.stringify(report.expected)}`);
    }
    if (report.observed && Object.keys(report.observed).length > 0) {
        lines.push(`observed: ${JSON.stringify(report.observed)}`);
    }
    for (const finding of report.findings || []) {
        lines.push(
            `finding ${finding.code}: ${finding.field} expected=${JSON.stringify(finding.expected)} observed=${JSON.stringify(finding.observed)}`
        );
    }
    for (const error of report.errors || []) {
        lines.push(`error ${error.code}: ${error.message}`);
    }
    return lines.join('\n');
}

function registerPrStateCommands(program, deps = {}) {
    const validate = deps.validatePrState || service.validatePrState;
    const cwd = deps.cwd || (() => process.cwd());
    const group = program.command('pr-state')
        .description('Validate declared pull-request governance state.');

    group.command('validate [pr]')
        .description('Compare the PR body state block with current read-only observations.')
        .option('--json', 'Emit the structured validation envelope')
        .action((pr, options) => {
            const report = validate(pr, { cwd: cwd() });
            console.log(options.json ? JSON.stringify(report, null, 2) : renderText(report));
            process.exitCode = resultExitCode(report.result);
        });
}

module.exports = {
    registerPrStateCommands,
    resultExitCode,
    renderText,
};
