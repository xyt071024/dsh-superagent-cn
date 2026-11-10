# 03 · Multi-Session Collaboration (Sub-Sessions)

[← Previous: Full Task Flow](02-flow.md) | [Back to README](../README.md) | [Next: Settings UI →](04-settings.md)

---

This is the project's **most central extension**, and the part that differs most from the official implementation.

---

## 1. The Concept: What a "Sub-Session" Is

A **sub-session** = a child session that the main session **derives dynamically according to task difficulty** while executing a task.

It is not predefined and not fixed. **A simple task is not split; only a hard one is.**

---

## 2. Why It Is Needed

### 2.1 The Limits of a Single Session

| Problem | Symptom |
|---|---|
| **Single-track thinking** | One model reasons from start to finish; its approach tends to ossify |
| **Serial slowness** | Three independent sub-tasks still have to queue |
| **One block stops everything** | One place gets stuck and the whole task stalls |
| **No cross-validation** | It checks its own work and easily misses things |

### 2.2 How Multiple Sessions Solve It

| Pain point | Solution |
|---|---|
| Single-track thinking | **Different models in parallel**, complementary approaches |
| Serial slowness | **Start at the same time** |
| One block stops everything | **Mutual rescue** (one gets stuck, another takes over) |
| No cross-validation | **Peer review + a final regression by the main session** |

---

## 3. The Full Flow (Eight Steps)

### Step 1: The Task Arrives

The Source can be any entry point:

- A work email arrives
- Someone @-mentions it on GitHub
- A message arrives on QQ / WeChat / WeCom / Feishu
- You say it directly in the chat window

### Step 2: Difficulty Pre-Judgment (the Key to Cost Control)

**Run one very lightweight Eval first**, with a small model and the lowest thinking depth.

```
Input:  task description
Output: one word
   simple   - a small single-file change
   medium   - coordination across a few files
   complex  - cross-module refactoring
   extreme  - needs architecture design
```

**About 50 tokens**, buying a saving of several hundred or thousand tokens later.

**The result directly determines the strategy**:

| Difficulty | Strategy |
|---|---|
| simple | The main session does it all itself |
| medium | The main session does it, opening 1-2 sub-sessions if needed |
| complex | Split into 3-4 sub-sessions |
| extreme | Split into 5-6 sub-sessions + multiple rounds of iteration |

### Step 3: Open Sub-Sessions

```
The main session decides to open N (N = 1–6, set by difficulty)
   ↓
Each sub-session gets:
   ├─ its own Session (an isolated context)
   ├─ its own working directory (no tripping over each other's files)
   ├─ a designated model (may differ)
   ├─ a designated thinking depth (may differ)
   └─ an explicit task boundary (what to do, what not to do)
```

**The models can differ completely**:

| Sub-session | Model | Thinking depth | Why it was chosen |
|---|---|---|---|
| A | kimi-k2-turbo | high | Strong at long-context analysis |
| B | claude-sonnet-4 | medium | Strong at code quality |
| C | deepseek-v4-pro | high | Strong at logical reasoning |

**A single model is also fine**: if the task does not need multiple viewpoints, using the same model throughout is cheaper.

### Step 4: Establish the Interconnections

```
     ┌────────────────┐
     │  Main session  │
     └───────┬────────┘
   ┌─────────┼─────────┐
   ↓         ↓         ↓
┌──────┐  ┌──────┐  ┌──────┐
│  A   │←→│  B   │←→│  C   │
└──────┘  └──────┘  └──────┘
   ↕         ↕         ↕
┌──────────────────────────┐
│    Shared task board     │
│ (who does what, how far) │
└──────────────────────────┘
```

**Three kinds of connection**:

| Connection | Purpose |
|---|---|
| Sub → main | Report progress, request a decision |
| Main → sub | Assign work, adjust direction, stop it |
| Sub ↔ sub | Direct communication (not relayed through the main session) |
| All ↔ task board | Shared state; everyone knows the others' progress |

### Step 5: Collaborative Execution

