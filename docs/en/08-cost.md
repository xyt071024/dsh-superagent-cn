# 08 · Cost Control

[← Previous: Self-Evolution](07-evolution.md) | [Back to README](../README.md) | [Next: Deployment →](09-deployment.md)

---

## 1. Why Cost Control Is Needed

Multi-session collaboration means **one task may open 6 sessions**. If every one of them used the strongest model at the highest thinking depth, the cost would be more than ten times that of a single session.

**The typical cost blow-up**:

```
One "medium" task
   ↓ no difficulty estimate
6 sub-sessions opened
   ↓ all use the strongest model
   ↓ all use the highest thinking depth
   ↓ each session re-reads the same context
Total consumption = 20x+ that of a single session
```

**The goal of cost control is not "spend less" — it is "do not spend for nothing".**

---

## 2. Three Levels of Control

### L1: Task Difficulty Estimate (most effective)

```
Task arrives
   ↓
Run one classification pass with an extremely lightweight model
   · Model: the cheapest one
   · Thinking depth: minimal
   · Output: a single word
   ↓
About 50 tokens
   ↓
Determines the downstream strategy
```

**50 tokens buy savings of hundreds to thousands of tokens — this is the highest-leverage step.**

### L2: Tiering by Difficulty

| Difficulty | Model tier | Thinking depth | Sub-session count |
|---|---|---|---|
| **simple** | Cheap model | Low | 0 (do it itself) |
| **medium** | Standard model | Medium | 0-2 |
| **complex** | Strong model | High | 3-4 |
| **extreme** | Strong model | Highest | 5-6 |

### L3: Runtime Degrade

```
Monitor actual consumption
   ↓
Past 80% of the budget
   ↓
⚠ Warn + downgrade subsequent tasks
   ↓
Past 100%
   ↓
Pause (wait for your decision)
```

---

## 3. Implementing the Difficulty Estimate

### 3.1 Prompt

```
Judge the complexity of this task and output a single word:

simple  —— small single-file change, simple Q&A, formatting tweak
medium  —— coordination across several files, context must be understood
complex —— cross-module refactoring, a design is required
extreme —— architectural decisions, multi-system integration

Task:
{task}
```

### 3.2 Why "Minimal" Thinking Depth

A classification task does not need deep reasoning. Using "minimal":
- Costs about 1/16 of "highest"
- The accuracy loss is small (task descriptions are usually clear enough)

### 3.3 Handling Misjudgment

**The estimate can be wrong.** Two cases:

| Case | Handling |
|---|---|
| Judged "simple", actually hard | Gets stuck during execution → escalate and re-judge |
| Judged "complex", actually simple | No progress in the first 2 minutes → downgrade and do it itself |

**The basis for the call**: check progress 2 minutes into execution; if a "simple" task has made no progress at all, reassess.

---

## 4. Context Reuse

### 4.1 The Problem

Messages in the same thread are read by several tickets. Re-reading each time means paying twice.

### 4.2 The Solution

```
First read of a thread
   ↓
Summary + key excerpts cached
   ↓
Later tickets read it → cache hit
   ↓
Only the new portion is appended
```

**Cache validity**: when the thread has new messages, the corresponding part is invalidated.

### 4.3 Cache Granularity

| Content | Caching strategy |
|---|---|
| Full thread history | Summary cache (key facts retained) |
| Repository files | Cached by commit hash |
| Model responses | KV Cache (reuse the same prefix) |

---

## 5. Result Caching

### 5.1 What Can Be Cached

| Can cache | Cannot cache |
|---|---|
| Code analysis results | Anything involving live state |
| Document summaries | Anything depending on the current time |
| File structure | Anything needing the latest data |
| Approaches for similar tasks | Anything the user explicitly asked to redo |

### 5.2 Cache Key

```
key = hash(task type + target file + hash of the target file + key parameters)
```

**If the file changes, the cache is invalidated.**

---

## 6. Model Tiering Strategy

### 6.1 Comparing Three Strategies

| Strategy | Cost | Effect | Suited to |
|---|---|---|---|
| **Uniform model** | Medium | Stable | Homogeneous tasks |
| **Tiered models** | Cheapest | As needed | Most scenarios |
| **Multi-model in parallel** | Most expensive | Best | Critical tasks |

### 6.2 Tiering Configuration Example

