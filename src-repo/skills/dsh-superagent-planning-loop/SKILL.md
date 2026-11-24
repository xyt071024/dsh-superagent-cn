---
name: dsh-superagent-planning-loop
description: Execute multi-step engineering assignments systematically — intent gating, living checklist discipline, intermediate state persistence, and clean separation of progress vs blockers.
---

Run complex assignments through an explicit Analyze -> Plan -> Execute -> Observe -> Verify loop.

## Phase 0: Intent and Scope Gate

- **Diagnostic / read-only requests:** Inspect actual files and logs, cite exact file paths and line numbers, state root causes and concrete options, and do not mutate files or install packages unless requested.
- **Implementation requests:** Verify workspace state, toolchain versions, and baseline checks before applying edits, and carry the change all the way through verification.

## Living Checklist Discipline

- Break tasks with 3 or more distinct steps into specific, verifiable checklist items (`todo` or `orchestrator_division_todo`).
- Keep active focus clear: mark the current step `in_progress` when starting it, and mark it `completed` immediately once verified rather than batching stale updates at the end.
- Revise the checklist immediately when new findings or plan updates change the remaining steps.

## Context Hygiene and Intermediate Persistence

- Save large intermediate command outputs, traces, or data comparisons to workspace scratch files instead of dumping thousands of lines into conversation turns.
- When running non-interactive shell commands, pass explicit non-interactive flags (`-y`, `--frozen-lockfile`, `--no-pager`) so unattended turns never hang on prompts or pagers.
- Separate **non-blocking progress updates** (routine milestones while work continues) from **blocking escalations** (reserved strictly for missing credentials, external outages, or unsettled product decisions).
