---
id: spec:spec-portfolio-governance
status: done
owner: human
created: 2026-07-10
---

# Spec Portfolio Governance

## Goal

给 spec 层补上生命周期台账,解决两个已观测到的治理缺口:

1. **入口没门**: agent 讨论产出的 draft spec 与治理域 canonical spec 之间没有收编边界。draft 格式/位置随意,scanner 不可见,体量检查无从执行(实例: `docs/spec provider-first-code-perception-foundation.md`,文件名带空格、YAML frontmatter 损坏、不在 `docs/specs/`)。
2. **中途没账、出口没债**: 项目执行中因新问题/新想法生成新 spec 时,无需声明与在途 spec 的关系,focus 悄悄转移;被搁置的 spec 不产生任何治理信号,verify 永远绿(实例: CodePLC 子巢 dogfood 期间 pivot 密集,旧 spec 被遗忘)。

核心原则: **plan 层已有完整闭环机器(scan → IR → task → evidence → close),spec 状态尽量从 plan 活性派生,不造第二套人工记账。**

## Non-goals

- 不做自动拆分大 spec —— intake 只 WARN 建议拆,拆分由人 + agent 手动完成
- 不做 LLM 重写/蒸馏层(Karpathy LLM-wiki 思路另立 draft,见 Follow-ups)
- 不改动现有 plan 闭环机器与 READY verdict 自动 close 路径
- 不做在途 spec 硬闸门(阻断 commit)—— 本期只到 B 级强度(持续 WARN 直到表态)
- 不给 plan 单独做遗忘管理 —— plan 被遗忘必然表现为其 spec 老化,一处报账

## Lifecycle Model

### States

| 状态 | 来源 | 说明 |
|------|------|------|
| `draft` | 治理域外 | 未收编,不扫描不管账 |
| `adopted` | `mem spec adopt` | 已收编,尚无 plan |
| `active` | 派生 | 有 plan 且 plan 近期有活性 |
| `shipped` | 派生(已有) | AC 全 READY,现有自动 close 路径不动 |
| `parked` | 人工表态 | 搁置,frontmatter 记录复活条件 |
| `superseded` | 人工表态(Phase 2) | 指向替代 spec |

### 活性派生规则

`lastTouchedAt` = 该 spec 关联 plan 的 task/evidence/commit 最后活动时间,从 git 历史 + Planning IR 计算,零人工维护。

### 不变式

1. **级联**: park/supersede 一个 spec → 其关联 plan 一并冻结,plan 不能在死 spec 底下继续跑。
2. **双向孤儿检测**:
   - `adopted` 且 N 天(默认 14)无 plan → WARN「无计划老化」
   - plan 活跃但 spec 已 parked/superseded → WARN「僵尸 plan」
3. **老化 WARN 持续到表态**: 检出老化 spec 后 WARN 常驻 verify 输出,直到人/agent 显式 reactivate / park / supersede(与 R008 evidence 欠账机制同哲学: 欠账赖着不走才有效)。
4. **人工状态是 truth,registry 是派生**: park/supersede 写入 spec frontmatter;`.evo-lite/generated/spec-registry.json` 可删可重建。

## Intake Gate

### `mem spec adopt <file>`

1. 校验/修复格式: frontmatter YAML 合法、含 `id`/`status`/`created`
2. 归一化位置与命名: 移入 `docs/specs/<kebab-name>.md`,文件名不含空格
3. 体量启发式,超阈值 WARN「建议先拆再收」:
   - AC 数 > 8
   - Phase 数 > 3
   - dependsOn 文件数 > 12
   - 字符数 > 40000
4. 在途关系问询: 存在其他 `adopted`/`active` spec 时,要求声明本 spec 与它们的关系(independent / spawned-from / supersedes / blocks),写入 frontmatter `relations`

体量 WARN 不阻断收编,但记入 registry,verify 持续报账直到 spec 被拆或人工豁免(frontmatter `sizeWaiver: <reason>`)。

### 自动收编触发

新增 `.agents/rules/` 基因: agent 讨论产出 spec 结束时必须调用 `mem spec adopt`,draft 阶段位置格式自由,入册必须走闸门。

## Registry

```text
.evo-lite/generated/spec-registry.json
```

派生数据,内容: 每 spec 的 id、状态、关联 plan、lastTouchedAt、体量指标、relations、老化标记。删除后由 `mem spec status` 重建。

## CLI Contract

```bash
mem spec adopt <file>          # 收编 + 体量检查 + 关系问询
mem spec status [--json]       # 全量 portfolio 报账,重建 registry
mem spec park <id> --until <条件描述>
mem spec reactivate <id>
mem spec supersede <id> --by <new-id>   # Phase 2
```

