# 05 · Sources and Stability

[← Previous: Settings UI](04-settings.md) | [Back to README](../README.md) | [Next: Proxy Scheme →](06-proxy.md)

---

## 1. Design Principle

**Each Source does only three things**: translate, reply, judge permissions. Everything else reuses the core logic.

```
Platform event
   ↓ translate
Unified Trigger
   ↓ enter the core flow (unchanged)
... (reuse all of the official logic)
   ↓ reply
Translate back into the platform format
```

**Adding a new Source = writing one translation layer**; the core does not change.

---

## 2. The Seven Sources

| # | Platform | Protocol | Stability target | What it needs |
|---|---|---|---|---|
| 1 | WeCom | Official API + callbacks | ★★★★★ | Corp ID + app Secret |
| 2 | QQ Mail | IMAP IDLE + SMTP | ★★★★★ | Authorization code |
| 3 | Feishu | CLI + event stream | ★★★★★ | Self-built app credentials |
| 4 | GitHub | CLI + four-level mirror | ★★★★★ | Already working |
| 5 | Gmail | IMAP + app password | ★★★★☆ | Two-step verification |
| 6 | QQ | WebSocket | ★★★★☆ | Already working |
| 7 | WeChat | Local client | ★★★★☆ | Authorization |

---

## 3. What Each Source Must Implement

### 3.1 The Three Essentials

| Item | Purpose |
|---|---|
| **Config form** | What is filled in on screen (server, account, key) |
| **Trigger translation** | Platform message → unified Trigger |
| **Reply channel** | Trigger → platform message |

### 3.2 The Four Optional Items

| Item | Purpose | What happens without it |
|---|---|---|
| **Permission scope** | Judge who may assign work | The default allowlist is used |
| **Context reading** | Read more during Eval | Only the single message is visible |
| **Health check** | Report connection state | No status shown |
| **Search capability** | Find history by keyword | Nothing can be traced back |

### 3.3 Translation Example: Email

```
An email arrives
   ↓
Translated into a Trigger:
   actor      = sender address
   text       = subject + body
   threadKey  = subject (the same subject groups into one Thread)
   mention    = whether it is among the recipients
   meta       = { messageId, references, inReplyTo }
   ↓
Enter the core flow
```

**Reply**:

```
The Ticket needs to reply
   ↓
Translated into an email:
   to       = the original sender (or as specified)
   subject  = Re: the original subject
   body     = the message content
   In-Reply-To = the original messageId
   ↓
Send over SMTP
```

---

## 4. Stability: Five Layers of Hardening

Goal: **every Source at 4 stars or better.**

### 4.1 L1 — Process Watchdog

```
An independent watchdog
   ↓ every 15 seconds
Liveness probe: is the process alive? is the port reachable?
   ↓
Abnormal → automatic restart (exponential backoff: 5s → 10s → 20s → 40s, cap 5 minutes)
   ↓
5 consecutive failures → stop restarting, raise an alarm
```

**Why backoff**: without it, one broken dependency gets restarted endlessly and drags the whole system down.

### 4.2 L2 — Port Arbitration

```
Check the target port before starting
   ↓
In use?
   ├─ our own zombie process → force cleanup
   ├─ another program → switch ports or use a spare port
   └─ unsure → report the conflict and wait for a human decision
```

### 4.3 L3 — Dual Channel

**Key design**: every Source has at least two independent paths.

| Source | Primary channel | Backup channel |
|---|---|---|
| GitHub | API | Local git cache |
| WeChat | Local client protocol | Window control reading |
| Email | IMAP | POP3 |
| WeCom | Callbacks | Active polling |

**If the primary channel dies, it switches to the backup automatically.**

### 4.4 L4 — Message Deduplication

The same message may arrive over several paths. Deduplicate by **platform message ID**:

```
Message received
   ↓
Look up the ID cache
   ├─ already processed → drop
   └─ new message → process, remember the ID (kept 7 days)
```

### 4.5 L5 — Circuit Breaker

```
A Source keeps failing
   ↓ threshold reached (5 by default)
Marked "degraded"
   ↓
Behavior changes:
   · no further active polling attempts
   · record only, do not process
   · the panel shows an orange warning
   ↓
Recovers after human intervention or a successful timed liveness probe
```

**Why it is needed**: a broken Source that keeps retrying occupies every connection and drags the other Sources down.

---

## 5. Each Source in Detail

### 5.1 WeCom (the most stable)

**Why it is the most stable**: an enterprise-grade official API, stable protocol, complete documentation.

**Two ways to connect**:

| Method | Capability | Complexity |
|---|---|---|
| Group bot webhook | Send only, cannot receive | Very low |
| App message API | Both send and receive | Medium |

**Recommendation**: the app message API (it has to receive before it can be assigned work).

**Configuration items**:
```
Corp ID (corpid)
App Secret
AgentId
Callback URL (optional; polling is used when it is not set)
```

### 5.2 QQ Mail (the best scenario fit)

**Why it fits**: email is naturally asynchronous, carries a sender, and has a subject that can group a Thread.

**Technical points**:

| Item | Value |
|---|---|
| Receive | `imap.qq.com:993` (SSL) |
| Send | `smtp.qq.com:465` (SSL) |
| Auth | **Authorization code** (not the login password) |
| Push | IMAP IDLE (the server pushes) |

