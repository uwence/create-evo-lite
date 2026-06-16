# Raw Memory Namespace Fidelity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `namespace` to `raw_memory/*.md` YAML frontmatter so SQLite rebuild preserves namespace assignments without data loss.

**Architecture:** Three surgical edits to `templates/cli/memory.service.js`: (1) write `namespace` into the frontmatter template on archive write; (2) parse `namespace` from frontmatter in `syncIndexMemory()`; (3) pass the parsed namespace to `ingestArchiveFile()`. Mirror synced to `.evo-lite/cli/memory.service.js` after edits.

**Tech Stack:** Node.js, better-sqlite3, `templates/cli/memory.service.js`

---

### Task 1: Fix `archive()` — write namespace into frontmatter

**Files:**
- Modify: `templates/cli/memory.service.js:1261`

- [ ] **Step 1: Verify current frontmatter template (baseline)**

Run:
```bash
node -e "
const ms = require('./templates/cli/memory.service');
// archive() is not exported; read the file to confirm current line 1261
const fs = require('fs');
const lines = fs.readFileSync('./templates/cli/memory.service.js','utf8').split('\n');
console.log(lines[1260]);
"
```
Expected output (current, broken):
```
    const fileContent = `---\nid: "${id}"\ntimestamp: "${timestamp}"\ntype: "${type}"\ntags: []\n---\n\n${markdownBody}`;
```

- [ ] **Step 2: Edit line 1261 — add `namespace` field**

In `templates/cli/memory.service.js`, replace line 1261:

```js
// BEFORE (line 1261):
    const fileContent = `---\nid: "${id}"\ntimestamp: "${timestamp}"\ntype: "${type}"\ntags: []\n---\n\n${markdownBody}`;

// AFTER (line 1261):
    const fileContent = `---\nid: "${id}"\ntimestamp: "${timestamp}"\ntype: "${type}"\nnamespace: "${preflightCheck.namespace || DEFAULT_NAMESPACE}"\ntags: []\n---\n\n${markdownBody}`;
```

`preflightCheck.namespace` is already in scope at this point (computed at line ~1238–1247). `DEFAULT_NAMESPACE` is imported from `./db` at line 7.

- [ ] **Step 3: Verify the template string changed**

Run:
```bash
node -e "
const fs = require('fs');
const lines = fs.readFileSync('./templates/cli/memory.service.js','utf8').split('\n');
console.log(lines[1260]);
"
```
Expected: line now contains `namespace:`.

---

### Task 2: Fix `syncIndexMemory()` — parse namespace + pass to ingestArchiveFile

**Files:**
- Modify: `templates/cli/memory.service.js:1301-1310`

- [ ] **Step 1: Verify current read block (baseline)**

Run:
```bash
node -e "
const fs = require('fs');
const lines = fs.readFileSync('./templates/cli/memory.service.js','utf8').split('\n');
lines.slice(1300,1311).forEach((l,i)=>console.log(1301+i+': '+l));
"
```
Expected: lines 1301-1303 show three regex matches (`idMatch`, `tsMatch`, `typeMatch`), no `nsMatch`. Line 1305-1310 shows `ingestArchiveFile` call without fifth argument.

- [ ] **Step 2: Edit lines 1301-1310 — add nsMatch + pass namespace**

In `templates/cli/memory.service.js`, replace lines 1301-1310:

```js
// BEFORE (lines 1301-1310):
        const idMatch = markdown.match(/^id:\s*"([^"]+)"/m);
        const tsMatch = markdown.match(/^timestamp:\s*"([^"]+)"/m);
        const typeMatch = markdown.match(/^type:\s*"([^"]+)"/m);

        const ingestion = await ingestArchiveFile(
            filePath,
            typeMatch ? typeMatch[1] : 'task',
            idMatch ? idMatch[1] : path.basename(file, '.md'),
            tsMatch ? tsMatch[1] : new Date().toISOString()
        );

// AFTER (lines 1301-1311):
        const idMatch = markdown.match(/^id:\s*"([^"]+)"/m);
        const tsMatch = markdown.match(/^timestamp:\s*"([^"]+)"/m);
        const typeMatch = markdown.match(/^type:\s*"([^"]+)"/m);
        const nsMatch = markdown.match(/^namespace:\s*"([^"]+)"/m);

        const ingestion = await ingestArchiveFile(
            filePath,
            typeMatch ? typeMatch[1] : 'task',
            idMatch ? idMatch[1] : path.basename(file, '.md'),
            tsMatch ? tsMatch[1] : new Date().toISOString(),
            { namespace: nsMatch ? nsMatch[1] : DEFAULT_NAMESPACE }
        );
```

`DEFAULT_NAMESPACE` is already imported at line 7 and in scope inside `syncIndexMemory()`.

- [ ] **Step 3: Verify read block changed**

Run:
```bash
node -e "
const fs = require('fs');
const lines = fs.readFileSync('./templates/cli/memory.service.js','utf8').split('\n');
lines.slice(1300,1313).forEach((l,i)=>console.log(1301+i+': '+l));
"
```
Expected: line 1304 shows `nsMatch`, `ingestArchiveFile` call now has fifth argument `{ namespace: ... }`.

