'use strict';

// mem wiki command group. Exit contract (design §5): success (even if the
// browser fails to open) = 0; build failure = 1; invalid args / invalid
// wiki-groups.json = 2. Browser launch uses execFile arg arrays — no shell.

const path = require('node:path');
const { execFile } = require('node:child_process');

function invalidArgsExit(err) {
    const code = err && err.code ? err.code : '';
    if (code === 'commander.help' || code === 'commander.helpDisplayed'
        || code === 'commander.version' || code === 'commander.helpDisplayedAfterError') {
        process.exit(0);
    }
    if (err && err.message) process.stderr.write(err.message + '\n');
    process.exit(2);
}

function openInBrowser(indexPath, onDone) {
    // argv-form launchers only — never `cmd /c start` (shell-adjacent).
    // EVO_WIKI_BROWSER overrides the launcher; it exists for the automated
    // "--open failure still exits 0" test and for unusual desktop setups.
    const override = process.env.EVO_WIKI_BROWSER;
    const p = process.platform;
    const [cmd, args] = override ? [override, [indexPath]]
        : p === 'win32' ? ['explorer.exe', [indexPath]]
        : p === 'darwin' ? ['open', [indexPath]]
        : ['xdg-open', [indexPath]];
    execFile(cmd, args, err => {
        // explorer.exe routinely exits non-zero even on success; only a spawn
        // failure (string code like 'ENOENT') is a real launch error there.
        if (err && cmd === 'explorer.exe' && typeof err.code === 'number') return onDone(null);
        onDone(err || null);
    });
}

function registerWikiCommands(program) {
    const wiki = program.command('wiki').description('Architecture-governance wiki: static, offline, Chinese-language project map.');

    wiki.command('build')
        .description('Generate .evo-lite/generated/wiki/ from architecture + planning + governance data.')
        .option('--open', 'Open index.html in the default browser after a successful build')
        .action(async options => {
            const { buildWiki } = require('./build');
            const projectRoot = process.env.EVO_LITE_WORKSPACE_ROOT || process.cwd();
            const result = await buildWiki({ projectRoot });
            if (!result.ok) {
                process.stderr.write(result.error + '\n');
                process.exit(result.invalidConfig ? 2 : 1);
            }
            const indexPath = path.join(result.outDir, 'index.html');
            console.log(`wiki: ${result.manifest.pages.length} page(s) generated`);
            console.log(`  ${indexPath}`);
            if (result.warnings.length) console.log(`  warnings: ${result.warnings.length} (see manifest.json)`);
            if (options.open) {
                openInBrowser(indexPath, err => {
                    if (err) console.log(`  warning: could not open browser (${err.message}) — open the path above manually`);
                    process.exit(0);
                });
            } else process.exit(0);
        });

    wiki.action(() => wiki.outputHelp());
    for (const c of [wiki, ...wiki.commands]) c.exitOverride(invalidArgsExit);
}

module.exports = { registerWikiCommands };
