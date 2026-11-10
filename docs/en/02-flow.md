# 02 · Full Task Flow

[← Previous: Positioning](01-overview.md) | [Back to README](../README.md) | [Next: Multi-Session Collaboration →](03-collaboration.md)

---

This document reconstructs the whole path **in chronological order**: for one message from arrival to reply, what happens at each step and which interface is used.

---

## 1. Phase 0: Process Startup

| Step | Action | Location |
|---|---|---|
| 1 | Read the config file | `~/.dsh/profiles/<name>/cordis.patch.yml` |
| 2 | Open the database + take the file lock | `<stateDir>/orchestrator.sqlite` |
| 3 | Probe accounts (`gh api user` etc.) | Deployment check |
| 4 | Write the worker command shim directory | `<stateDir>/worker-bin` |
| 5 | Create the main session | Using a dedicated preset |
| 6 | Start the scheduling loop | Once every 2 seconds |

**Note**: scheduling is **polling** (a scan every 2 seconds), not event-driven. This is the official implementation; the later "silent mode" rework replaces this layer.

---

## 2. Phase 1: Message Arrival (Passive Path)

### 2.1 Sequence

```
[1] New message on the platform
      ↓ polling (once every 60 seconds by default)
[2] Source pulls it
      ↓
[3] Translated into a Trigger
      ↓ records: sender, body, thread key, whether it was mentioned
[4] Persisted + deduplicated
      ↓ the same Trigger is stored only once
[5] Resolve ownership
      ├─ new Thread → create the Thread, enqueue for Eval
      └─ existing Thread → fan out to subscribed Tickets (as context, no authorization)
[6] The scheduling loop picks it up
      ↓
[7] Assemble the candidate card
      ↓
[8] Push into the main session
```

### 2.2 Key Interfaces

| Action | Interface |
|---|---|
| Pull messages | Each platform's own API / CLI |
| Store a Trigger | `Engine.receive(trigger)` |
| View candidate context | `orchestrator_eval` |
| Read more context | `orchestrator_eval_read` |
| Record the Decision | `orchestrator_eval_decide` |
| Route the Decision | `orchestrator_route` |

---

## 3. Phase 2: Gate (Pure Code)

```
Trigger arrives
   ↓
gate(trigger, thread, tickets)     ← pure function, no model
   ↓
Steps:
   ① Check whether the sender is on the allowlist
   ② Check whether it is a bot account
   ③ Look up the corresponding cell of the admission table
   ↓
One of three outputs:
   explicit   - explicit request
   inferred   - inferred candidate
   not admitted - dropped
```

**This step does not read message content.** This is the cornerstone of the permission defense.

### 3.1 The Admission Table

Every Source has an admission table: rows are "receive scope", columns are three cases:

| Cell | Options | Default |
|---|---|---|
| On the list but not mentioned | inferred / ignore | inferred |
| Not on the list but mentioned | explicit / inferred / ignore | ignore |
| Not on the list and not mentioned | inferred / ignore | ignore |

**Example**: setting "not on the list but mentioned" to "explicit" is equivalent to "anyone in this scope can assign work by @-mentioning it" — suitable for a dedicated support group.

---

## 4. Phase 3: Eval (Model)

### 4.1 Three Facts That Must All Hold

| Fact | Criterion |
|---|---|
| **① The discussion targets this project** | Not a chat about someone else's product, not a hypothetical |
| **② There is implementation intent** | A concrete change has been explicitly expressed |
| **③ The direction is settled** | A small local change can be made directly; it is not still a design debate |

**Only when all three hold is the work accepted.** Missing any one means ignore.

### 4.2 Output Structure

```json
{
  "rule_assessments": [
    { "rule_id": "copy",   "matched": true,  "reason": "explicitly asks to change the copy" },
    { "rule_id": "visual", "matched": false, "reason": "no visual adjustment involved" }
  ],
  "direction": {
    "implementation_requested": true,
    "target_basis": "existing-standard",
    "requires_design_decision": false,
    "evidence": ["quoted from the original"]
  },
  "acknowledgement": "one sentence saying what will be done"
}
```

**Note**: `rule_assessments` must contain **one entry for every enabled rule**, matched or not. A missing entry raises an error.

### 4.3 Context Window

What Eval can see:

| Content | Length |
|---|---|
| Trigger text | Up to 4000 characters |
| First 5 messages of the Thread | 400 characters each |
| 5 messages before and after the Trigger | Adjacent two may reach 1200 characters |
| Related Tickets | Up to 8, in-progress ones first |
| Other messages | 50-character summary, expandable by id |

---

## 5. Phase 4: Accepting the Work

```
orchestrator_route {kind: "accept", ...}
   ↓
Done inside a single transaction:
   ├─ create Decision
   ├─ create Ticket
   ├─ create Mandate (records policy version / scope / strength / matched rules)
   ├─ create Assignment (pending start)
   ├─ create Subscription (subscribe to all related Threads)
   └─ enqueue the confirmation message
   ↓
Enter the execution queue
```

**Idempotency**: accepting the same Trigger ID twice still creates only one Ticket.

---

## 6. Phase 5: Execution

### 6.1 Starting the Executor

```
[1] Run the prepare command (if configured) - 10 minute limit
[2] Create the directory <stateDir>/work/<short-name>
[3] Start the session, named worker-<TicketID>
[4] Send the first message: title + task description + source event card
```

### 6.2 The Executor's Toolset

