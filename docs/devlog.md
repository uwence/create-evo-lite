# Devlog

开发过程记录，3.x 真正的 memory。**最新在上。** 每条 5–10 行，四段：Changed / Why / Learned / Next。

一条 devlog 的作用是让下一个 agent 不必重读 diff 就知道上一轮为什么这么改。写「为什么」比写「改了什么」重要——改了什么 git 已经知道了。

---

## 2026-09-23 · 全链路证据收齐

Changed
- 从 `origin/3.x` 真实 clone 后跑通 `npm install` → `npm test` → `init` → `status` → `spec` → `render`，据此勾上 3.1 的 15 条验收。

Why
- 证据要来自 fresh clone，不是开发工作树。工作树里能跑通，不等于别人 clone 下来能跑通——2.x 就是在这一点上失败的。

Learned
- `npm install` 0.8s、`audited 1 package`、`node_modules` 为空、树内无 `.node` 与 `binding.gyp`：零原生编译不是声明，是可复现的观察。
- `npm pack` 产出 14 个文件 / 13.3 kB。对照 2.x：治理层单个测试文件就有 23,111 行。
- 空目录 `init` 后 `status` 报 `Project target`——退回目录名这条分支在真实环境里走到了，不只在测试里。

Next
- 唯一未勾的是 Windows smoke test，无环境，按 Assumption 保持未勾；3.0 的聚合验收因此也保持未勾。

---

## 2026-09-23 · minimal CLI 实现

Changed
- 实现 `init` / `status` / `spec` / `render`：`bin/cli.js` + `src/` 六个模块，production JS 642 / 800 行，`require` 只有 fs / path / child_process / crypto 等 Node 内建。
- `package.json` 首次建立（3.0.0-beta.1，无 `dependencies`）；`templates/` 五个纯文本 seed；`test.js` 179 / 200 行，13 项全绿。
- `scripts/project-render.js` 已删除，其逻辑迁入 `src/render.js` 与 `src/markdown.js`——不留两套 renderer 实现。

Why
- `status` 与 `render` 各有自己的扫描器：`src/structure.js` 只认 heading / 围栏 / 表格分隔行 / 行长，`src/markdown.js` 只服务 presentation，两者无依赖关系。约束的是信息流，不是模块布局。

Learned
- prose 负控真的抓得住东西：把 Now 换成「宇宙飞船今天吃香蕉」而保持结构与行数，`status` 输出必须逐字节不变，这条比检查 import 更难糊弄。
- 长行维度的夹具直接用 1835 字符——2.x FOCUS 的真实长度。只数行的实现会把它报成 `Now 1/5 OK`，测试会立刻失败。

Next
- 第 7 步 fresh clone 全链路验证。Windows AC 无环境，按 Assumption 保持未勾。

---

## 2026-09-22 · 补上 test 的 AC 所有者

Changed
- 3.1 新增一条验收：`npm test` 调用仓库唯一的 `test.js`，覆盖行为测试并以 exit 0 通过。15 条 → 16 条。

Why
- `test 全绿` 写在 Goal、`test.js <= 200` 写在 Design 预算，但没有任何 checkbox 拥有「测试存在并通过」这个 outcome。实现者可以一行测试不写，其余 15 条全过，3.1 看起来就能 CLOSED。

Learned
- outcome 出现在 Goal 里不等于有人拥有它。AC 所有权规则要反过来用一次：每个 Goal 里的动词，都该能指到一个 checkbox。
- `test.js <= 200` 继续留在 Design：预算超了问「为什么膨胀」，验收没过才是「不合格」，同一个数字不能两者都是。

Next
- 最终授权检查。实现仍未授权。

---

## 2026-09-21 · 3.1 consistency patch

Changed
- `render` 与「不修改任何已存在文件」的冲突收窄：`init` 不改已存在文件；`render` 只许创建或替换它唯一的生成物 `docs/project.html`，不得动任何 canonical source。
- `Initialized` 正式纳入 §2 的钉死字段表，不再是没有数据源所有权的额外分支；无 `PROJECT.md` 时 `Caps` 为 N/A。
- 3.0 §2 的上限标注改为纯数字，并声明机械计数规则由 3.1 §4 拥有；`render` 主题化与 eviction 两条已被 3.1 裁定，从 Open Questions 移除。
- PROJECT.md 的「主题化未定」改为「3.1 首版固定内联模板，不在当前 scope」。

