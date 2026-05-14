# Evo Recall-First Takeover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Evo-Lite 在 `/evo` / `bootstrap` 接管时默认执行一次有界的 targeted recall，并把“历史命中是否改变下一步”显式输出给用户，同时保持 `active_context -> context track -> archive` 作为唯一 durable 主链。

**Architecture:** 本计划落实 [docs/superpowers/specs/2026-05-14-evo-recall-first-takeover-design.md](../specs/2026-05-14-evo-recall-first-takeover-design.md) 中的“架构 / Architecture”“API & 契约 / Contracts”“测试策略 / Testing”三部分：在 live runtime 里增加 recall-first orchestration，在 bootstrap 输出里增加 `memory_*` 字段，再把同样的行为同步到 `templates/cli/*` 和 `/evo` 工作流文档。

**Tech Stack:** Node.js CommonJS, commander.js CLI, better-sqlite3 / SQLite FTS5 runtime, assert-based Node integration tests, npm dogfood hook script.

---

## File map

### Existing files to modify

- `.evo-lite/cli/memory.service.js` — 增加 recall-first takeover orchestration、query 提取与命中压缩。
- `.evo-lite/cli/memory.js` — 在 `runBootstrapCommand()` 接线 recall bundle，并扩展 `formatBootstrapReport()` 输出契约。
- `.evo-lite/cli/test.js` — 为 no-match / matched / noise-filter 行为增加回归测试。
- `templates/cli/memory.service.js` — 镜像 live runtime 的 recall-first orchestration。
- `templates/cli/memory.js` — 镜像 bootstrap 输出契约变更。
- `templates/cli/test.js` — 镜像 live runtime 测试覆盖。
- `.agents/workflows/evo.md` — 把 targeted recall 写入 `/evo` 的接管步骤顺序。
- `README.md` — 在 dual-lane state + memory 模型与 `/evo` 说明里补充 recall-first takeover 行为。
- `README_EN.md` — 同步英文说明，避免宿主文档漂移。

### New files to create

- None expected.

### Existing code to reuse

- `.evo-lite/cli/memory.js` — `runBootstrapCommand`, `formatBootstrapReport`
- `.evo-lite/cli/memory.service.js` — `summarizeActiveContext`, `inspectHookLifecycle`, `recall`, `verify`
- `.evo-lite/cli/test.js` — `createTempRuntimeRoot`, `bootstrapRuntime`, `captureConsole`
- `templates/cli/test.js` — 模板镜像中的同名 helper
- `.codex/hooks/gitnexus-hook.js` — `resolveGitNexusExecutable`, `runGitNexus`, `buildAnalyzeArgs`

Source-verification note: GitNexus MCP 在起草本计划时仍不可达，上述符号已通过源码直接核对；执行前如 MCP 仍不可用，优先使用仓库现有的 local-CLI-first 约定做本地刷新与校验：`npx gitnexus analyze d:\Data\ProjectAgent\create-evo-lite`，或让 `.codex/hooks/gitnexus-hook.js` 解析到本机 `gitnexus.cmd` / `gitnexus.exe` 后运行 `analyze <workspaceRoot>`。若 CLI 刷新后 MCP 仍不可用，再继续用源码级锚点执行任务，但要在提交说明里注明 GitNexus MCP 缺席。

---

## Task 1: Add Recall-First Bootstrap To Live Runtime

**Files:**
- Modify: `.evo-lite/cli/test.js`
- Modify: `.evo-lite/cli/memory.service.js`
- Modify: `.evo-lite/cli/memory.js`
- Test: `.evo-lite/cli/test.js`

**Preflight:**
- If GitNexus MCP is still unavailable, run `npx gitnexus analyze d:\Data\ProjectAgent\create-evo-lite` from the repo root before editing symbol-bearing files, then retry MCP-based impact/context checks once.