- [ ] **Step 4: Smoke-test module loads without error**

Run:
```bash
node -e "require('./templates/cli/memory.service.js'); console.log('OK')"
```
Expected: `OK` (no syntax errors).

---

### Task 3: Round-trip verification

**Files:** (read-only verification, no edits)

- [ ] **Step 1: Write a test archive entry with non-default namespace**

Run:
```bash
node -e "
const ms = require('./.evo-lite/cli/memory.service');
ms.archive('namespace-fidelity-test', 'task', { namespace: 'code' }).then(r => {
  console.log('archived to:', r.filePath);
  const fs = require('fs');
  const content = fs.readFileSync(r.filePath, 'utf8');
  const nsLine = content.split('\n').find(l => l.startsWith('namespace:'));
  console.log('frontmatter namespace line:', nsLine);
  process.exit(nsLine && nsLine.includes('code') ? 0 : 1);
});
"
```

Note: this runs against `.evo-lite/cli/` mirror — sync happens in Task 4. If mirror not yet synced, run against `templates/cli/` directly:
```bash
node -e "
const ms = require('./templates/cli/memory.service');
ms.archive('namespace-fidelity-test', 'task', { namespace: 'code' }).then(r => {
  const fs = require('fs');
  const content = fs.readFileSync(r.filePath, 'utf8');
  const nsLine = content.split('\n').find(l => l.startsWith('namespace:'));
  console.log('frontmatter namespace line:', nsLine);
  process.exit(nsLine && nsLine.includes('code') ? 0 : 1);
});
"
```
Expected: prints `namespace: "code"`, exits 0.

- [ ] **Step 2: Verify rebuild preserves namespace**

Run:
```bash
node .evo-lite/cli/memory.js rebuild
```
Expected: completes without error, prints chunk count ≥ 1.

Then verify:
```bash
node -e "
const { evo_verify } = require('./.evo-lite/cli/memory.service');
// use the MCP verify tool instead
"
```

Or run the MCP verify endpoint:
```bash
node -e "
const ms = require('./.evo-lite/cli/memory.service');
ms.verify({ silent: false }).then(r => {
  console.log('code chunks:', r.namespaces && r.namespaces.code ? r.namespaces.code.chunks : 'N/A');
});
"
```
Expected: `code chunks` value ≥ 1 (the test entry from Step 1).

- [ ] **Step 3: Verify old files without namespace field rebuild to prose (backward compat)**

Run:
```bash
node -e "
const fs = require('fs');
const rawDir = '.evo-lite/raw_memory';
const files = fs.readdirSync(rawDir).filter(f => f.endsWith('.md'));
const old = files.filter(f => {
  const content = fs.readFileSync(rawDir + '/' + f, 'utf8');
  return !content.includes('\nnamespace:');
});
console.log('old files without namespace:', old.length, '(should be > 0, all pre-fix)');
console.log('example:', old[0]);
"
```
Expected: shows count of files without namespace field (the pre-fix files). No crash.

---

### Task 4: Sync mirror + commit

**Files:**
- Sync: `templates/cli/memory.service.js` → `.evo-lite/cli/memory.service.js`

- [ ] **Step 1: Copy template to mirror**

Run:
```bash
cp templates/cli/memory.service.js .evo-lite/cli/memory.service.js
```

- [ ] **Step 2: Verify mirror matches template**

Run:
```bash
diff templates/cli/memory.service.js .evo-lite/cli/memory.service.js
```
Expected: no output (files identical).

- [ ] **Step 3: Smoke-test mirror**

Run:
```bash
node -e "require('./.evo-lite/cli/memory.service.js'); console.log('OK')"
```
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add templates/cli/memory.service.js .evo-lite/cli/memory.service.js
git commit -m "fix(archive): write namespace to raw_memory frontmatter for rebuild fidelity

archive() now includes namespace in YAML frontmatter.
syncIndexMemory() reads namespace from frontmatter, falls back to prose.
ingestArchiveFile() call passes namespace option from parsed frontmatter.

Closes gap: pre-fix files rebuild to prose (correct; all existing entries are prose).
New entries with code/symbol namespace survive rebuild round-trip.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
| Requirement | Task |
|-------------|------|
| archive() writes namespace to frontmatter | Task 1 |
| syncIndexMemory() reads namespace from frontmatter | Task 2 |
| ingestArchiveFile() accepts namespace option | Task 2 Step 2 |
| Round-trip fidelity for code namespace | Task 3 Step 1-2 |
| Old files default to prose (backward compat) | Task 3 Step 3 |
| Mirror sync | Task 4 |

All 5 spec acceptance criteria covered. No gaps.

**Placeholder scan:** No TBD, no "add appropriate", no "similar to". All code blocks are complete.

**Type consistency:** `ingestArchiveFile(filePath, type, id, timestamp, options)` — fifth arg `options` object already accepted (Task 1 line 1264 shows existing call with options). Adding `{ namespace: ... }` to the sync path matches this signature.