Why
- 按原文字面，`render` 第一次能成功、第二次就违反 spec——这种冲突会逼实现者替我们做产品决定。
- `active rows` 会让实现者问「什么算 active」，lifecycle 就从计数规则里重新长回来。这是 2.x 自锁链最便宜的一个入口。
- 一边 Non-goal 一边「未定」，第三个 fresh agent 收到的就是互相矛盾的导航。

Learned
- 删掉一个词（active）比删掉一个模块便宜得多，但两者挡住的是同一种东西。
- 我上一轮把 AC 数报成 14，实际是 15。汇报数字前应该数，不该凭印象。

Next
- 最终授权检查。实现仍未授权。

---

## 2026-09-21 · 3.1 spec 修订

Changed
- caps 增加第二个维度：非表格、非代码的正文物理行 <= 240 字符，超限同样只展示、exit 0。
- 用行为负控替换「`status` 不得 import renderer parser」：同一目录下两份结构与行数相同、正文文字完全不同的 `PROJECT.md`，`status` 输出必须逐字节相同。
- `production JS <= 800 / test.js <= 200` 从 AC 移回 Design 预算；删除 `status` 的 `Latest` 字段；关闭三个 Open Questions（slug 不带日期、无 PROJECT.md 时打印 `Initialized no` 并 exit 0、主题化列为 Non-goal）。
- 修正 §2 的自相矛盾措辞，并把 PROJECT.md 的 Handoff 导航改为「先 3.0 后 3.1」。

Why
- 只有行数维度防不住最初的病灶：2.x 的 FOCUS 是 1835 字符的一整段，在行数维度上是 `1/5`，读作 OK。这正是 `d3752b9` 修过的那种「扫描说没问题，其实没看」的形状，而我在自己的 spec 里又造了一个。
- 「不读取任何段落正文」与 caps 要数正文行直接冲突；边界应是「可以读字节，不得解释语义」。
- 检查 import 绑定的是文件布局，要保护的却是信息流。共享 section scanner 无害，共享「这句话意味着 blocked」才有害。

Learned
- 一条 AC 如果约束的是实现结构而不是可观察行为，它既容易被绕开，也容易在无害的实现上误报。
- 预算与验收门是两种东西：预算超了该问「为什么膨胀」，验收门没过才是「不合格」。同一个数字不能两者都是。

Next
- 审这一版是否可以授权实现。PROJECT.md 实测两个维度均通过（最长正文行 118 字符）。

---

## 2026-09-21 · 3.1 spec 定稿

Changed
- 新增 `docs/specs/3.1-minimal-cli.md`（108 行），拥有 CLI 的全部实现验收。
- 3.0 的 npm install / init / status·render / render 单向 / Windows 五条验收迁入 3.1，3.0 换成一条聚合；`render` 那条**取消旧勾**——它验的是脚本，不能充当 CLI 实现的证据。
- 删除「上述第 5–8 条」这类位置引用；PROJECT.md 八个段的上限标注统一为 `(<= N)`。

Why
- 父 spec 只拥有 outcome，子 spec 只拥有 implementation acceptance，同一个事实只能有一个 checkbox。
- 位置引用本身就是双真相源的变种：事实在别处，这里只留一个会漂移的指针。迁走四条后编号必然错位。

Learned
- caps 单一计数规则实测与人工核算对上七段，只有 Commands 差 2 行——是先前人工核算把代码围栏行数了进去，规则本身没错。
- 「`status` 不得 import renderer 的 parser」这种 30 秒可检查的形状，比「不要把 Markdown 编译成状态机」这句原则更能挡住复发。原则负责解释，形状负责拦截。

Next
- 审 3.1。实现仍未授权。

---

## 2026-09-21 · Step 5 CLOSED

Changed
- Dogfood #2 判定 PASS，Step 5 收口：spec 的 dogfood 验收勾上，Milestone 5 改为完成，`Now` 更新为下一设计工作。