| Category | Tools |
|---|---|
| Files | `read` `write` `edit` `glob` `grep` `read_image` |
| Commands | `bash` / `pwsh` `job_output` `job_list` `job_kill` |
| Network | `web_search` `web_fetch` |
| Collaboration | `subagent` `send_message` `list_agents` `interrupt_agent` |
| Other | `skill` `todo_write` |

### 6.3 Working Procedure

```
1. Read AGENTS.md in the repository (the project's own rules)
2. Judge scope: is this work inside my Mandate?
   ├─ no → handback
   └─ yes → continue
3. Confirm before acting: state in one sentence what will be done
4. Work: change code / run tests / self-check
5. Long commands go to the background (foreground auto-moves after 5 seconds)
6. Report
```

### 6.4 Six Report States

| State | Meaning | Consequence |
|---|---|---|
| `progress` | Internal progress | Nobody is notified |
| `waiting` | This round is done, nothing pending | Goes idle, waits for the next message |
| `ready` | Done and self-check passed | Moves to "awaiting review" |
| `blocked` | Something is missing, a human must intervene | Moves to "blocked" |
| `failed` | Failed | Moves to "failed" |
| `dropped` | No handling needed | Ticket closed, no message sent |

### 6.5 Limits on Background Work

| Item | Value |
|---|---|
| Maximum background work per round | 30 minutes |
| Action on expiry | Kill the shell job, state in the report what was killed |
| Sub-agents | Allowed to continue |
| When handing back to a human | Sub-agents stop immediately, shell jobs may continue |

---

## 7. Phase 6: Replying

### 7.1 Three Paths

| Path | When | Constraint |
|---|---|---|
| **Confirmation** | On acceptance / before starting work | **Hard ceiling 100 words** |
| **Result** | Reporting `ready` | The Ticket must actually be ready |
| **Question** | A human decision is needed | **The original question must be copied verbatim** |

### 7.2 Landing Rules

```
The Thread the Ticket came from → reply back there
    Exception: if a human raised the question → reply to the conversation the asker is in
```

### 7.3 100 Words Is a Hard Constraint

This is not a suggestion; it is a transport-layer rejection.

> Original: *"100 words is a hard ceiling, not a writing target. The transport rejects longer IM messages."*

Chinese is counted by segmentation; the label and the address of a Markdown link both count.

---

## 8. Phase 7: Follow-up Messages

### 8.1 Subscription Mechanism

On acceptance a Ticket **subscribes** to all related Threads. Afterwards:

- **Any new message in the Thread** → reaches the Ticket automatically (as context, no authorization)
- **No further @ needed**
- Bot messages and CI results also arrive

### 8.2 Resuming After the Ticket Ends

```
Ticket ends (ready/merged/closed)
   ↓
Subscription retained
   ↓
Someone keeps talking in the same Thread
   ↓
Resumes automatically (same Mandate, no fresh Eval)
   ↓
If the Mandate conditions have changed → re-validation fails → no resume, go through Eval again
```

---

## 9. A Complete Timeline Example

### Scenario: Someone on GitHub asks for a copy change

```
T+0      Someone comments @it on an Issue: "change this button text to Save"
T+60     Polling cycle hits, the notification is pulled
T+60     Translated into a Trigger, persisted, Thread created, enqueued for Eval
T+62     Scheduling loop picks it up, assembles the card, pushes to the main session
T+65     Model judges:
           ① targets this project ✓
           ② has implementation intent ✓
           ③ direction settled (specifically to Save) ✓
          Matches the copy rule → accept
T+65     Create Ticket + Mandate + Assignment + Subscription (single transaction)
T+66     Send confirmation: "Got it: change the 'Save changes' button on the settings page to 'Save'"
T+66     Start the Executor: create directory → start session → send task
T+72     The Executor begins work
T+80     Change done, tests run, self-check
T+95     Reports ready
T+96     Main session sends the result back to the original Thread
T+97     Done
```

### Scenario: A complex request arrives by email

```
T+0      Email arrives
T+1      IMAP push → translated into a Trigger
T+2      Gate decides: sender on the allowlist → explicit request
T+3      Main session first does a difficulty pre-judgment (low thinking depth, ~50 tokens)
T+5      Judged "complex" → needs 3 sub-sessions
T+6      Open sub-sessions A/B/C, each with a designated model
         → see [Multi-Session Collaboration](03-collaboration.md)
...
T+167    Final regression passes, result email sent
```

---

## 10. Exception Paths

### 10.1 Eval Timeout

```
The clock starts when the candidate reaches the main session (120 seconds by default)
   ↓ timeout
Retry in the queue
   ↓ two timeouts in a row
The third is recorded as "unavailable"
   ↓
The panel prompts for manual handling
```

### 10.2 The Executor Is Stuck

| Case | Handling |
|---|---|
| Reports `blocked` | Stop automatic input, wait for a human |
| Reports `failed` | Same as above |
| No heartbeat (timeout) | Flagged as suspected stuck; the main session decides to take over / restart |
| Temporary provider failure | Automatic retry 3 times (from 5 seconds, doubling up to 300 seconds) |

### 10.3 Source Failure

| Case | Handling |
|---|---|
| A single read fails | The error is recorded on that Thread, retried next round |
| N consecutive failures | The Source is marked as errored |
| One item keeps failing for a day | That item is dropped so polling is no longer blocked |

### 10.4 Reply Failure

| Case | Handling |
|---|---|
| Send fails | Retry from 5 seconds, doubling up to 300 seconds |
| The conversation no longer exists | Marked "dropped"; not resent elsewhere |
| The Source is closed | Wait; do not drop |

---

[← Previous: Positioning](01-overview.md) | [Back to README](../README.md) | [Next: Multi-Session Collaboration →](03-collaboration.md)
