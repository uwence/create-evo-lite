'use strict';
// Decides whether this target has a provenance context at all, BEFORE anything
// is read or written. The order matters: a nested target's --absolute-git-dir
// succeeds and returns the ENCLOSING worktree's git-dir, so a classifier that
// began at owner resolution would create <outer-git-dir>/evo-lite before ever
// noticing it was out of scope.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { pathIdentity } = require('./path-identity');

// Every query is bound to the target. The CLI takes a target path, so an
// unbound query would resolve the CALLER's git-dir while mutating the target's
// hook (index.js:93, index.js:292).
function defaultGitQuery(targetDir, args) {
    // The message locale is forced so the classification below reads one fixed
    // string rather than whatever the host has configured.
    const env = { ...process.env, LC_ALL: 'C', LC_MESSAGES: 'C', LANGUAGE: '' };
    try {
        const stdout = execFileSync('git', ['-C', targetDir, ...args],
            { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
        return { status: 0, stdout: stdout.trim(), stderr: '' };
    } catch (err) {
        // Discriminate on `status`, NOT on `code`: execFileSync sets `status` to
        // the exit code when the process RAN and failed, and leaves it null when
        // the process could not be spawned at all. `code` is set in both cases on
        // some Node versions, so keying off it would misread a positive
        // not-a-repository answer as an unavailable git.
        if (err && typeof err.status === 'number') {
            return { status: err.status, stdout: '', stderr: String(err.stderr || '') };
        }
        throw err;                                // git absent / cannot spawn
    }
}

// A non-zero exit is NOT an authority on "there is no repository here". Measured:
// a non-repository directory and a BARE repository both exit 128 —
//   "fatal: not a git repository (or any of the parent directories): .git"
//   "fatal: this operation must be run in a work tree"
// — and only the first is a positive not-a-repository answer. Everything else
// (bare repo, dubious ownership, corrupt config, permission) is a query failure
// and must land on SCOPE-UNRESOLVED.
//
// The match is deliberately one-directional: anything that does not positively
// match is treated as a failure, so a future change to Git's wording degrades
// this into fail-closed rather than into a false "no repository".
const NOT_A_REPOSITORY = /fatal:\s+not a git repository/i;
const isPositiveNotARepository = (res) =>
    res.status !== 0 && NOT_A_REPOSITORY.test(res.stderr || '');

function classifyTopology(targetDir, deps = {}) {
    const gitQuery = deps.gitQuery || defaultGitQuery;
    const fsOps = deps.fsOps || fs;

    let top;
    try {
        top = gitQuery(targetDir, ['rev-parse', '--show-toplevel']);
    } catch (err) {
        return { state: 'SCOPE-UNRESOLVED', detail: `git unavailable: ${err.message}` };
    }
    if (top.status !== 0 || !top.stdout) {
        if (isPositiveNotARepository(top)) return { state: 'NO-GIT-ADMIN-TOPOLOGY' };
        return { state: 'SCOPE-UNRESOLVED', detail: `scope query failed (${top.status})` };
    }

    const identity = pathIdentity(targetDir, top.stdout, fsOps);
    if (identity === 'DISTINCT') return { state: 'NESTED-TARGET', worktreeTop: top.stdout };
    if (identity === 'UNESTABLISHED') {
        // NESTED-TARGET is a positive assertion; UNESTABLISHED is precisely the
        // state in which we are not entitled to make it.
        return { state: 'SCOPE-UNRESOLVED', detail: 'workspace scope could not be established' };
    }

    let owner;
    try {
        owner = gitQuery(targetDir, ['rev-parse', '--absolute-git-dir']);
    } catch (err) {
        return { state: 'OWNER-UNRESOLVED', detail: `git unavailable: ${err.message}` };
    }
    if (owner.status !== 0 || !owner.stdout) {
        // Same taxonomy as the scope gate, not a local simplification. It is rare
        // to get here (scope just established a worktree) but a repository can be
        // removed between the two queries, and the frozen states do not change
        // because a branch is unlikely.
        if (isPositiveNotARepository(owner)) return { state: 'NO-GIT-ADMIN-TOPOLOGY' };
        return { state: 'OWNER-UNRESOLVED', detail: `owner query failed (${owner.status})` };
    }

    const ownerRoot = path.join(owner.stdout, 'evo-lite');
    return {
        state: 'IN-SCOPE',
        ownerRoot,
        worktreeTop: top.stdout,
        provenancePath: path.join(ownerRoot, 'hook-provenance.json'),
    };
}

module.exports = { classifyTopology, defaultGitQuery };
