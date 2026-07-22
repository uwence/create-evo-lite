# Architecture-Governance Wiki(4b-1)设计

- 日期:2026-07-22
- 规划治理 id:`spec:architecture-governance-wiki`(正式 spec 由 plan 阶段随 intake 建立)
- 谱系:`spawned-from: spec:unified-code-explore-wiki-projection`
- 依据:dogfood Sessions 10-12(strike 2/2 激活)、`docs/validation/code-wiki-gap-analysis.md`、2026-07-22 外部复审 `APPROVED WITH REQUIRED EDITS`

## 0. 替代关系(供治理机与后续 Agent 消费)

```text
supersedes:
  - 原 plan:code-wiki-inspector-projection 中的 cw-wiki 范围(do not execute)
does-not-activate:
  - Inspector Code page(cw-inspector / cw-closure 照旧 parked)

命名替代(新旧契约不得同时有效):
  旧:mem code wiki build            → 新:mem wiki build [--open]
  旧:.evo-lite/generated/code-wiki/ → 新:.evo-lite/generated/wiki/
```

范围外(本 spec 明确不做):Agent 补写层(后置)、Inspector、内嵌 chat、依赖箭头的推测绘制。

## 1. 定位与形态

`mem wiki build [--open]`:把 architecture IR + Planning IR + governance links(经 4a `exploreCode`)+ drift/verify 生成**纯静态、离线、中文**的 HTML wiki,输出到 `.evo-lite/generated/wiki/`。

- 纯派生:整目录可删除,以相同输入重建结果一致;不存任何 canonical 人工内容。
- 每页脚注:`生成于 <时间> @ <headSha>`。
- 零新依赖:Node CommonJS 模板字符串 + 内联 CSS/JS;无服务器;Windows-first(`path.join`)。
- 交付路径:`templates/cli/wiki/` 新模块 + `memory.js` 注册 `wiki` 命令组 + template-manifest 登记 + runtime mirror 同步(子项目经 nurture 获得)。
- 用户已裁定:正文中文(代码标识符保持原文)/ 点击落本地源码页 / 模块自动为主+可手调 / MVP 纯确定性叙事。

### 1.1 manifest.json(非页面产物)

每次 build 写 `.evo-lite/generated/wiki/manifest.json`:

```json
{
  "version": "evo-architecture-wiki@1",
  "generatedAt": "<注入时钟的 ISO 时间>",
  "headSha": "<git HEAD>",
  "architectureIrGeneratedAt": "<输入 IR 的 generatedAt>",
  "planningIrGeneratedAt": "<输入 IR 的 generatedAt>",
  "inputFreshness": {
    "architecture": { "state": "unknown", "reason": "IR has no comparable source snapshot" },
    "planning": { "state": "unknown", "reason": "IR has no comparable source snapshot" }
  },
  "knownEdgeCount": 0,
  "pages": ["index.html", "module/<mapped>.html", "source/<mapped>.html"],
  "modulePages": { "module:planning": "module/module-planning--a1b2c3d4.html" },
  "warnings": []
}
```

测试、未来 `mem wiki status`、输入陈旧提示都以此为落点。

**inputFreshness 使用 4a canonical 三态**(`"fresh" | "stale" | "unknown"`,与 normalize/router/cache 共用同一契约,不得各自发明解释)。确定性规则:

```text
producer 提供可比较 snapshot,且等于当前 snapshot → fresh
producer 提供可比较 snapshot,且明确不等         → stale
无法可靠判断                                    → unknown
```

现有 Architecture/Planning IR 只有 `generatedAt`、无可比较 snapshot → **必须为 unknown**。禁止用以下方式推断 fresh:`generatedAt` 较新、文件 mtime 早于生成时间、build 无报错、drift 无 warning。ProjectHealth 将 `unknown` 显示为**"数据新鲜度无法确认"**,不得显示为正常。

## 2. 页面结构

```text
index.html            架构图(SVG 模块地图)+ 中文概览 + ProjectHealth + 侧栏导航树
module/<mapped>.html  模块页:中文职责叙事 + 进度 + ModuleHealth + 任务表 + 文件表 + 最近变更
source/<mapped>.html  轻量只读源码页,行号锚点 —— 一切文件点击的落点
manifest.json         构建元数据(§1.1)
```

### 2.0 页面路径映射(module 与 source 共用一套规则)

模块 id 规范为 `module:<slug>`,冒号在 Windows 文件名中非法 → 页面路径经**统一映射函数**生成:

```text
module/<readable-safe-id>--<idHash8>.html     例: module/module-planning--a1b2c3d4.html
source/<readable-safe-path>--<pathHash8>.html
```

