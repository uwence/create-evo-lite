---
trigger: model_decision
description: Trigger strictly when completing a task or system_state_summary intent
---

# RULE: SYS_MEM_DISTILLATION_PROTOCOL

Activation Mode: Model Decision
Trigger Context: `[task_status == 'completed']` OR `[intent == 'system_state_summary']`

---

## 1. Phase One: Business Logic Closure & Handover
Condition: Code changes for the current feature/fix are complete, but NOT yet committed.
Hook: `pre_exit`
Constraint: BLOCK_EXECUTION_UNTIL_HUMAN_CONFIRMATION
Action: MUST output the exact payload to stdout and halt.
Payload:
> Master，当前功能业务代码已闭环。请您审查并执行首次 Git Commit，以便我提取 Hash 锚点用于显隐双层记忆的沉淀。

## 2. Phase Two: Memory Distillation & Hash Extraction
Condition: Human confirms the initial Git Commit is complete.
Action Pipeline:
1. `Hash Extraction`: Execute `git log -1 --format="%h"` (or parse git status) to retrieve the latest `<hash>`.
2. `Tool Call`: Execute `mem_remember` using the strictly extracted hash.

### 2.1 Quality Filters for mem remember
- REJECT: `low_entropy_logs`, `generic_step_by_step_execution`
- REQUIRE: `cross_file_contracts`, `workarounds`, `anti_idiot_logic_shifts`

### 2.2 Format Schema Enforcement (Strict)
Directive: Output MUST exactly match the template below. Deviations trigger `Script_Rejection`，Please refer to memory-distillation.md.
```text
1. [Topic_A]: [Technical_Details]. (溯源历史点: [Commit: <extracted_hash>])
2. [Contract_B]: [Defense_Mechanism]. (溯源历史点: [Commit: <extracted_hash>])