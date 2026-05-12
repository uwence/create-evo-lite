const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const hookScript = path.join(repoRoot, '.github', 'hooks', 'dogfood-commit-hook.js');
const payload = JSON.stringify({
    tool_name: 'runTerminalCommand',
    tool_input: {
        command: 'git commit -m "test"',
    },
});

function createRuntimeFixture(name, trajectoryLine) {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), `evo-dogfood-hook-${name}-`));
    const evoLiteDir = path.join(workspaceRoot, '.evo-lite');
    fs.mkdirSync(evoLiteDir, { recursive: true });
    fs.writeFileSync(
        path.join(evoLiteDir, 'active_context.md'),
        [
            '# test',
            '<!-- BEGIN_META -->',
            'meta',
            '<!-- END_META -->',
            '<!-- BEGIN_FOCUS -->',
            'focus',
            '<!-- END_FOCUS -->',
            '<!-- BEGIN_BACKLOG -->',
            '- [ ] [a1b2] task',
            '<!-- END_BACKLOG -->',
            '<!-- BEGIN_TRAJECTORY -->',
            trajectoryLine,
            '<!-- END_TRAJECTORY -->',
        ].join('\n'),
        'utf8'
    );
    return workspaceRoot;
}

function runHook(workspaceRoot) {
    const result = spawnSync(process.execPath, [hookScript, 'pretooluse'], {
        cwd: workspaceRoot,
        input: payload,
        encoding: 'utf8',
        windowsHide: true,
    });

    return {
        status: result.status,
        stdout: (result.stdout || '').trim(),
        stderr: (result.stderr || '').trim(),
    };
}

function assertSilent(result, label) {
    assert.strictEqual(result.status, 0, `${label} exited with a non-zero status`);
    assert.strictEqual(result.stderr, '', `${label} wrote to stderr`);
    assert.strictEqual(result.stdout, '', `${label} should stay silent but printed output`);
}

function assertWarned(result, label) {
    assert.strictEqual(result.status, 0, `${label} exited with a non-zero status`);
    assert.strictEqual(result.stderr, '', `${label} wrote to stderr`);
    assert.ok(result.stdout.includes('Dog Food 提醒'), `${label} did not print the dog food reminder`);
    assert.ok(result.stdout.includes('先 dog food，再提交'), `${label} reminder did not include the next step`);
}

function main() {
    const dogFoodResult = runHook(createRuntimeFixture(
        'explicit-dogfood',
        '- [abcd1234] 2026-05-12 DogFood: Completed smoke test for commit hook.'
    ));
    assertSilent(dogFoodResult, 'DogFood mechanism');

    const hookDogFoodResult = runHook(createRuntimeFixture(
        'explicit-hookdogfood',
        '- [abcd1234] 2026-05-12 HookDogFood: Completed pre-commit hook dog food validation.'
    ));
    assertSilent(hookDogFoodResult, 'HookDogFood mechanism');

    const falsePositiveResult = runHook(createRuntimeFixture(
        'keyword-only',
        '- [abcd1234] 2026-05-12 RefactorRuntime: Completed dog food style smoke test wording only.'
    ));
    assertWarned(falsePositiveResult, 'Keyword-only trajectory');

    console.log('dogfood pretooluse hook tests passed');
}

main();