```
Each works on its own
   ↓
Write a heartbeat + progress to the task board every 30 seconds
   ↓
Check the task board periodically:
   ├─ Is my part done? → see who is not → go help
   ├─ Is someone stuck? → proactively ask whether help is needed
   └─ Might my direction be wrong? → look at what the others are doing
```

**Three forms of mutual help**:

| Form | Example |
|---|---|
| **Backfill** | A finishes its part and picks up what B has not finished |
| **Rescue** | B hits a hard problem; A comes over with the context to help |
| **Correction** | C sees that A's direction conflicts with B's and raises it |

### Step 6: Stuck Detection and Rescue

**This is the most critical link.**

```
Each sub-session writes a heartbeat every 30 seconds
   ↓
The main session scans on a timer
   ↓
Finds one with no heartbeat for over 90 seconds
   ↓
Marks it "suspected stuck"
   ↓
Reads its work log + directory state
   ↓
Judges the real progress
   ↓
One of three decisions:
   ├─ let it continue (only temporarily busy, not really stuck)
   ├─ restart it (the process died)
   └─ have another session take over (genuinely blocked)
```

**The takeover procedure**:

```
1. Read the stuck session's:
   · work log (how far it got)
   · directory changes (which files it touched)
   · last message (where it got stuck)
2. Pack these into a context
3. Hand it to the taker (usually the one furthest ahead)
4. The taker continues without redoing the finished part
```

**Why read the log before taking over**: redoing it blind duplicates work and may even overwrite correct results that were already finished.

### Step 7: Consolidation and Regression

```
All sub-sessions finish
   ↓
The main session collects their outputs
   ↓
Merge (conflicts are possible and must be resolved)
   ↓
Run full verification:
    · does it compile / build?
    · are all tests green?
    · does it meet the original requirement?
    · is there anything contradictory?
   ↓
Problems found?
   ├─ yes → hand back to the relevant sub-session to fix (at most 3 rounds)
   └─ no → go to the next step
```

**The regression is not a formality.** It must **verify independently**; it cannot just trust what the sub-sessions say about themselves.

### Step 8: Final Delivery

```
The main session runs one last full verification
   ↓
Passes → output the result
   ↓
Send it back to the original Source (email reply / GitHub comment / IM message)
   ↓
Record lessons in the lesson library
   ↓
Go to sleep
```

---

## 4. The Same Flow in Both States

**Key point**: the flow is **exactly the same** in conversational mode and silent mode; only the UI differs.

| Step | Conversational | Silent |
|---|---|---|
| Task arrives | You speak | A message is pushed |
| Difficulty pre-judgment | Runs the same way | Runs the same way |
| Open sub-sessions | Visible in the window | Invisible, in the background |
| Collaborative execution | You can see progress | Records only in the panel |
| Stuck rescue | Done the same way | Done the same way |
| Final regression | Runs the same way | Runs the same way |
| Delivery | Shown in the window | Sent back to the Source |

**The only difference**: silent mode never pops up a window or interrupts you.

---

## 5. Technical Implementation

### 5.1 Component Mapping

| Step | Implemented with |
|---|---|
| Open sub-sessions | Agent Teams' `spawn_teammate`, or `subagent` |
| Different models | The orchestration layer supports `provider` / `model` overrides |
| Shared task board | Agent Teams' shared task DAG |
| Sub-sessions messaging each other | `send_message` (supports waking a cold session) |
| Heartbeat | Sub-sessions periodically write a status file |
| Stuck detection | The main session scans timestamps on a timer |
| Progress queries | `list_agents` + reading the shared state |

### 5.2 Data Structures

**Shared task board**:

