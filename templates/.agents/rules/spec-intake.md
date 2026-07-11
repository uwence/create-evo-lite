# Spec Intake 闸门

evo-lite 治理域 (`spec-portfolio`) 只扫描**已收编**的 spec。draft 与已收编 spec 走不同规则，混淆是跑偏、被遗忘的根因。

## Draft 阶段自由

agent 与人讨论产出的 spec 草稿，位置、命名、frontmatter 格式不限，放哪都行——治理域不扫描未收编的 draft。

## 入册必须走闸门

讨论结束、草稿定稿时，必须调用 `mem spec adopt <file>` 收编。adopt 会：

- 校验/修复 frontmatter
- 归一化到 `docs/specs/<kebab>.md`（去空格）
- 跑体量启发式（AC>8 / Phase>3 / dependsOn>12 / 40k 字符超标即 WARN 建议拆分）
- 在有在途 spec 时要求声明关系（`--relation <kind>:<specId>` 或 `--independent`）

## 禁止绕过

不得手写文件直接落进 `docs/specs/` 绕开 adopt 闸门——那样会跳过体量检查与关系声明，正是 spec 跑偏、被遗忘的根因。

## 收编后的生命周期

adopted spec 由 `mem verify` 的 `📋 [Spec Portfolio]` 段持续报账；老化（超 agingDays 无活动）或超标会常驻 ⚠️，直到 `mem spec park|reactivate` 表态（`park` 支持 `--until`）。park 一个仍有活跃 plan 的 spec 会让该 plan 持续产生 `zombie-plan` WARN（不静默继续；Phase 1 只报警，真正的 plan 冻结属 Phase 2）。查任意 spec 当前状态用 `mem spec status`，均支持 `--json`。

有本指南没覆盖的收编摩擦？按 [hive-feedback.md](hive-feedback.md) 协议写进 `.evo-lite/hive/feedback.md` 上报母巢。
