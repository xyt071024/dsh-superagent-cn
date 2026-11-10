# 07 · Self-Evolution Mechanism

[← Previous: Proxy Architecture](06-proxy.md) | [Back to README](../README.md) | [Next: Cost Control →](08-cost.md)

---

## 1. Four Levels of Evolution

```
┌──────────────────────────────────────────┐
│  L1 Self-check and retrospective         │
│  After each task: what went well,        │
│  what was slow, what was wrong           │
└──────────────────────────────────────────┘
                  ↓ accumulate
┌──────────────────────────────────────────┐
│  L2 Crystallize experience               │
│  Common flows → skills;                  │
│  common pitfalls → checklists            │
└──────────────────────────────────────────┘
                  ↓ optimize
┌──────────────────────────────────────────┐
│  L3 Code optimization                    │
│  Find redundancy → suggest cleanup;      │
│  find dead code → suggest removal        │
└──────────────────────────────────────────┘
                  ↓ extend
┌──────────────────────────────────────────┐
│  L4 Capability expansion                 │
│  Missing tool → install; missing         │
│  knowledge → learn (both need mandate)   │
└──────────────────────────────────────────┘
```

---

## 2. L1: Self-Check and Retrospective

### 2.1 Triggers

| Trigger | Content |
|---|---|
| Task completed | Full retrospective of this run |
| Task failed | Analysis of the failure cause |
| Scheduled (weekly) | Summary of recent experience |

### 2.2 Retrospective Content

```
1. What went right this time?
   · Which judgment was accurate
   · Which approach worked
   · Which tool was useful

2. What was slow this time?
   · Which step was the bottleneck
   · Were there redundant steps
   · Was too much context read

3. What was wrong this time?
   · Where the judgment failed
   · Was there rework
   · Did the user correct anything

4. What should be done next time this kind of task comes up?
   · Concrete actions
   · What to avoid
```

### 2.3 Experience Format

```json
{
  "id": "lesson-001",
  "createdAt": "2026-11-10T23:00:00Z",
  "taskType": "code-modification",
  "context": "The user asked to change the styles of a React component",
  "whatWorked": [
    "Read AGENTS.md before acting, which avoided violating project conventions",
    "Ran the tests once before changing anything, confirming the baseline was green"
  ],
  "whatFailed": [
    "Did not check which branch it was at first, and changed the wrong place"
  ],
  "lesson": "Confirm the current branch before acting, and check that the target file is on the expected branch",
  "appliesWhen": ["modifying existing code", "multi-branch projects"]
}
```

### 2.4 Using Experience

**It is not fully loaded every time** (that would be too expensive). Instead it is **retrieved by task type**:

```
New task arrives
   ↓
Identify the task type (code change / documentation / troubleshooting / ...)
   ↓
Retrieve relevant experience (by taskType + keywords)
   ↓
Load only the top N entries (default 5)
   ↓
Inject them into the executor's context
```

**Cost control**: 5 lessons cost about 500 tokens and buy avoidance of repeated mistakes.

---

## 3. L2: Crystallizing Experience

### 3.1 When Something Becomes a Skill

```
The same kind of task done 3+ times
   ↓
The flow is essentially fixed
   ↓
Extract it into a skill (SKILL.md)
   ↓
Call it directly next time, without re-reasoning
```

### 3.2 Benefits of Skills

| Benefit | Description |
|---|---|
| Saves tokens | No need to re-reason the flow every time |
| More stable | A fixed flow is more reliable than improvising |
| Reviewable | You can read what the skill contains |

### 3.3 Criteria for Crystallizing

| Should crystallize | Should not crystallize |
|---|---|
| Fixed steps, recurring | One-off tasks |
| Clear success criteria | Subjective results |
| Steps that are easy to get wrong | Very simple operations |
| Requires multi-step coordination | Single-step operations |

---

## 4. L3: Code Self-Optimization

### 4.1 What It Scans

| Type | Detection method |
|---|---|
| **Duplicate code** | Similarity analysis, finding blocks of 3+ identical lines |
| **Dead code** | Functions/variables not referenced anywhere |
| **Overlong functions** | Exceeds a threshold (e.g. 100 lines) |
| **Complex conditionals** | Nesting deeper than 4 levels |
| **Unused dependencies** | Present in package.json but unused in the code |

### 4.2 How Changes Are Made (Important)

```
Optimization opportunity found
   ↓
Generate a change proposal
   ↓
⦿ Go through the PR flow (default)
   · Create a branch
   · Commit the change
   · Open a PR
   · Wait for your review
   ↓
○ Change directly (must be enabled explicitly)
```