- 可读段:字符白名单归一(小写、非法字符折叠为 `-`);hash8 = 规范化原始 id/路径的 sha1 前 8 位。
- 页面正文与治理链仍使用原始 `module:<id>`;所有指向模块/源码页的链接必须经同一映射函数,禁止手拼。
- `manifest.json.modulePages` 记录原始 id → 页面路径的完整映射。
- **冲突规则(module/source 同适用):**生成前在 Windows 大小写折叠后的键空间检测冲突;hash8 冲突时确定性扩展到完整 hash,**绝不覆盖已生成页面**。

### 2.1 架构图(SVG 模块地图)

- 节点 = architecture IR 的 module,按 **role 泳道**布局;卡片显示中文名(别名优先)、进度条、健康色、focus 标记;点击进模块页。
- **role 为开放枚举**。固定泳道顺序:`entry, service, feature, ui, runtime, scanner, governance, docs, test, unknown, <其他未识别 role>`。未识别 role:不丢弃模块、进"其他"泳道、保留原始 role 字样、manifest 记 warning。
- **边:`edges` 缺失或为空 = "没有已知依赖关系"**。不画任何依赖箭头,不得从目录、文件名或 role 猜测依赖;仅当外部 Architecture Provider 返回**符合下述契约**的边时才绘制。manifest 记 `knownEdgeCount`。

**最小可绘制边契约(ArchitectureModuleEdge):**

```ts
interface ArchitectureModuleEdge {
  sourceModuleId: string   // 必须命中当前 architecture IR 的 module id
  targetModuleId: string   // 同上
  kind?: string
  confidence?: number
}
```

```text
仅 schema-valid 的边参与绘制与 knownEdgeCount
重复边按 sourceModuleId + targetModuleId + kind 去重
无效端点或 malformed edge 不绘制,manifest warning
不得把文件边、symbol 边自动提升为模块边
```

### 2.2 展示分组 `wiki-groups.json`(可选)

位置 `.evo-lite/wiki-groups.json`。MVP 仅支持:展示分组、排序、中文别名、泳道名称调整。版本化契约:

```json
{
  "version": "evo-wiki-groups@1",
  "laneLabels": { "service": "核心服务", "governance": "治理能力" },
  "moduleAliases": { "module:memory-service": "记忆服务" },
  "groups": [
    { "id": "group:core", "name": "核心能力", "order": 10,
      "moduleIds": ["module:cli-entry", "module:memory-service"] }
  ]
}
```

确定性规则:

```text
groups 按 order、再按 id 排序;组内顺序即 moduleIds 数组顺序
未进入自定义 group 的模块仍按默认 role 泳道显示
重复 module id → exit 2
未知 module id → exit 2,并报告具体 id
未知 version / 类型错误 → exit 2
别名与泳道名只影响展示,不影响 module identity
```

- **不改变模块身份**:展示上可同组,治理上仍是多个 `module:<id>`,每个模块页独立存在;不引入 GroupProjection。
- 文件不存在 → 按 role 默认分组,零配置可用。

### 2.3 源码页安全与规模契约

- 路径映射唯一化:按 §2.0 统一映射函数(可读段白名单归一 + hash8;大小写折叠冲突检测;hash 冲突确定性扩展,绝不覆盖)。
- 安全:仅接受 repo-relative 规范化路径;拒绝 `..`、绝对路径、符号链接越界(realpath 包含性检查,与 4a 同款 path-containment 语义)。
- 转义:文件内容、任务标题、module description、commit message 一律 HTML escape。
- 每行稳定 `id="L123"` 锚点。
- 二进制文件不渲染;>512 KiB 只生成说明页;被跳过的文件在模块页保留条目并显示"源码页未生成"的原因。
- GitHub permalink(保守策略):仅当 origin 是 GitHub **且**本地 remote-tracking ref 可证明包含 headSha 时显示;**build 全程不访问网络**。

## 3. ModuleProjection(确定性事实模型)

叙事层只解释、不计算。每模块:

```text
{ moduleId, taskCounts, progressState, healthState, focusState,
  changedFiles, recentCommits, provenance }
```

### 3.1 任务归属

```text
declares_file → resolve CodeReference.filePath
             → architectureIR.files[path].module   ← 权威归属
             → ModuleProjection
```

- `module.paths` 只是扫描规则描述,**仅作 fallback**:文件在 IR 中存在但 module 字段缺失时,才按 paths 做一次确定性匹配,并标记 confidence 降级。
- proposed link 不计入进度,单列"待确认关联"。
- 跨模块 task:每个相关模块各计一次,UI 标"共享任务";**首页总进度按 task id 去重**。

### 3.2 进度状态

```text
implemented / verified / done → 完成
todo / active                 → 未完成
未知、缺失或未来新增状态       → 不计为完成;单列"状态未知";manifest warning
```

(将来出现 `cancelled/skipped` 亦不得自动计入完成。)无 task 的模块显示**"尚未纳入规划"**,不是 0/0。

### 3.3 健康状态:项目级与模块级分离

