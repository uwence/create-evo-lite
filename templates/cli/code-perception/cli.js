'use strict';

// `mem code` command group — the human/agent CLI over the ONE Unified Explore
// service (../code-perception.js). Unified exit model (spec §3.1): success and
// capability-degraded both exit 0; only result.ok===false (internal invariant /
// adapter break with no fallback) exits 1; commander handles invalid args (exit 2).


function printResult(result, options) {
    if (options && options.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        return;
    }
    console.log(`code explore: "${result.query}"`);
    console.log(`  providers: ${result.providers.map(p => p.id + (p.degraded ? '(degraded)' : '')).join(', ') || 'none'}`);
    console.log(`  freshness: stale=${result.freshness.stale} dirty=${result.freshness.dirty}`);
    console.log(`  matches: ${result.matches.length}  relationships: ${result.relationships.length}  links: ${result.governance.links.length}`);
    if (result.recommendedReading.length) {
        console.log('  recommended reading:');
        for (const r of result.recommendedReading.slice(0, 8)) console.log(`    [${r.priority}] ${r.path} — ${r.reason}`);
    }
    if (result.diagnostics.length) console.log(`  diagnostics: ${result.diagnostics.length}`);
}

function exitFor(result) {
    // Success-shaped degradation exits 0; only a true invariant break exits 1.
    process.exitCode = result && result.ok === false ? 1 : 0;
}

// Spec §3.1 / Global Constraint: invalid CLI args must exit 2. Commander's
// DEFAULT for unknown-command / missing-argument is exit 1, so the `code` group
// installs a SCOPED exitOverride (on the group + every subcommand — never on the
// root program, which would change exit codes for every other `mem` command).
// help/version are not errors → exit 0; every other parse failure → exit 2.
function invalidArgsExit(err) {
    const code = err && err.code ? err.code : '';
    if (code === 'commander.help' || code === 'commander.helpDisplayed'
        || code === 'commander.version' || code === 'commander.helpDisplayedAfterError') {
        process.exit(0);
    }
    if (err && err.message) process.stderr.write(err.message + '\n');
    process.exit(2);
}