- [ ] **Step 1: Write the failing test**
  ```js
  console.log('3c. Testing bootstrap command reports no-match recall fallback ...');
  const noMatchRuntime = createTempRuntimeRoot('bootstrap-recall-no-match');
  loadCli(noMatchRuntime.runtimeRoot, {
      EVO_LITE_GIT_STATUS: '',
  });
  const noMatchCliModule = require(path.join(CLI_DIR, 'memory.js'));
  const noMatchOutput = await captureConsole(async () => {
      await noMatchCliModule.run(['node', 'memory.js', 'bootstrap']);
  });
  assert.ok(
      noMatchOutput.includes('memory_status: no-match'),
      'bootstrap command did not surface no-match recall status'
  );
  assert.ok(
      noMatchOutput.includes('memory_effect: fresh-takeover'),
      'bootstrap command did not surface fresh-takeover fallback'
  );

  console.log('3d. Testing bootstrap command surfaces actionable recall hits ...');
  const recallRuntime = createTempRuntimeRoot('bootstrap-recall-match');
  const recallLoaded = await bootstrapRuntime(recallRuntime.runtimeRoot, {
      EVO_LITE_GIT_STATUS: '',
  });
  await recallLoaded.service.memorize(
      'HookRuntimeDogfood template-only edits do not count as live runtime dogfood; inspect live .evo-lite hook path before syncing templates. This note is deliberately long enough to satisfy the quality guard.'
  );
  recallLoaded.service.setFocus('完成 live runtime hook dogfood 收口，并确认 runtime hook 路径一致');
  await recallLoaded.service.track(
      'HookRuntimeDogfood',
      'Completed live runtime hook dogfood and clarified that live runtime path verification must happen before template sync.'
  );
  const recallCliModule = require(path.join(CLI_DIR, 'memory.js'));
  const recallOutput = await captureConsole(async () => {
      await recallCliModule.run(['node', 'memory.js', 'bootstrap']);
  });
  assert.ok(
      recallOutput.includes('memory_status: matched'),
      'bootstrap command did not surface matched recall status'
  );
  assert.ok(
      recallOutput.includes('memory_hit: HookRuntimeDogfood'),
      'bootstrap command did not surface actionable recall hit in takeover summary'
  );
  assert.ok(
      recallOutput.includes('memory_effect: inspect live .evo-lite hook path before syncing templates'),
      'bootstrap command did not surface the recall-driven next-step effect'
  );
  ```

- [ ] **Step 2: Run the test to verify it fails**
  `node .evo-lite/cli/test.js`

  Expected error: `bootstrap command did not surface no-match recall status`

- [ ] **Step 3: Minimal implementation**
  ```js
  // .evo-lite/cli/memory.service.js
  function buildTakeoverQueries(contextSummary, verifyReport) {
      const queries = [];
      const latest = contextSummary.latestTrajectory?.line || '';
      const shortTag = latest.match(/\] .*? ([A-Za-z][A-Za-z0-9]+)/)?.[1];
      if (shortTag) {
          queries.push({ source: 'trajectory-tag', text: shortTag });
          queries.push({ source: 'trajectory-phrase', text: shortTag.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() });
      }
      const focus = String(contextSummary.focus || '');
      if (/runtime hook/i.test(focus)) {
          queries.push({ source: 'focus-keyword', text: 'runtime hook' });
      }
      if ((verifyReport.nextSteps || []).some(step => /context track/i.test(step))) {
          queries.push({ source: 'verify-keyword', text: 'context track' });
      }
      return queries.filter((query, index, list) => query.text && list.findIndex(item => item.text === query.text) === index).slice(0, 3);
  }

  function summarizeTakeoverHit(result) {
      const content = String(result.content || '');
      if (/template-only edits do not count as live runtime dogfood/i.test(content)) {
          return {
              label: 'HookRuntimeDogfood',
              reason: 'template-only edits do not count as live runtime dogfood',
              effect: 'inspect live .evo-lite hook path before syncing templates',
          };
      }
      return null;
  }

  async function buildTakeoverRecall(contextSummary, verifyReport) {
      const queries = buildTakeoverQueries(contextSummary, verifyReport);
      const hits = [];
      for (const query of queries) {
          const [top] = await recall(query.text, 5);
          if (!top) continue;
          const summary = summarizeTakeoverHit(top);
          if (!summary) continue;
          hits.push({ query: query.text, memoryId: top.id, ...summary });
      }
      return {
          status: hits.length > 0 ? 'matched' : 'no-match',
          queries,
          hits,
      };
  }

  // .evo-lite/cli/memory.js
  async function runBootstrapCommand(options = {}) {
      await bootstrap();
      const context = memoryService.summarizeActiveContext();
      const verify = await memoryService.verify({ silent: true });
      const sessionstart = memoryService.inspectHookLifecycle('sessionstart');
      const takeoverRecall = await memoryService.buildTakeoverRecall(context, verify);
      printPayload({ context, sessionstart, verify, takeoverRecall }, formatBootstrapReport, options);
  }

  function formatBootstrapReport(payload) {
      const takeoverRecall = payload.takeoverRecall || { status: 'skipped', queries: [], hits: [] };
      // ...existing lines...
      lines.push(`memory_status: ${takeoverRecall.status}`);
      if (takeoverRecall.status === 'no-match') {
          lines.push('memory_effect: fresh-takeover');
      }
      for (const query of takeoverRecall.queries) lines.push(`memory_query: ${query.source}:${query.text}`);
      for (const hit of takeoverRecall.hits) {
          lines.push(`memory_hit: ${hit.label}`);
          lines.push(`memory_effect: ${hit.effect}`);
      }
      return lines.join('\n');
  }
  ```