**IMAP IDLE is the key**: no polling; the server notifies on new mail, so the overhead is genuinely zero.

**Disconnection handling**:
```
The IDLE connection drops
   ↓
Reconnect immediately (1 second)
   ↓
Reconnect fails → backoff retries (5s / 15s / 60s)
   ↓
Reconnect succeeds → catch up on messages missed during the outage via the UID cursor
```

### 5.3 Feishu

**The CLI already exists**; app credentials are missing.

**Configuration**: a self-built app is required; obtain the App ID and App Secret.

**Capability**: event stream push + message send and receive.

### 5.4 GitHub (four-level mirror)

**This is a key design of the project**, because GitHub access is unstable in some regions.

```
Level 1: api.github.com         direct
    ↓ fails
Level 2: acceleration mirror     third-party proxy
    ↓ fails
Level 3: local git cache         content already cloned
    ↓ fails
Level 4: packaged download       download the zip and extract it
```

**Each level degrades to the next automatically, with no manual intervention.**

**Configuration items**:
```
☑ Primary site
☑ Mirror 1 (acceleration proxy)
☑ Mirror 2 (local cache)
☑ Mirror 3 (packaged download)
```

### 5.5 Gmail

**Technical points**:

| Item | Value |
|---|---|
| Receive | `imap.gmail.com:993` (SSL) |
| Auth | App-specific password (two-step verification must be on) |
| Network | **A proxy is required** (in some regions) |

**Note**: a direct connection to Gmail times out in some regions; a proxy is mandatory.

### 5.6 QQ

**A bridge already exists**, over WebSocket.

**Hardening points**:
- Keepalive heartbeat (one ping every 30 seconds)
- Automatic reconnect on disconnect
- Catch up on offline messages after reconnecting

### 5.7 WeChat (heavily hardened)

**This is the most fragile link and needs all five layers.**

#### Why It Is Fragile

| Problem | Explanation |
|---|---|
| No official API | Only the local client is available |
| Multi-process architecture | Four child processes; any one dying kills the whole thing |
| Port contention | Two components fight over the same port |
| Client redesigns | Every Tencent update has to be followed |

#### Five Layers of Hardening

| Layer | Means | Solves |
|---|---|---|
| **L1 watchdog** | 15-second liveness probe, restart on crash | The process dying |
| **L2 port arbitration** | Clean up zombie processes before starting | Port contention |
| **L3 dual channel** | Primary dies → **window control reading** | Single-point dependency |
| **L4 deduplication** | Deduplicate by message ID | Duplicate processing |
| **L5 circuit breaker** | Degrade and alarm after repeated failures | Dragging down everything |

#### L3 Is the Key: Window Control Reading

**Principle**: Windows UIAutomation can read the control tree inside the WeChat window directly (message list, input box, send button).

**Advantages**:
- No third-party injection required
- The WeChat client is not modified
- No private protocol is used

**Disadvantages**:
- The control structure may change after a WeChat redesign and needs adapting
- Reading is slower than a protocol

**Why this reaches 4 stars**: there are two independent paths; if one dies, the other remains.

#### Why It Cannot Reach 5 Stars

**It fundamentally depends on the behavior of Tencent's client.** Tencent can redesign at any time; we can only follow.

**4 stars is the honest ceiling**; claiming 5 would be a lie.

---

## 6. Health Status

Every Source reports a health status:

| Status | Meaning | Panel color |
|---|---|---|
| `ready` | Running normally | Green |
| `starting` | Starting up | Blue |
| `paused` | Paused (configuration incomplete) | Gray |
| `error` | Errored | Orange |
| `degraded` | Degraded (circuit open) | Red |

**Status is broken down by component**:

```
runtime  : ready     ← the host layer
github   : error     ← the business layer; this is the one that matters
email    : ready
```

**Note**: `runtime: ready` does not mean the Source is fine. **You must look at the business layer.**

---

## 7. Adding a New Source

If you want to connect a platform this project does not support, the steps are:

1. **Determine the protocol**: API / IMAP / WebSocket / local client
2. **Implement the three essentials**: config form, Trigger translation, reply channel
3. **Register**: declare it in the Source registry
4. **Test**: configure → test connection → send a test message

**Effort**: about 300-600 lines, 2-4 hours.

---

## 8. Source Comparison Summary

| Dimension | WeCom | QQ Mail | Feishu | GitHub | Gmail | QQ | WeChat |
|---|---|---|---|---|---|---|---|
| Stability | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★☆ | ★★★★☆ | ★★★★☆ |
| Setup difficulty | Low | Low | Medium | Low | Medium | Low | High |
| Requires | Corp account | Auth code | An app | Nothing | Two-step verification | Nothing | Authorization |
| Async friendliness | Medium | **High** | Medium | Medium | High | Low | Low |
| Recommendation | High | **Highest** | High | Essential | Depends | High | Fallback |

**If you connect only one, choose QQ Mail**: the best scenario fit (asynchronous, carries a sender, groups into Threads), the fewest dependencies, a standard protocol.

---

[← Previous: Settings UI](04-settings.md) | [Back to README](../README.md) | [Next: Proxy Scheme →](06-proxy.md)