function registerCodeCommands(program) {
    const service = require('../code-perception');
    const code = program.command('code').description('Provider-first code perception: explore code + governance context.');

    code.command('providers')
        .description('List code-perception providers and their availability.')
        .option('--json', 'Print JSON output')
        .action(async options => {
            const result = await service.exploreCode('', { includeSource: false, includeImpact: false, includeGovernance: false });
            if (options.json) process.stdout.write(JSON.stringify({ providers: result.providers, diagnostics: result.diagnostics }, null, 2) + '\n');
            else { console.log('providers:'); for (const p of result.providers) console.log(`  ${p.id}  role=${p.role} ready=${p.ready} index=${p.indexState}${p.degraded ? ' (degraded)' : ''}`); }
            exitFor(result);
        });

    code.command('status')
        .description('Show provider status, freshness and governance link counts.')
        .option('--json', 'Print JSON output')
        .action(async options => {
            const result = await service.exploreCode('', { includeSource: false, includeImpact: false });
            if (options.json) process.stdout.write(JSON.stringify({ providers: result.providers, freshness: result.freshness, links: result.governance.linkSummary, diagnostics: result.diagnostics }, null, 2) + '\n');
            else { console.log(`freshness: stale=${result.freshness.stale} dirty=${result.freshness.dirty}`); console.log(`links: ${JSON.stringify(result.governance.linkSummary)}`); }
            exitFor(result);
        });

    code.command('search <query>')
        .description('Search code symbols (structural provider; degrades to empty under native-lite).')
        .option('--json', 'Print JSON output')
        .action(async (query, options) => {
            const result = await service.exploreCode(query, { includeSource: false, includeImpact: false, includeGovernance: false });
            if (options.json) process.stdout.write(JSON.stringify({ query: result.query, matches: result.matches, diagnostics: result.diagnostics }, null, 2) + '\n');
            else { console.log(`${result.matches.length} match(es) for "${query}"`); for (const m of result.matches) console.log(`  ${m.name}  ${m.filePath || ''}`); }
            exitFor(result);
        });

    code.command('explore <query>')
        .description('Unified explore: matches + relationships + impact + governance + recommended reading.')
        .option('--json', 'Print JSON output')
        .action(async (query, options) => {
            const result = await service.exploreCode(query, {});
            printResult(result, options);
            exitFor(result);
        });

    code.command('callers <symbol>')
        .description('Show callers of a symbol (structural provider required).')
        .option('--json', 'Print JSON output')
        .action(async (symbol, options) => {
            const result = await service.exploreCode(symbol, { includeSource: false, includeImpact: false, includeGovernance: false });
            const callers = result.relationships.filter(r => r.kind === 'called_by');
            if (options.json) process.stdout.write(JSON.stringify({ symbol, callers, diagnostics: result.diagnostics }, null, 2) + '\n');
            else { console.log(`${callers.length} caller(s) of ${symbol}`); for (const c of callers) console.log(`  ${c.source.name} ${c.source.filePath || ''}`); }
            exitFor(result);
        });

    code.command('callees <symbol>')
        .description('Show callees of a symbol (structural provider required).')
        .option('--json', 'Print JSON output')
        .action(async (symbol, options) => {
            const result = await service.exploreCode(symbol, { includeSource: false, includeImpact: false, includeGovernance: false });
            const callees = result.relationships.filter(r => r.kind === 'calls');
            if (options.json) process.stdout.write(JSON.stringify({ symbol, callees, diagnostics: result.diagnostics }, null, 2) + '\n');
            else { console.log(`${callees.length} callee(s) of ${symbol}`); for (const c of callees) console.log(`  ${c.target.name} ${c.target.filePath || ''}`); }
            exitFor(result);
        });

    code.command('impact <symbol>')
        .description('Show downstream impact of a symbol (structural provider required; success-shaped guidance otherwise).')
        .option('--json', 'Print JSON output')
        .action(async (symbol, options) => {
            const result = await service.exploreCode(symbol, { includeSource: false, includeImpact: true, includeGovernance: false });
            if (options.json) process.stdout.write(JSON.stringify({ symbol, impact: result.impact || null, diagnostics: result.diagnostics }, null, 2) + '\n');
            else if (result.impact) console.log(`impact of ${symbol}: risk=${result.impact.risk} downstream=${result.impact.downstream.length}`);
            else console.log(`impact analysis unavailable for ${symbol} (no structural provider). See diagnostics.`);
            exitFor(result);
        });

    code.command('context')
        .description('Governance context for the current focus / a task / a spec.')
        .option('--task <task-id>', 'Scope to a task id')
        .option('--spec <spec-id>', 'Scope to a spec id')
        .option('--json', 'Print JSON output')
        .action(async options => {
            const focusId = options.task || options.spec || undefined;
            const query = options.task || options.spec || '';
            const result = await service.exploreCode(query, { focusId, includeSource: false, includeImpact: false });
            const links = focusId ? result.governance.links.filter(l => l.governanceEntityId === focusId) : result.governance.links;
            if (options.json) process.stdout.write(JSON.stringify({ scope: focusId || 'focus', links, tasks: result.governance.tasks, diagnostics: result.diagnostics }, null, 2) + '\n');
            else { console.log(`context: ${focusId || 'current focus'} — ${links.length} link(s)`); for (const l of links) console.log(`  ${l.kind} ${l.status} conf=${l.confidence}`); }
            exitFor(result);
        });

    code.action(() => code.outputHelp());

    // Scope the exit-2 override to this group + its subcommands — never the root
    // program (that would change every other `mem` command's exit codes). Applied
    // AFTER all subcommands exist. The nested-group walk is kept so a future
    // subgroup (e.g. `mem code wiki` in Phase 4b) is covered without a code change.
    const scoped = [code, ...code.commands];
    for (const c of code.commands) scoped.push(...(Array.isArray(c.commands) ? c.commands : []));
    for (const c of scoped) c.exitOverride(invalidArgsExit);
}

module.exports = { registerCodeCommands };