**Why the PR flow is the default**: self-modification is a high-risk operation. You may disagree with its judgment, and a PR gives you the chance to stop it.

### 4.3 Red Lines for Self-Modification

**The following must never be modified automatically**:

| Red line | Reason |
|---|---|
| Permission decision logic | Breaking it is equivalent to opening a backdoor |
| Whitelist checks | Same as above |
| Audit log | If broken, problems cannot be traced |
| Circuit breaker / rate limiting | If broken, the system can run out of control |
| Configuration files | Controlled by you |

**Even if an "optimization opportunity" is found in these places, it only raises a suggestion and does not change anything.**

---

## 5. L4: Capability Expansion

### 5.1 Three Kinds of Expansion

| Expansion | Trigger | Mandate requirement |
|---|---|---|
| **Install a plugin** | A missing capability is detected | Checked on the permission page |
| **Write a skill** | A flow is detected as commonly used | Checked on the permission page |
| **Learn knowledge** | A knowledge gap is detected | Record only, no mandate needed |

### 5.2 Plugin Installation Flow

```
Missing capability detected
   ↓
Search for available plugins (npm / GitHub)
   ↓
⚠ Safety check:
   · Is the source trustworthy
   · Does it have known vulnerabilities
   · Is the permission scope too broad
   ↓
Generate a proposal: "Need to install X, because Y, risk is Z"
   ↓
⦿ Wait for your confirmation (default)
○ Install directly (must be enabled explicitly)
```

**Why confirmation is the default**: installing a plugin means pulling in third-party code, and the risk is not controllable.

### 5.3 Recording Capability Gaps

Even when it cannot install anything itself, it **records** the gap:

```json
{
  "gap": "Missing PDF parsing capability",
  "encounteredAt": "2026-11-10",
  "timesNeeded": 3,
  "suggestedSolution": "Install pdf-parse or a similar library",
  "status": "pending-user-decision"
}
```

**A suggestion is raised only after a threshold is reached (default 3 times)**, to avoid installing things for one-off needs.

---

## 6. The Boundaries of Evolution

### 6.1 What Can Evolve

| Item | Scope |
|---|---|
| Experience library | Unbounded growth (archived periodically) |
| Skills | Can be added, can be modified |
| Its own code | Through PRs, only non-red-line parts |
| Plugins | Requires a mandate |

### 6.2 What Cannot Evolve

| Item | Reason |
|---|---|
| Permission decision logic | Security red line |
| Whitelist | Controlled by you |
| Mandate credentials | Controlled by you |
| Circuit breaker thresholds | Prevents it from switching off its own protection |
| Audit records | Must not be tamperable |

### 6.3 The Evolution Brake

```
Detected that self-modification is too frequent
   ↓ e.g. 10 self-optimization PRs in one week
Pause self-optimization
   ↓
Show: "There have been many self-modifications recently; consider stabilizing for a while"
```

**Why the brake exists**: frequent self-modification makes the system unpredictable.

---

## 7. Experience Library Structure

```
<stateDir>/
  lessons/
    2026-11/
      lesson-001.json
      lesson-002.json
      ...
    index.json          ← index, grouped by taskType
    archived/           ← archive (older than 90 days and never referenced)
```

**index.json**:

```json
{
  "byTaskType": {
    "code-modification": ["lesson-001", "lesson-005"],
    "bug-investigation": ["lesson-002"],
    "documentation": ["lesson-003"]
  },
  "byKeyword": {
    "git-branch": ["lesson-001"],
    "testing": ["lesson-001", "lesson-004"]
  }
}
```

---

## 8. Measuring the Effect

How do you know it is actually getting better?

| Metric | How to read it |
|---|---|
| Time taken for similar tasks | Should trend down |
| Rework rate | Should trend down |
| Number of user corrections | Should trend down |
| First-pass success rate | Should trend up |
| Average token consumption | Should trend down (because experience is reused) |

**The dashboard should have trend charts for these numbers.**

---

## 9. Configuration

See [Settings UI · Group 7: Self-Evolution](04-settings.md#group-7-self-evolution).

Key switches:

| Switch | Default | Description |
|---|---|---|
| Self retrospective | On | Review after every task |
| Record experience | On | Write into the experience library |
| Code scan | On | Look for redundancy |
| Change method | **Through PRs** | Never change directly |
| Autonomous plugin install | **Off** | Must be enabled explicitly |
| Autonomous skill writing | **Off** | Must be enabled explicitly |
| Suggest on capability gaps | On | Suggest only, never act |

---

[← Previous: Proxy Architecture](06-proxy.md) | [Back to README](../README.md) | [Next: Cost Control →](08-cost.md)