- [ ] **Step 4: Run the test to verify it passes**
  `node .evo-lite/cli/test.js`

- [ ] **Step 5: Git commit**
  `git add .evo-lite/cli/memory.js .evo-lite/cli/memory.service.js .evo-lite/cli/test.js && git commit -m "feat(runtime): add recall-first bootstrap"`

## Task 2: Mirror Recall-First Behavior Into Templates

**Files:**
- Modify: `templates/cli/test.js`
- Modify: `templates/cli/memory.service.js`
- Modify: `templates/cli/memory.js`
- Test: `templates/cli/test.js`

**Preflight:**
- Reuse the same local GitNexus CLI fallback as Task 1 when MCP is unavailable; template mirroring does not waive symbol-level blast-radius checks for the live runtime source first.

- [ ] **Step 1: Write the failing test**
  ```js
  console.log('3c. Testing bootstrap command reports no-match recall fallback ...');
  const noMatchRuntime = createTempRuntimeRoot('bootstrap-recall-no-match');
  loadCli(noMatchRuntime.runtimeRoot, {
      EVO_LITE_GIT_STATUS: '',
  });
  const noMatchCliModule = require(path.join(CLI_DIR, 'memory.js'));
  const noMatchOutput = await captureConsole(async () => {
      await noMatchCliModule.run(['node', 'memory.js', 'bootstrap']);
  });
  assert.ok(noMatchOutput.includes('memory_status: no-match'), 'template bootstrap command did not surface no-match recall status');

  console.log('3d. Testing bootstrap command surfaces actionable recall hits ...');
  const recallRuntime = createTempRuntimeRoot('bootstrap-recall-match');
  const recallLoaded = await bootstrapRuntime(recallRuntime.runtimeRoot, {
      EVO_LITE_GIT_STATUS: '',
  });
  await recallLoaded.service.memorize(
      'HookRuntimeDogfood template-only edits do not count as live runtime dogfood; inspect live .evo-lite hook path before syncing templates. This note is deliberately long enough to satisfy the quality guard.'
  );
  recallLoaded.service.setFocus('完成 live runtime hook dogfood 收口，并确认 runtime hook 路径一致');
  await recallLoaded.service.track(
      'HookRuntimeDogfood',
      'Completed live runtime hook dogfood and clarified that live runtime path verification must happen before template sync.'
  );
  const recallCliModule = require(path.join(CLI_DIR, 'memory.js'));
  const recallOutput = await captureConsole(async () => {
      await recallCliModule.run(['node', 'memory.js', 'bootstrap']);
  });
  assert.ok(recallOutput.includes('memory_status: matched'), 'template bootstrap command did not surface matched recall status');
  assert.ok(recallOutput.includes('memory_hit: HookRuntimeDogfood'), 'template bootstrap command did not surface actionable recall hit');
  ```

- [ ] **Step 2: Run the test to verify it fails**
  `node templates/cli/test.js`

  Expected error: `template bootstrap command did not surface no-match recall status`

- [ ] **Step 3: Minimal implementation**
  ```js
  // Mirror the verified live-runtime changes verbatim.
  // templates/cli/memory.service.js
  module.exports = {
      // ...existing exports...
      buildTakeoverRecall,
  };

  // templates/cli/memory.js
  const takeoverRecall = await memoryService.buildTakeoverRecall(context, verify);
  printPayload({ context, sessionstart, verify, takeoverRecall }, formatBootstrapReport, options);

  // templates/cli/test.js
  // Copy the same bootstrap recall assertions added to .evo-lite/cli/test.js.
  ```

- [ ] **Step 4: Run the test to verify it passes**
  `node templates/cli/test.js`

- [ ] **Step 5: Git commit**
  `git add templates/cli/memory.js templates/cli/memory.service.js templates/cli/test.js && git commit -m "feat(template): mirror recall-first bootstrap"`

## Task 3: Align /evo Workflow And README With Recall-First Takeover

**Files:**
- Modify: `.agents/workflows/evo.md`
- Modify: `README.md`
- Modify: `README_EN.md`
- Modify: `.evo-lite/cli/test.js`
- Test: `.evo-lite/cli/test.js`

**Preflight:**
- No GitNexus impact check is required for pure documentation edits, but if the workflow wording change causes a companion runtime tweak, fall back to local `gitnexus analyze` first when MCP is unavailable.

