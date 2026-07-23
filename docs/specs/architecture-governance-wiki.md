---
id: spec:architecture-governance-wiki
title: "Spec: Architecture-Governance Wiki (4b-1)"
status: done
linkedPlan: plan:architecture-governance-wiki-mvp
---

# Spec: Architecture-Governance Wiki(4b-1)

- 谱系:`spawned-from: spec:unified-code-explore-wiki-projection`
- 替代:原 `plan:code-wiki-inspector-projection` 中的 cw-wiki 范围(superseded — do not execute);**不激活** Inspector Code page(cw-inspector / cw-closure 照旧 parked)
- 激活依据:dogfood Sessions 10-11(主用户 strike 2/2;`mem inspect` 实测无法替代)
- **契约正文(canonical):**`docs/superpowers/specs/2026-07-22-architecture-governance-wiki-design.md`(2026-07-22 外部复审 APPROVED)。本文件是治理挂接层,不复制契约细节;两者分歧时以设计文档为准。
- 实施计划:`plan:architecture-governance-wiki-mvp`(`docs/superpowers/plans/2026-07-23-architecture-governance-wiki.md`)

## 一句话定位

`mem wiki build [--open]`:Google Code Wiki 的呈现形态 × Evo-Lite 的治理数据 —— 架构图为骨、模块进展为肉的纯静态离线中文 wiki,按需重生成,输出 `.evo-lite/generated/wiki/`。

## Acceptance Criteria

与设计 §7 十三项测试一一对应:

- 确定性:相同输入快照 + 相同 headSha + 相同注入时钟 → 两次生成 byte-identical;删目录重建一致。
- 纯派生:输出目录整体可删除重建,无 canonical 人工内容。
- 无边诚实:`edges` 缺失/空 → 无 dependency-edge、无 marker-end、无 synthetic edge;manifest `knownEdgeCount: 0`。
- 源码页:稳定行号锚点;内容/标题/描述/commit message 全量 HTML escape。
- 路径安全:`..`、绝对路径、符号链接越界被拒绝。
- role 开放枚举:`feature` 与未知 role 不丢模块,未知入"其他"泳道 + manifest warning。
- 无 task 模块显示"尚未纳入规划"。
- 健康隔离:不可归属 finding 只进 ProjectHealth,不扩散到模块。
- 词典:生成器自写中文叙事无裸 Rxxx;未知规则呈现"发现一项尚未分类的治理检查"。
- 分组:evo-wiki-groups@1 校验矩阵(重复 id / 未知 id 报告具体 id / 未知 version / 类型错误 → exit 2);无配置零依赖可用。
- 页面映射 Windows 合法;hash 冲突确定性扩展、绝不覆盖。
- freshness 三态:仅 generatedAt 的 IR → unknown;呈现"数据新鲜度无法确认"。
- 边契约:合法 `ArchitectureModuleEdge` 绘制;malformed 拒绝 + warning。

收口条件:13 项测试全绿 + 双侧 all 套件全绿 + 镜像 double-run-zero + **主用户实测 index.html 确认 Q5 诉求被满足**(最终验收人)。

**收口记录(2026-07-23):**W1-W7 实施于 `111674c..c6235fc`(SDD,逐任务独立复审 + opus 终局全分支复审 Ready-to-merge);双侧 `test.js all` EXIT 0;镜像 copied:0(113 unchanged);母仓实景 102 页 / modulePages === modules (12)。**主用户 Q5 验收:PASS**(架构图入口 / 点击模块看进展 / 中文人话 / 图文并茂 MVP 四项均满足)。非阻断 UX debt:SVG 宽度随泳道数固定扩展,未做响应式缩放/横向滚动容器 —— 模块数显著增长时再做缩放/折叠/minimap。Inspector(cw-inspector/cw-closure)保持 parked。

## Phases

- Phase W(唯一):W1 page-map → W2 groups → W3 projection → W4 dictionary → W5 render → W6 source-pages → W7 build/cli/注册/镜像闭环。