```
Difficulty estimate  → cheapest model   minimal thinking
Simple tasks         → flash tier       low thinking
Medium tasks         → standard tier    medium thinking
Complex tasks        → strong model     high thinking
Extremely complex    → strongest model  highest thinking
Self-evolution       → strongest model  highest thinking (low frequency, worth it)
```

### 6.3 Cost of Thinking Depth

| Tier | Relative token consumption |
|---|---|
| Minimal | 1x |
| Low | 2x |
| Medium | 4x |
| High | 8x |
| Highest | 16x |

**That is why "use minimal thinking for the difficulty estimate" matters so much.**

---

## 7. Budget Control

### 7.1 Three Budget Levels

| Level | When exceeded |
|---|---|
| **Daily budget** | Pause (configurable to downgrade instead) |
| **Monthly budget** | Pause + notify |
| **Per-task budget** | Downgrade or abort |

### 7.2 Budget Display

Shown live on the dashboard:

```
Daily budget  ¥50
Used          ¥12.4  ▓▓▓▓▓░░░░░░░░░░░░░  24.8%
Tasks today   8, averaging ¥1.55/task
```

### 7.3 Handling Over-Budget

```
Approaching budget (80%)
   ↓
⚠ Warn: subsequent tasks are downgraded automatically

Past budget (100%)
   ↓
⦿ Pause (default): new tasks queue up, waiting for your decision
○ Downgrade: continue but use only cheap models
○ Unlimited: continue executing normally
```

---

## 8. Cost Amplification in Multi-Session

### 8.1 Cost Model

```
Single-session cost = C

N sessions in parallel:
  Theoretical cost = N × C
  Actual cost      = N × C × 1.3 (coordination overhead)

But the time saved = N times
```

**So multi-session is "trading money for time".**

### 8.2 When It Is Worth It

| Worth it | Not worth it |
|---|---|
| The task can truly run in parallel | Strongly sequential dependencies |
| Time-sensitive | Not urgent |
| High complexity | Simple tasks |
| Cost is acceptable | Budget is tight |

### 8.3 Cost Ceiling Protection

```
☑ Per-task cost ceiling  ¥ [ 10 ]
When exceeded: pause and ask
```

**Prevents one task from accidentally burning a whole day's budget.**

---

## 9. Measured Data Reference

The following is **sample data**; actual figures vary by task and model:

| Scenario | Single session | Multi-session (4) | Multiple |
|---|---|---|---|
| Simple copy change | ¥0.05 | not split | 1x |
| Medium feature change | ¥0.8 | ¥2.4 (3) | 3x |
| Complex refactor | ¥5 | ¥18 (5) | 3.6x |
| Extremely complex system | ¥20 | ¥60 (6) | 3x |

**Note**: multi-session does not cost N times as much, because each session has a smaller task scope and therefore a lower per-session cost.

---

## 10. Cost Control Checklist

Check against this list before going live:

| # | Item | Default | Description |
|---|---|---|---|
| 1 | ☑ Task difficulty estimate | On | The most effective cost control measure |
| 2 | ☑ Minimal thinking for the estimate | On | A 16x cost difference |
| 3 | ☑ Result caching | On | The same task is not repeated |
| 4 | ☑ Context reuse | On | The same thread is not re-read |
| 5 | ☑ Daily budget ceiling | Required | Prevents surprises |
| 6 | ☑ Per-task ceiling | Recommended | Prevents a single task from blowing up |
| 7 | ☑ Auto-downgrade over budget | Recommended on | Smooth handling |
| 8 | ☐ Multi-model in parallel | As needed | Only for critical tasks |
| 9 | ☑ Lower self-evolution frequency | Weekly | Not every task needs a retrospective |

---

## 11. Anti-Patterns

| Anti-pattern | Problem |
|---|---|
| Using the strongest model for everything | 10x the cost, limited gain in quality |
| Using the highest thinking for everything | Same as above |
| Splitting every task into multiple sessions | Coordination overhead > benefit |
| No difficulty estimate | Small tasks go through a heavy flow |
| No budget ceiling | One accident burns it all |
| A deep retrospective after every task | Retrospective cost > task cost |

---

[← Previous: Self-Evolution](07-evolution.md) | [Back to README](../README.md) | [Next: Deployment →](09-deployment.md)