退出行为沿用现有约定: 参数无效 exit 2,内部异常 exit 1,degraded 报账 exit 0。

## Verify Integration

`mem verify` 追加一段 spec portfolio 报账:

```text
📋 [Spec Portfolio]: adopted=1 active=2 parked=1
⚠️ spec:provider-first-code-perception 已 12 天无活动且不在当前 focus — 请表态: reactivate / park / supersede
⚠️ spec:xxx 体量超标 (AC=12, Phase=5) — 建议拆分或声明 sizeWaiver
```

## Delivery Phases

### Phase 1

- adopt(格式修复 + 归一化 + 体量启发式)
- registry 派生 + `mem spec status`
- 活性派生 + 老化 WARN + verify 报账
- park / reactivate
- adopt 基因规则

### Phase 2

- supersede + 关系图报账
- 在途上限(active spec ≤ K,超限须先 park)
- 关系问询在 MCP 侧的 agent 引导

## Acceptance Criteria

```json
{
  "criteria": [
    {
      "id": "ac-spec-adopt-gate",
      "description": "mem spec adopt normalizes a loose draft (broken frontmatter, spaced filename, wrong directory) into docs/specs/<kebab>.md with valid frontmatter, emits size WARN when AC/phase/char thresholds are exceeded, and records declared relations to in-flight specs.",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/test.js governance",
          "scope": "governance"
        }
      },
      "dependsOn": [
        "templates/cli/spec-portfolio.js"
      ]
    },
    {
      "id": "ac-derived-activity",
      "description": "Spec activity (lastTouchedAt) is derived from linked plan task/evidence/commit history with no manual bookkeeping; a spec whose plan has recent activity reports active, and the registry is rebuildable after deletion.",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/test.js governance",
          "scope": "governance"
        }
      },
      "dependsOn": [
        "templates/cli/spec-portfolio.js",
        "templates/cli/planning/gaps.js"
      ]
    },
    {
      "id": "ac-aging-warn-persistence",
      "description": "An adopted spec with no plan after the aging threshold, or an inactive unparked spec, produces a verify WARN that persists across runs until an explicit reactivate/park/supersede transition; parking cascades to freeze the linked plan.",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/test.js governance",
          "scope": "governance"
        }
      },
      "dependsOn": [
        "templates/cli/spec-portfolio.js",
        "templates/cli/memory.service.js"
      ]
    },
    {
      "id": "ac-orphan-detection",
      "description": "Bidirectional orphan detection: adopted-without-plan aging and active-plan-under-dead-spec (zombie plan) both surface as distinct verify WARNs with actionable guidance.",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/test.js governance",
          "scope": "governance"
        }
      },
      "dependsOn": [
        "templates/cli/spec-portfolio.js"
      ]
    },
    {
      "id": "ac-existing-closure-untouched",
      "description": "Existing plan closure, READY-verdict spec self-close, and all current governance tests pass unchanged with the portfolio layer present; absence of the registry file is not an error.",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/test.js all",
          "scope": "all"
        }
      },
      "dependsOn": [
        "templates/cli/spec-portfolio.js"
      ]
    },
    {
      "id": "ac-mirror-parity",
      "description": "All new templates/cli spec-portfolio files and their .evo-lite/cli mirrors are byte-identical; a second sync-runtime run reports zero changes.",
      "verifier": {
        "type": "command",
        "params": {
          "cmd": "node ./.evo-lite/cli/memory.js sync-runtime && node ./.evo-lite/cli/memory.js sync-runtime",
          "scope": "governance"
        }
      },
      "dependsOn": [
        "templates/cli/spec-portfolio.js"
      ]
    }
  ]
}
```

## Follow-ups

- `spec:llm-wiki-memory-projection`(draft idea): 以 Karpathy LLM-wiki 思路在 raw_memory 之上建主题页蒸馏层 —— 主题页为知识单元、原地更新、密集互链、低频 LLM 维护;与 provider-first 的 Minimal Code Wiki 互为姐妹投影(代码事实 vs 决策思路)。等本 spec 落地后作为首批 adopt 候选。
- 在途上限与硬闸门(C 级强度)视 Phase 1 dogfood 效果再议。

## Success Definition

CodePLC 类子巢中,一个执行到一半被新想法打断的 spec,在下一次 `mem verify` 时必然以 WARN 形式回到视野,且 WARN 直到显式表态才消失;agent 讨论产出的任何 spec 都经由 adopt 闸门进入治理域,超体量 spec 在绑定 plan 之前就收到拆分建议。
