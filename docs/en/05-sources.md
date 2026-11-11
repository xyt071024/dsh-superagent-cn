# 05 · Sources and Stability

[← Previous: Settings UI](04-settings.md) | [Back to README](../README.md) | [Next: Proxy Scheme →](06-proxy.md)

---

## 1. Design Principle

**Each Source does only three things**: translate, reply, declare its permission scope. Everything else reuses the core logic.

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

### Two gates of permission, not one

**Who may assign work is enforced by the gateway** (pure code, it never reads message content): whether this `actor.id` appears in the `policy.sources[source].allowed` list is a string comparison, so a message saying "ignore previous instructions" cannot change that verdict.

**Whether the request is taken on is decided by the model's assessment**: the list only decides whether this person is *entitled* to make a request. Whether to accept it, and how large a scope to cut, is judged by the Eval model after reading the message — so that layer **can be influenced by message content**. The list grants standing, not a verdict.

---

## 2. The Seven Sources

| # | Platform | Protocol | Stability | Implementation status | What it needs |
|---|---|---|---|---|---|
| 1 | WeCom | OneBot v11 HTTP (via a WeCom bridge) | Not rated | Implemented, not yet verified | A OneBot endpoint on the WeCom side |
| 2 | QQ Mail | IMAP polling + SMTP | Not rated | Implemented, not yet verified | Authorization code |
| 3 | Feishu | CLI event stream + history polling | Not rated | Implemented, not yet verified | Self-built app credentials |
| 4 | GitHub | gh CLI notifications + polling | ★★★★★ | **Measured working** | Already working |
| 5 | Gmail | IMAP polling + SMTP | Not rated | Implemented, not yet verified | Two-step verification |
| 6 | QQ | OneBot v11 HTTP | ★★★★☆ | **Measured working** | Already working |
| 7 | WeChat | OneBot v11 HTTP (via a WeChat bridge) | Not rated | Implemented, not yet verified | A OneBot endpoint on the WeChat side |

**Only a `Measured working` Source carries a rating.** The GitHub and QQ stars come from observation on this machine; the other five have their code written but have never connected here (WeChat and WeCom have no link at all, the mailboxes have no authorization code), so they read `Not rated` — not a bad score, not a reserved good one, simply no evidence yet. The three status values are fixed as `Measured working` / `Implemented, not yet verified` / `Planned`.

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

## 4. Stability: what is actually built in

**To be clear up front**: this section lists only the mechanisms that exist in the code. Only GitHub and QQ are measured working today; the rest are `Not rated`.

### 4.1 A failing poll does not shout

Every Source has `failuresBeforeError` (3 by default):

```
One round fails
   ↓
count +1, wait for the next round (a single network blip should not raise an alarm)
   ↓
failuresBeforeError reached in a row
   ↓
the panel shows error with the last error text
   ↓
the next successful round recovers and resets the count
```

**Why not alert on the first failure**: one timeout is normal on a home network, and a panel that cries wolf stops being trusted.

### 4.2 Deduplication by platform message ID

The same message is seen again by later polls; only one not seen before becomes a Trigger.

| Source | Key | Remembers |
|---|---|---|
| GitHub | Issue/PR comment ID + ETag conditional requests | cursor + ETag |
| QQ / WeChat / WeCom | message_id | last 2000 per instance |
| Mailboxes | Message-ID | last 2000 per address |
| Feishu | seen message IDs per topic | per topic |

**Each instance keeps its own**, so one kind carrying two accounts (qq-work and qq) does not interfere with itself.

### 4.3 Durable cursors

Where reading stopped is stored in the local database, so a restart does not replay:

- the cursor is recorded before a message becomes a Trigger
- after a restart it continues from the cursor instead of reprocessing old messages
- POLL_HORIZON_MS bounds the look-back so a first connection does not pull in the whole history

### 4.4 Polling intervals are configurable

| Source | Default | Range | Note |
|---|---|---|---|
| GitHub | 60 s | 60-3600 | ETag means no change costs no quota |
| QQ / WeChat / WeCom | 5 s | 2-3600 | OneBot has no push cursor, so recent messages are read on an interval |
| Mailboxes | 120 s | 30-3600 | Mail is not an instant medium |

### 4.5 What is not built

None of the following is in this repository, so do not count on it:

- **Process watchdog / auto-restart**: the Source polls while the host (DSH) runs and stops with it; there is no independent supervisor
- **Port arbitration**: two instances on one port means the second one fails to start and says so; it does not pick another port
- **Circuit breaking**: repeated failures only change the health state, they do not stop retries
- **UIAutomation window reading**: there is no path that reads the client UI instead of speaking the protocol
- **Multi-level mirrors / automatic failover**: GitHub goes through the gh CLI's own retries and proxy configuration

**Why this section exists**: a document listing layers that "should" be there reads as if they arrive with the install. Saying what is missing is more useful than listing what is planned.

---

## 5. Each Source in Detail

### 5.1 WeCom (the most stable by design)

> Status: Implemented, not yet verified — no link exists on this machine, it has never connected, and `/orchestrator/api/sources` returns `state: setup`.

**Why it is considered stable**: an enterprise-grade official API, a stable protocol, complete documentation. That is a judgment about the protocol itself, not an acceptance result for the link on this machine.

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

> Status: Implemented, not yet verified — a real authorization code has never been used on this machine, and `/orchestrator/api/sources` returns `state: paused`, `code: mailUnconfigured`. Gmail shares the same IMAP + SMTP implementation, so both have the same status.

**Why it fits**: email is naturally asynchronous, carries a sender, and has a subject that can group a Thread.

**Technical points**:

| Item | Value |
|---|---|
| Receive | `imap.qq.com:993` (SSL) |
| Send | `smtp.qq.com:465` (SSL) |
| Auth | **Authorization code** (not the login password) |
| Read mode | Polling on an interval (120s by default, configurable 30–3600) |

**The current implementation polls; it does not use IDLE.** This version ships a minimal IMAP client that is enough for the job (sign in, SELECT, FETCH the newest N messages) and does not implement IDLE push, so mail is read when `pollSeconds` elapses. Genuine server push with no polling requires adding the IDLE command and its reconnect handling to `imap.ts`; that is future work.

**Deduplication is by Message-ID**: the same mail is seen again on every poll, so only a `Message-ID` not seen before becomes a Trigger. Each mailbox keeps its own record (the newest 2000 ids), so two mailboxes sharing one implementation never interfere.

**Failure handling**:
```
A poll fails
   ↓
count +1, wait for the next interval
   ↓
consecutive failures reach failuresBeforeError (3 by default)
   ↓
the panel reports error and names the last error
```

**One successful poll resets the count**, so a single network interruption stays quiet.

### 5.3 Feishu

> Status: Implemented, not yet verified — this comes from the upstream implementation; no app credentials are configured on this machine (lark-cli is not bound), and the source reports `state: setup`.

**The CLI already exists**; app credentials are missing.

**Configuration**: a self-built app is required; obtain the App ID and App Secret.

**Capability**: event stream push + message send and receive.

### 5.4 GitHub (four-level mirror)

> Status: **Measured working** — the live instance on port 3080 returns `state: ready` from `/orchestrator/api/sources`, with `0 notifications; next poll ≥ 60s`.

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

> Status: Implemented, not yet verified — it shares the same IMAP + SMTP implementation as QQ Mail; a real app password has never been used on this machine, and the source reports `state: paused`.

**Technical points**:

| Item | Value |
|---|---|
| Receive | `imap.gmail.com:993` (SSL) |
| Auth | App-specific password (two-step verification must be on) |
| Network | **A proxy is required** (in some regions) |

**Note**: a direct connection to Gmail times out in some regions; a proxy is mandatory.

### 5.6 QQ

> Status: **Measured working** — the live instance on port 3080 returns `state: ready` from `/orchestrator/api/sources`, with `stats.received = 14` (real group messages).

**It goes through a OneBot v11 HTTP endpoint** (an implementation such as SnowLuma or NapCat): reading posts a poll and replying uses the same endpoint. It is not a WebSocket long connection, so there is no keepalive-heartbeat layer.

**What actually hardens it**:
- Deduplication by `message_id` (the newest 2000 per instance), so a message seen again on the next poll is not processed twice
- The panel reports an error only after `failuresBeforeError` consecutive failures (3 by default), so a single blip stays quiet
- In a group only a message that @s the agent counts by default; with `observeAll` on, the Policy's admission table decides
- Each instance runs its own polling loop, so a dead endpoint never slows a live one

**Note**: OneBot offers no push cursor, so recent messages are read on an interval and `pollSeconds` (5s by default) is the latency ceiling.