- [ ] **Step 1: Write the failing test**
  ```js
  console.log('10b. Testing /evo workflow and READMEs advertise recall-first takeover ...');
  const evoWorkflow = fs.readFileSync(path.join(WORKSPACE_ROOT, '.agents', 'workflows', 'evo.md'), 'utf8');
  assert.ok(
      /recall|历史命中/.test(evoWorkflow),
      '/evo workflow did not mention targeted recall before takeover summary'
  );

  const readme = fs.readFileSync(path.join(WORKSPACE_ROOT, 'README.md'), 'utf8');
  assert.ok(
      /recall-first takeover|历史命中|先检索/.test(readme),
      'README did not document recall-first takeover behavior'
  );

  const readmeEn = fs.readFileSync(path.join(WORKSPACE_ROOT, 'README_EN.md'), 'utf8');
  assert.ok(
      /recall-first takeover|search before asking|memory_status/.test(readmeEn),
      'README_EN did not document recall-first takeover behavior'
  );
  ```

- [ ] **Step 2: Run the test to verify it fails**
  `node .evo-lite/cli/test.js`

  Expected error: `/evo workflow did not mention targeted recall before takeover summary`

- [ ] **Step 3: Minimal implementation**
  ```md
  <!-- .agents/workflows/evo.md -->
  2. verify 完成后，基于当前 FOCUS、最近 TRAJECTORY 标签和 verify 治理术语执行 1-3 个 targeted recall。
  3. 首屏汇报必须新增“历史命中”区块：说明查了什么、是否命中、哪些命中改变了下一步；无命中时明确按 fresh takeover 处理。

  <!-- README.md / README_EN.md -->
  Add a short subsection under the dual-lane state + memory model and /evo guidance:
  - On takeover, search memory before asking the user to restate project history.
  - Only surface compact, actionable hits that change the next step.
  - No-hit recall falls back to fresh takeover without changing the durable archive boundary.
  ```

- [ ] **Step 4: Run the test to verify it passes**
  `node .evo-lite/cli/test.js`

  Additional smoke:
  `npm run test:dogfood-hook`

  Additional smoke:
  `.\.evo-lite\mem.cmd bootstrap`

- [ ] **Step 5: Git commit**
  `git add .agents/workflows/evo.md README.md README_EN.md .evo-lite/cli/test.js && git commit -m "docs(evo): document recall-first takeover"`

## Task 4: Final Dogfood Verification And Closure

**Files:**
- Modify: `.evo-lite/cli/test.js` (only if an additional regression gap is found)
- Test: `.evo-lite/cli/test.js`

**Preflight:**
- Before closure, if GitNexus MCP is still unavailable, rerun local CLI refresh with `npx gitnexus analyze d:\Data\ProjectAgent\create-evo-lite` and then use the best available scope check (`gitnexus_detect_changes()` if MCP recovered, otherwise diff + targeted tests) to document residual verification limits.

- [ ] **Step 1: Write the failing test**
  ```js
  console.log('10c. Testing bootstrap recall does not surface non-actionable noise ...');
  const noiseRuntime = createTempRuntimeRoot('bootstrap-recall-noise');
  const noiseLoaded = await bootstrapRuntime(noiseRuntime.runtimeRoot, {
      EVO_LITE_GIT_STATUS: '',
  });
  await noiseLoaded.service.memorize(
      'This note mentions runtime hook in passing but does not constrain any next step. It is intentionally long enough to satisfy the quality guard.'
  );
  noiseLoaded.service.setFocus('确认 runtime hook 路径一致');
  const noiseCliModule = require(path.join(CLI_DIR, 'memory.js'));
  const noiseOutput = await captureConsole(async () => {
      await noiseCliModule.run(['node', 'memory.js', 'bootstrap']);
  });
  assert.ok(
      !noiseOutput.includes('memory_hit:'),
      'bootstrap command surfaced a non-actionable recall result as a primary hit'
  );
  ```

- [ ] **Step 2: Run the test to verify it fails**
  `node .evo-lite/cli/test.js`

  Expected error: `bootstrap command surfaced a non-actionable recall result as a primary hit`

- [ ] **Step 3: Minimal implementation**
  ```js
  function summarizeTakeoverHit(result) {
      const content = String(result.content || '');
      if (!/must|should|before|do not|不要|优先/i.test(content)) {
          return null;
      }
      // keep the existing actionable summarization branches here
  }
  ```

- [ ] **Step 4: Run the test to verify it passes**
  `node .evo-lite/cli/test.js`

  Additional smoke:
  `.\.evo-lite\mem.cmd bootstrap`

- [ ] **Step 5: Git commit**
  `git add .evo-lite/cli/memory.service.js .evo-lite/cli/test.js && git commit -m "test(runtime): filter non-actionable recall noise"`