```json
{
  "ticketId": "T-18",
  "sessions": [
    { "id": "A", "model": "kimi-k2-turbo", "status": "running",  "progress": 60, "heartbeat": 1794284787 },
    { "id": "B", "model": "claude-sonnet-4","status": "waiting",  "progress": 20, "heartbeat": 1794284790 },
    { "id": "C", "model": "deepseek-v4-pro","status": "stuck",    "progress": 0,  "heartbeat": 1794284600 }
  ],
  "tasks": [
    { "name": "Analyze requirements", "owner": "A", "status": "done",    "progress": 100 },
    { "name": "Design the solution",  "owner": "B", "status": "running", "progress": 20  },
    { "name": "Write the code",       "owner": "A", "status": "running", "progress": 60  },
    { "name": "Write the tests",      "owner": "C", "status": "stuck",   "progress": 0   }
  ]
}
```

### 5.3 Differences From the Official Implementation

| Dimension | Official implementation | This project |
|---|---|---|
| Between Tickets | **Fully isolated, unaware of each other** | Interconnected, shared task board |
| Stuck handling | Killed on timeout | Read the log → decide to take over / restart |
| Models | One model per Ticket | A different model per sub-session |
| Regression | The Executor checks itself | The main session verifies independently at the end |
| Rescue | None | Yes (mutual backfill) |

**This is a substantive extension of the official implementation, not something configuration can achieve.**

---

## 6. Risks and Constraints

### 6.1 Known Risks

| Risk | Symptom | Mitigation |
|---|---|---|
| **Mutual waiting** | A waits for B, B waits for A, neither moves | The main session detects no progress → forces an assignment |
| **Duplicated work** | Two sessions did the same thing | Claim the task on the board before starting |
| **Overwrite conflicts** | Two sessions changed the same file | Directory isolation + conflict detection at merge |
| **Runaway cost** | Six sessions all on strong models | Tiered configuration + a daily budget cap |
| **Rescue loops** | A rescues B, B then rescues A | Rescue count cap (1 per session by default) |

### 6.2 Hard Constraints

| Constraint | Value | Notes |
|---|---|---|
| Max sub-sessions | 6 | Beyond that, coordination cost exceeds the gain |
| Heartbeat interval | 30 s | Denser wastes cycles, sparser detects late |
| Stuck criterion | 90 s without heartbeat | Three heartbeat cycles |
| Max handback rounds | 3 | How many times work is sent back for fixes |
| Rescues per session | At most 1 | Prevents loops |

### 6.3 When Not to Split

**Not every task should be split.** In these cases the main session alone is faster:

- The task takes less than 10 minutes
- Strong sequential dependency (step two must wait for step one)
- Frequent sharing of intermediate state
- Simple question and answer

**Difficulty pre-judgment exists precisely to avoid this.**

---

## 7. A Complete Example

### Request: add a complete user login system to the project

```
[T+0] Email arrives: "Add a login system, email/password + third-party OAuth"
       ↓
[T+3] Difficulty pre-judgment → extreme (DB, UI, security, third-party integration)
       ↓
[T+5] The main session splits into 4 sub-sessions:
        A: database design and migration → claude-sonnet-4 (medium thinking)
        B: backend API and authentication → deepseek-v4-pro (high thinking)
        C: frontend login page           → kimi-k2-turbo (high thinking)
        D: third-party OAuth integration → gpt-5-mini (medium thinking)
       ↓
[T+8] Establish the interconnections, create the task board
       ↓
[T+10] All four start work
       ↓
[T+45] A finishes the database design → updates the board → helps C with the forms
[T+60] D is stuck on unclear OAuth docs → no heartbeat
[T+62] The main session notices → reads D's log → blocked on parsing callback params
       → decides to have B take over (B already knows the auth logic)
[T+63] B receives D's progress + log and continues the OAuth work
[T+90] Everything is done
       ↓
[T+92] The main session merges → both A and B changed the user table → conflict
       → hands it back to B to fix (A's design wins)
[T+110] B finishes the fix
       ↓
[T+112] Runs the full test suite → all green
[T+115] Final regression → passes
       ↓
[T+116] Replies to the email: "Done, 4 modules, 22 files, 87% test coverage"
       ↓
[T+117] Records a lesson: OAuth doc parsing is a sticking point → pre-seed an example
```

---

[← Previous: Full Task Flow](02-flow.md) | [Back to README](../README.md) | [Next: Settings UI →](04-settings.md)