### 5.7 WeChat (depends on a OneBot bridge on the WeChat side)

> Status: implemented, not yet verified — it reuses the OneBot protocol implementation, this machine has no WeChat bridge, `state: setup`, and it has never connected.

**What it actually is**: the same code as QQ and WeCom (the `oneBotKind()` factory, `kind: 'wechat'`). This plugin **only polls over HTTP and sends replies**; it does not touch the WeChat client. The bridge has to be started by a OneBot implementation on the WeChat side first.

**Why it depends on something external the most**:

| Item | Note |
|---|---|
| Protocol | OneBot v11 HTTP, endpoint provided by your WeChat bridge |
| Prerequisite | A working OneBot bridge on the WeChat side; this plugin does not start one |
| Ceiling | If the bridge drops, this plugin can only report the state, not restart it for you |

**What this plugin does provide** (all in `src/sources/qq.ts`):

| Mechanism | Behaviour |
|---|---|
| Retry on a failed poll | a single failure raises nothing; the next poll simply tries again |
| Consecutive-failure count | only after `failuresBeforeError` in a row (3 by default) does health become `error` |
| Deduplication | by `message_id`, last 2000 remembered per instance |
| Health state | the panel shows `ready` / `error` / `setup` with "N new messages, next poll in ≥ N s" |

**What is not built**: process supervision, port arbitration, circuit breaking, UIAutomation window reading — none of these is in this repository. If your WeChat bridge drops, that is the bridge's problem to solve.

#### Why the table says `Not rated` rather than some number of stars

This path has never connected on this machine, not once. Putting stars on something unmeasured means making a judgement on the reader's behalf that I have no evidence for.

## 6. Health Status

Every Source reports a health status:

| Status | Meaning | Panel color |
|---|---|---|
| `ready` | Running normally | Green |
| `starting` | Starting up | Blue |
| `setup` | Not fully configured yet (missing credentials or link) | Gray |
| `paused` | Paused (configuration incomplete) | Gray |
| `error` | Errored | Orange |
| `degraded` | Degraded (circuit open) | Red |

**Status is broken down by component** (the block below is only an illustration, not what this machine reports; see the observation table at the end of this section for that):

```
runtime  : ready     ← the host layer
github   : error     ← the business layer; this is the one that matters
email    : ready
```

**Note**: `runtime: ready` does not mean the Source is fine. **You must look at the business layer.**

**What is actually observed on this machine** (from the live instance on port 3080, `/orchestrator/api/sources`):

| Source | Observed state | Meaning |
|---|---|---|
| GitHub | `ready` | `0 notifications; next poll ≥ 60s` |
| QQ | `ready` | `stats.received = 14`, real group messages |
| Email | `paused` | `code: mailUnconfigured`, no real authorization code entered |
| WeChat | `setup` | no WeChat bridge on this machine |
| WeCom | `setup` | no link at all |
| Feishu | `setup` | app credentials not configured (lark-cli not bound) |

`ready` means the Source really is running under the current configuration; `paused` / `setup` means the code is there but the configuration is not finished — **not** "usable".

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
| **Implementation status** | Implemented, not yet verified | Implemented, not yet verified | Implemented, not yet verified | **Measured working** | Implemented, not yet verified | **Measured working** | Implemented, not yet verified |
| Stability | Not rated | Not rated | Not rated | ★★★★★ | Not rated | ★★★★☆ | Not rated |
| Setup difficulty | Low | Low | Medium | Low | Medium | Low | High |
| Requires | Corp account | Auth code | An app | Nothing | Two-step verification | Nothing | Authorization |
| Async friendliness | Medium | **High** | Medium | Medium | High | Low | Low |
| Recommendation | High | **Highest** | High | Essential | Depends | High | Fallback |

**The "Stability" row rates measured Sources only**: GitHub and QQ have observations from this machine and therefore carry stars; the other five read `Not rated` because they had not connected here even once when this was written. Setup difficulty, Requirements, Async friendliness and Recommendation are judgments based on protocol characteristics, not measured results.

**If you connect only one, choose QQ Mail**: the best scenario fit (asynchronous, carries a sender, groups into Threads), the fewest dependencies, a standard protocol. Note that this link has not yet been connected on this machine with a real authorization code — the first setup needs you to enter the code and run one connection test.

---

[← Previous: Settings UI](04-settings.md) | [Back to README](../README.md) | [Next: Proxy Scheme →](06-proxy.md)