Why
- 一个未参与开发的 agent 仅凭树内三个核心对象，独立恢复了产品定位 / 当前阶段 / 设计理由 / 下一步 / 明确不该做什么，并把缺席的 `package.json` 正确读成设计边界而非缺陷。
- Dogfood #1 → INVALID（test setup self-reference）；Dogfood #2 → PASS。不跑第三次——继续设计更复杂的 blind-test protocol 就开始接近旧路线了。

Learned
- 被测 agent 认出自己在被测不构成污染：continuity 文档本来就该包含项目历史与迁移步骤，要避免的是答案由测试现场直接喂给它。
- 它拒绝给自己的测试打勾（「该由提出测试的人勾」），说明语义边界是从文档里读出来的，不是被提示的。

Next
- 下一阶段第一笔内容之前先定 **AC 所有权规则**：父 spec 只拥有 outcome，子 spec 只拥有 implementation acceptance，同一个事实只能有一个 checkbox。因此 3.0 现有的 CLI / npm / Windows 验收应迁入 3.1，3.0 只保留一条聚合结果，不得两边各留一个 `- [ ] Windows works`——那就是新的双镜像。
- `v2.4-governance-freeze` 仍只存在于本地，远端无该 ref。它不阻塞 Step 5，但 3.0 reset 最终完成前必须成为远端 durable ref。

---

## 2026-09-21 · 测试卫生修复

Changed
- spec 12 条验收勾上 5 条有证据的；freeze tag 一条保持未勾——远端至今没有该 ref，本地有不算 durable freeze。
- `Now` 改写为正常项目状态；两条此前只存在于对话里的边界落盘为 Decision（renderer 只读展示、3.x 故意不是 npm package）。
- `branchLabel()` 补 `stdio: ['ignore','pipe','ignore']`；`docs/project.html` 停止跟踪，改为需要时重新生成。

Why
- Dogfood #1: INVALID due to self-referential test setup. Content reconstruction was correct and exposed four documentation/runtime defects. No pass/fail credit assigned.
- 产品没有失败，是测试设计失败：`Now` 当时写着「本次审阅就是第 5 步」，把「当前焦点 / 下一步」两个答案退化成复述测试本身。

Learned
- 边界只写在对话里等于没写。`SPEC_LINE_CAP` 和缺席的 `package.json` 都被外部复核当成疑点，因为树里读不到理由。
- 注释宣称的行为必须可实测：`degrades silently` 在无 `.git` 时实际会打印 `fatal: not a git repository`。
- 生成物入库就是 mirror-sync tax 的起点，2.x 已经为此付过一次学费。

Next
- 第 6 步仍未授权；在它正式关闭前不写 CLI 实现，只可能先写 spec。

---

## 2026-09-21 · 3.x skeleton

Changed
- 冻结 2.x：annotated tag `v2.4-governance-freeze` + branch `maintenance/2.x`，均指向 `5c091b9`。
- 从该冻结点建 `3.x` 干净分支，删除 764 个文件 / 232,764 行，树内不再有 `.evo-lite/`、`templates/cli/`、`.agents/`。
- 落地三个核心对象与 renderer：`PROJECT.md`、`docs/specs/`、`docs/devlog.md`、`scripts/project-render.js`。

Why
- 2.x 治理层约 115,000 行 JS 对应 720 行产品代码，且三条活跃 backlog 全部自锁在「权威尚未实例化」上。
- 新 clone 里 `better-sqlite3` 缺席即整条接管链失败——为跨 agent 接手而建的装置，在新 agent 真正接手时第一个动作是抛错。

Learned
- git 层归档不等于 AI 上下文层精简：`legacy/` 留在主线树内，AI 仍会搜到并决定复用旧实现。
- 迁移顺序本身是设计：`package.json` 的 `test` / `prepublishOnly` 仍指向 `.evo-lite/cli`，提前单点拆 hook 会开出发布链半断的窗口。

Next
- 第 5 步 fresh-agent dogfood。第 6 步 CLI 未授权，dogfood 通过也不自动开始。
- Owner 待执行：补推 freeze tag（本会话凭据对 `refs/tags/*` 返回 403）。
