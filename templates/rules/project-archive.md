---
trigger: model_decision
description: Trigger strictly when completing a task or system_state_summary intent
---

# RULE: SYS_MEM_DISTILLATION_PROTOCOL

Activation Mode: Model Decision
Trigger Context: `[task_status == 'completed']` OR `[intent == 'system_state_summary']`

---

## 1. Phase One: Business Logic Closure & Handover
Condition: Code changes for the current feature/fix are complete.
Action: MUST execute `git commit` first, then run `.\.evo-lite\mem.cmd track --mechanism="..." --details="..."`.

## 2. Phase Two: Memory Distillation & Hash Extraction
Action Pipeline:
1. `mem.cmd` will automatically capture the commit hash.
2. `mem.cmd` handles the structural distillation into `raw_memory/`.
3. `mem.cmd` handles incremental vectorization into SQLite.
4. `mem.cmd` enforces the standard formatting schema.

### 2.1 Quality Filters for memory
- REJECT: `low_entropy_logs`, `generic_step_by_step_execution`, `流水账式记录`
- REQUIRE: `cross_file_contracts`, `workarounds`, `anti_idiot_logic_shifts`, `>40字符要求`

### 2.2 Format Schema Enforcement (Strict)
Directive: All records stored in `raw_memory/` MUST follow the format enforced by `cli/memory.js`.
Any deviation will trigger `Script_Rejection` by the CLI validator.