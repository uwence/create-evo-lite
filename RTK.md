# RTK For Codex In This Repo

RTK is installed locally on this machine and works in this repository on native Windows.

Current verified binary:

- `rtk --version` -> `rtk 0.39.0`

Important host limitation:

- In Codex on native Windows, RTK is **guidance-only**
- Unlike Claude Code / Cursor / Gemini hook integrations, Codex does not transparently rewrite shell commands here
- A Codex `PreToolUse` hook can still inspect Bash commands and deny raw RTK-optimizable commands with a retry suggestion
- That means you should call `rtk ...` explicitly when you want compact output

## When To Use RTK

Use RTK when command output is likely to be large, repetitive, or noisy:

- git inspection: `rtk git status`, `rtk git diff`, `rtk git log -n 10`
- test output: `rtk test npm test`, `rtk cargo test`, `rtk pytest`, `rtk go test`
- lint / build output: `rtk lint`, `rtk tsc`, `rtk next build`
- reading/searching via shell: `rtk read AGENTS.md`, `rtk smart index.js`, `rtk grep "context-mode" .`
- logs / JSON / environment inspection: `rtk log app.log`, `rtk json package.json`, `rtk env -f OPENAI`

## When To Skip RTK

Use the raw command when:

- exact, byte-for-byte output matters
- the command is already tiny
- you need tooling behavior RTK does not preserve well for that case

Examples:

- raw: `git rev-parse HEAD`
- raw: `node -p "process.version"`
- raw: `Get-Content file.txt -TotalCount 20`

## Good Defaults For This Repo

Prefer these patterns in this workspace:

- repo state: `rtk git status`
- commit review: `rtk git diff`
- recent history: `rtk git log -n 10`
- code search in shell: `rtk grep "symbolName" .`
- file skim: `rtk read path\\to\\file.js`
- file summary: `rtk smart path\\to\\file.js`
- noisy test run: `rtk test node .evo-lite\\cli\\test.js`

## Verified In This Repository

These commands were confirmed working in `D:\Data\ProjectAgent\create-evo-lite`:

- `rtk --version`
- `rtk init --show --codex`
- `rtk git status`
- Codex RTK pretool bridge for Bash shell calls

## Recommended Setup Choice

For this project, keep RTK at the **project guidance layer**:

- project layer: `AGENTS.md` + this `RTK.md`
- user layer: the installed `rtk.exe` binary and any user-level RTK config

This keeps Evo-Lite, GitNexus, and Codex host instructions repo-aware without depending on a Windows shell hook that RTK does not support for Codex.