**ProjectHealth(仅首页):** 全局 verify 结果、无法归属到模块的 drift finding、provider freshness、Planning/Architecture IR 陈旧状态。无法归属的 finding **只进入 ProjectHealth,不扩散到任何模块**。

**ModuleHealth(模块页/卡片):** 仅使用能经 `finding.dependsOn/filePath ∩ module files` 可靠归属的 finding:

```text
存在可归属的 error 或 verifier failure → 风险
无 error,warning 去重后 ≥ 3           → 风险
warning 去重后 1–2                     → 注意
无 warning/error                       → 正常
```

- `info` 不参与健康色。
- provider stale 呈现为"数据新鲜度"徽标,不把模块变红(结论可能过期 ≠ 模块故障)。

### 3.4 focus

Wiki **只投影 `exploreCode` 返回的 resolved focus**(4a canonical),不自行解析 active_context、不自行挑选任务。focus unresolved 或 ambiguous 时,页面显示**"当前焦点无法可靠定位"**。

### 3.5 最近变更

最近 10 个 commit 窗口内涉及本模块文件的变更(数据源:post-commit code-perception 的 commit blob + git log,均本地)。

## 4. 叙事与术语词典

- 模板句式生成中文人话;IR 英文 description 作副标题原样展示(转义)。
- 术语词典(固定映射,如 `R008→任务缺少完成证据`、`drift→治理记录与代码的偏差`)。
- **词典覆盖检查范围仅限生成器自写的中文叙事**(健康说明、focus/进度解释、drift/rule 人话翻译);不检查源码页、文件名、symbol 名、task 原始标题、英文 description 副标题、可折叠"技术详情"区。
- 未知规则呈现为"发现一项尚未分类的治理检查";原始 `Rxxx` 只出现在"技术详情"区,不裸露于主叙事。

## 5. CLI 行为与退出码

```text
mem wiki build [--open]

生成成功、浏览器打开失败 → build 仍成功,exit 0,输出 index.html 绝对路径 + warning
生成失败                 → exit 1
参数或 wiki-groups.json 非法 → exit 2
```

打开浏览器用 `spawn/execFile` 参数数组,**不用 `shell:true`**(与 4a 提供方安全不变量同族)。

## 6. 确定性与时钟

```js
buildWiki({ projectRoot, now })   // 生产: now = () => new Date().toISOString();测试注入固定时钟
```

验收措辞:**在相同输入快照、相同 headSha 和相同注入时钟下,两次生成 byte-identical;删除整个输出目录后,以相同输入和时钟重建,结果完全一致。**

## 7. 测试(governance.js 新增 T-wiki 块)

1. 确定性:同输入 + 同注入时钟,两次生成 byte-identical;删目录重建一致(§6 措辞)。
2. 纯派生:输出目录不含任何非生成内容;重建不丢页面。
3. 无边不画箭头:`edges` 缺失或为 0 时 —— 不存在 dependency-edge 元素、不存在 `marker-end` 箭头引用、不存在由模块位置推导的 synthetic edge;manifest `knownEdgeCount: 0`。(不断言"无任何 line/path 元素"——泳道与进度条合法使用它们。)
4. 源码页:行号锚点 `id="L123"` 可定位;`<script>`、`&`、引号被正确转义。
5. 路径安全:`../outside.txt`、绝对路径、符号链接越界被拒绝。
6. 角色开放性:`role: feature` 与未知 role 均不丢模块,未知入"其他"泳道 + manifest warning。
7. 无 task 模块渲染"尚未纳入规划"。
8. 健康隔离:无法归属的 verify failure 只影响 ProjectHealth,不把全部模块标为风险。
9. 词典:生成器自写叙事无裸术语(§4 范围);未知规则以"尚未分类的治理检查"呈现。
10. 分组:重复 module id → exit 2;未知 module id → exit 2 且报告具体 id;未知 version/类型错误 → exit 2;无配置文件 → role 默认分组可用。
11. 路径映射:`module:cli-entry` 生成 Windows 合法文件名;构造 hash8 冲突时确定性扩展、不覆盖页面(module/source 同规则)。
12. 新鲜度:IR 只有 `generatedAt`、无可比较 snapshot 时,freshness 必须为 `unknown`(不得为 fresh/false);ProjectHealth 呈现"数据新鲜度无法确认"。
13. 边契约:合法非零 `ArchitectureModuleEdge` 生成 dependency-edge 元素;无效端点/malformed edge 不绘制且 manifest 产生 warning。

## 8. 守则(红线,继承 4a)

- 不伪造:无边不画、无归属不涂色、focus 不可靠不猜任务。
- 不动 Inspector(parked);不做 chat;Agent 补写层后置且未授权。
- 只改 `templates/cli/**` 后经 sync-runtime 出镜像,不手改 `.evo-lite/cli/**`。
- build 全程离线;生成物整目录可重建。
