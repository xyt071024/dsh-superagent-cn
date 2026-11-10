# 04 · Settings UI Design

[← Previous: Multi-Session Collaboration](03-collaboration.md) | [Back to README](../README.md) | [Next: Sources →](05-sources.md)

---

The settings page uses an **eight-group** layout: navigation on the left, content on the right. Every capability can be adjusted in the UI; no config file editing is needed.

---

## Overall Structure

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Super Agent Settings                                                          [Save] │
├──────────────────────────┼───────────────────────────────────────────────────────────┤
│ ▸ Basics                 │                                                           │
│ ▸ Models & compute       │ Content area of the current group                         │
│ ▸ Execution mode         │                                                           │
│ ▸ Sources                │                                                           │
│ ▸ Proxy                  │                                                           │
│ ▸ Permissions & security │                                                           │
│ ▸ Self-evolution         │                                                           │
│ ▸ Advanced               │                                                           │
└──────────────────────────┴───────────────────────────────────────────────────────────┘
```

---

# Group 1: Basics

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│   Basics                                                                             │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   Enabled status                                                   [ ●──── ] Enabled │
│                                                                                      │
│   Run mode                                                                           │
│    ⦿ Integrated (installed into the existing DSH, one more entry)                    │
│    ○ Standalone (a separate, plain DSH)                                              │
│                                                                                      │
│   Data directory                                                                     │
│    [ <home>/.dsh/state/superagent        ] [Browse]                                  │
│                                                                                      │
│   Panel port                                                                         │
│    [ 3082 ]                                                                          │
│                                                                                      │
│   UI language                                                                        │
│    [ Simplified Chinese   ▾ ]   ○Chinese ○English ○Japanese                          │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Field Reference

| Field | Type | Description |
|---|---|---|
| Enabled status | Toggle | Turning it off stops the process |
| Run mode | Radio | Integrated / standalone; switching requires redeployment |
| Data directory | Path | The database, working directories and logs all live here |
| Panel port | Number | 3082 by default; a conflict is flagged automatically |
| UI language | Dropdown | Chinese / English / Japanese |

---

# Group 2: Models & Compute

**This is the most important group.**

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│   Models & compute                                                                   │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│ ┏━ Model authorization scope ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃                                                                                ┃   │
│ ┃ Allowed models (pinnable to a version):                                        ┃   │
│ ┃                                                                                ┃   │
│ ┃ ▼ DeepSeek                                                                     ┃   │
│ ┃    ☑ deepseek-v4-pro          [budget ¥___/day]                                ┃   │
│ ┃    ☑ deepseek-v4.1-flash      [budget ¥___/day]                                ┃   │
│ ┃    ☐ deepseek-v3                                                               ┃   │
│ ┃                                                                                ┃   │
│ ┃ ▼ Moonshot (Kimi)                                                              ┃   │
│ ┃    ☑ kimi-k2-turbo            [budget ¥___/day]                                ┃   │
│ ┃    ☐ kimi-k2-thinking                                                          ┃   │
│ ┃                                                                                ┃   │
│ ┃ ▼ Anthropic                                                                    ┃   │
│ ┃    ☐ claude-opus-4                                                             ┃   │
│ ┃    ☑ claude-sonnet-4          [budget ¥___/day]                                ┃   │
│ ┃                                                                                ┃   │
│ ┃ ▼ OpenAI                                                                       ┃   │
│ ┃    ☐ gpt-5                                                                     ┃   │
│ ┃    ☑ gpt-5-mini               [budget ¥___/day]                                ┃   │
│ ┃                                                                                ┃   │
│ ┃ ▼ Local / free                                                                 ┃   │
│ ┃    ☑ Free-tier channel models                                                  ┃   │
│ ┃    ☐ Local models (LM Studio / Ollama)                                         ┃   │
│ ┃                                                                                ┃   │
│ ┃ [+ Add a custom provider]                                                      ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
│ ┏━ Model usage policy ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃                                                                                ┃   │
│ ┃ ⦿ Unified model: every session uses the same one                               ┃   │
│ ┃      model     [ deepseek-v4-pro   ▾ ]                                         ┃   │
│ ┃      thinking  [ high              ▾ ]                                         ┃   │
│ ┃                                                                                ┃   │
│ ┃ ○ Tiered models: picked automatically by task difficulty                       ┃   │
│ ┃      simple   → [ deepseek-v4.1-flash ▾ ] [low ▾]                              ┃   │
│ ┃      medium   → [ deepseek-v4-pro     ▾ ] [medium ▾]                           ┃   │
│ ┃      complex  → [ kimi-k2-turbo       ▾ ] [high ▾]                             ┃   │
│ ┃      extreme  → [ claude-sonnet-4     ▾ ] [max ▾]                              ┃   │
│ ┃                                                                                ┃   │
│ ┃ ○ Multi-model parallel: a different model per sub-session                      ┃   │
│ ┃      sub-session A → [ kimi-k2-turbo    ▾ ] [high ▾]                           ┃   │
│ ┃      sub-session B → [ claude-sonnet-4  ▾ ] [medium ▾]                         ┃   │
│ ┃      sub-session C → [ deepseek-v4-pro  ▾ ] [high ▾]                           ┃   │
│ ┃      [+ Add sub-session config]                                                ┃   │
│ ┃      rotation [ sequential ▾ ] / [ by difficulty ▾ ] / [ random ▾ ]            ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
│ ┏━ Thinking depth ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃                                                                                ┃   │
│ ┃ Main session          [ high    ▾ ]                                            ┃   │
│ ┃ Sub-session default   [ medium  ▾ ]                                            ┃   │
│ ┃ Difficulty pre-judge  [ lowest  ▾ ]   ← cost-control key                       ┃   │
│ ┃ Self-evolution        [ max     ▾ ]                                            ┃   │
│ ┃                                                                                ┃   │
│ ┃ ☑ Allow thinking depth to be adjusted automatically per task                   ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
│ ┏━ Cost control plan ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃                                                                                ┃   │
│ ┃ ☑ Task difficulty pre-judgment (probe with a small model first)               ┃    │
│ ┃ ☑ Result cache (the same task is never redone)                                 ┃   │
│ ┃ ☑ Auto-downgrade when the budget is exceeded mid-run                           ┃   │
│ ┃                                                                                ┃   │
│ ┃ Daily cap       [ ¥ 50 ]   ⚠ when exceeded [ pause ▾ ]                         ┃   │
│ ┃ Monthly cap     [ ¥ 1000 ]                                                     ┃   │
│ ┃ Current usage   ¥ 12.4 / ¥ 50 (24.8%)                                          ┃   │
│ ┃ ▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░                                               ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Comparison of the Three Policies

| Policy | Pros | Cons | Suited to |
|---|---|---|---|
| **Unified model** | Cheap, predictable | Poor on hard problems | Homogeneous tasks |
| **Tiered models** | Pay as needed | Tiers must be configured | Most scenarios |
| **Multi-model parallel** | Best results | Most expensive | Critical tasks |

### What Thinking Depth Does

Thinking depth directly affects token consumption and reasoning quality:

| Level | Relative cost | Suited to |
|---|---|---|
| Lowest | 1x | Difficulty pre-judgment, classification |
| Low | 2x | Simple rewrites, formatting |
| Medium | 4x | Routine coding |
| High | 8x | Complex logic, architecture design |
| Max | 16x | Very hard reasoning, self-evolution |

**Using "lowest" for difficulty pre-judgment is the key to cost control**: a 50-token judgment avoids hundreds of tokens of wasted work.

---

# Group 3: Execution Mode

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│   Execution mode                                                                     │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│ ┏━ Run state ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃                                                                                ┃   │
│ ┃ ⦿ Conversational: runs only while you are talking to it                        ┃   │
│ ┃ ○ Silent: the process stays resident, wakes up on a message                    ┃   │
│ ┃ ○ Dual: both at once                                                           ┃   │
│ ┃                                                                                ┃   │
│ ┃ Silent-mode wake-up conditions:                                                ┃   │
│ ┃    ☑ Email received      ☑ QQ message                                          ┃   │
│ ┃    ☑ WeCom message       ☑ GitHub @-mention                                    ┃   │
│ ┃    ☑ Feishu message      ☐ WeChat message (client required)                    ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
│ ┏━ Execution location ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃                                                                                ┃   │
│ ┃ ⦿ Foreground: a window opens, you can watch it work                            ┃   │
│ ┃ ○ Background: fully in the background, never in your way                       ┃   │
│ ┃ ○ Decided by the task: simple ones in the background,                          ┃   │
│ ┃    complex ones asked in the foreground                                        ┃   │
│ ┃                                                                                ┃   │
│ ┃ In background mode:                                                            ┃   │
│ ┃    ☑ Notify me when done                                                       ┃   │
│ ┃    ☑ Only pop up when something cannot be decided                              ┃   │
│ ┃    ☐ Stay silent throughout, records only in the panel                         ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
│ ┏━ Multi-session collaboration (sub-sessions) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃                                                                                ┃   │
│ ┃ ☑ Allow the main session to open sub-sessions automatically                    ┃   │
│ ┃                                                                                ┃   │
│ ┃ Max sub-sessions        [ 6 ]                                                  ┃   │
│ ┃ Difficulty threshold    [ medium ▾ ]   (split only above this)                 ┃   │
│ ┃                                                                                ┃   │
│ ┃ ☑ Sub-sessions may talk to each other                                          ┃   │
│ ┃ ☑ Shared task board (each sees the others' progress)                           ┃   │
│ ┃ ☑ Mutual rescue allowed (one gets stuck, another takes over)                   ┃   │
│ ┃      rescue mode [ take over after reading the log ▾ ]                         ┃   │
│ ┃ ☑ Mutual help when done (whoever finishes helps the rest)                      ┃   │
│ ┃                                                                                ┃   │
│ ┃ Heartbeat interval      [ 30 s ]                                               ┃   │
│ ┃ Stuck criterion         [ 90 s without heartbeat ]                             ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
│ ┏━ Regression verification ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃ ☑ After all sub-sessions finish, the main session runs the                     ┃   │
│ ┃    final regression                                                            ┃   │
│ ┃ ☑ If the regression fails, hand back to that sub-session to fix                ┃   │
│ ┃ Max handback rounds     [ 3 ]                                                  ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Why "Execution Location" Matters

| Mode | Experience | Suited to |
|---|---|---|
| **Foreground** | You can watch it work step by step | You want to learn, or you are uneasy |
| **Background** | No interruption, notified when done | Everyday use |
| **Decided by the task** | Simple ones silent, complex ones ask | Balanced |

**This option is for you, not for it.** You can change it at any time.

### The Difference Between the Three Run States

| State | Process | UI | Compute (when idle) |
|---|---|---|---|
| Conversational | Started on demand | Yes | 0 |
| Silent | Resident | No | Close to 0 (waiting for events) |
| Dual | Resident | Yes | Close to 0 (waiting for events) |

---

# Group 4: Sources

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│   Sources                                                                            │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Status  Platform    Connection        Health   Actions                              │
│  ───────────────────────────────────────────────────────────                         │
│  🟢      GitHub      CLI + mirror      ●●●●●    [Config] [Stop]                      │
│  🟢      Feishu      CLI               ●●●●●    [Config] [Stop]                      │
│  🟢      WeCom       official API      ●●●●●    [Config] [Stop]                      │
│  🟢      QQ Mail     IMAP/SMTP         ●●●●●    [Config] [Stop]                      │
│  🟡      Gmail       IMAP              ●●●●○    [Config] [Stop]                      │
│  🟡      QQ          WebSocket         ●●●●○    [Config] [Stop]                      │
│  🟠      WeChat      local client      ●●●●○    [Config] [Stop]                      │
│                                                                                      │
│ [+ Add a custom source]                                                              │
│                                                                                      │
│ ┏━ Selected source: GitHub ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃                                                                                ┃   │
│ ┃ Repository     [ owner/repo               ]                                    ┃   │
│ ┃ CLI path       [ <path>/gh-wrapper         ]                                   ┃   │
│ ┃ Poll interval  [ 60 s ]                                                        ┃   │
│ ┃                                                                                ┃   │
│ ┃ Receive scope:                                                                 ┃   │
│ ┃    ☑ New issue      ☑ New PR                                                   ┃   │
│ ┃    ☑ Comments       ☑ CI status                                                ┃   │
│ ┃                                                                                ┃   │
│ ┃ Mirror fallback:                                                               ┃   │
│ ┃    ☑ Primary site                                                              ┃   │
│ ┃    ☑ Mirror 1 (acceleration proxy)                                             ┃   │
│ ┃    ☑ Mirror 2 (local cache)                                                    ┃   │
│ ┃    ☑ Mirror 3 (packaged download)                                              ┃   │
│ ┃                                                                                ┃   │
│ ┃ [Test connection]   [Re-authorize]                                             ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**Detailed configuration for each source is in [Sources and Stability](05-sources.md).**

---

# Group 5: Proxy

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│   Proxy settings                                                                     │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│ ┏━ Proxy priority ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃                                                                                ┃   │
│ ┃ ⦿ Auto: user proxy → system proxy → built-in → direct                          ┃   │
│ ┃ ○ Use only the specified proxy                                                 ┃   │
│ ┃ ○ Direct connection only                                                       ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
│ ┏━ 1. Your own proxy ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃                                                                                ┃   │
│ ┃ ☑ Enabled                                                                      ┃   │
│ ┃                                                                                ┃   │
│ ┃ Option 1: fill it in manually                                                  ┃   │
│ ┃    HTTP    [ http://127.0.0.1:____     ]                                       ┃   │
│ ┃    SOCKS5  [ socks5://127.0.0.1:____   ]                                       ┃   │
│ ┃                                                                                ┃   │
│ ┃ Option 2: drop the program here for auto-detection                             ┃   │
│ ┃   ┌──────────────────────────────────────────────────────┐                     ┃   │
│ ┃   │                                                      │                     ┃   │
│ ┃   │    Drop the proxy program's exe or folder here       │                     ┃   │
│ ┃   │                                                      │                     ┃   │
│ ┃   │            [ drag area / click to choose ]           │                     ┃   │
│ ┃   │                                                      │                     ┃   │
│ ┃   └──────────────────────────────────────────────────────┘                     ┃   │
│ ┃                                                                                ┃   │
│ ┃ Detected proxies: (auto-scanned, listed here)                                  ┃   │
│ ┃    ● Proxy A   <path>            [Config][Test]                                ┃   │
│ ┃    ● Proxy B   <path>            [Config][Test]                                ┃   │
│ ┃                                                                                ┃   │
│ ┃ ☑ Start detected proxies automatically                                         ┃   │
│ ┃ ☑ Handle prompts automatically (watch an ad, click confirm)                    ┃   │
│ ┃ ☑ Connect automatically when not connected                                     ┃   │
│ ┃ ☑ Retry automatically on failure (at most [ 3 ] times)                         ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
│ ┏━ 2. System proxy ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃ ☑ Use the system proxy automatically when one is detected                      ┃   │
│ ┃ Current system proxy:  not enabled                                             ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
│ ┏━ 3. Built-in proxy ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃                                                                                ┃   │
│ ┃ ☐ Enable the built-in proxy                                                    ┃   │
│ ┃                                                                                ┃   │
│ ┃ Node source:                                                                   ┃   │
│ ┃    ○ Use a subscription I provide [______________] [Import]                    ┃   │
│ ┃    ○ Reuse an existing local proxy                                             ┃   │
│ ┃    ○ Built-in free node pool                                                   ┃   │
│ ┃                                                                                ┃   │
│ ┃ ⚠ About free nodes: most public free nodes are not clean                       ┃   │
│ ┃     · IPs are shared by many; mainstream services reject them                  ┃   │
│ ┃     · your credentials are at risk of interception                             ┃   │
│ ┃     · use your own subscription, or reuse a local proxy                        ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
│ ┏━ 4. Per-domain policy ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃                                                                                ┃   │
│ ┃ Domain                   Use proxy?   Which one                                ┃   │
│ ┃ ─────────────────────────────────────────────────────                          ┃   │
│ ┃ api.github.com              ☑        [ auto ▾ ]                                ┃   │
│ ┃ raw.githubusercontent       ☑        [ auto ▾ ]                                ┃   │
│ ┃ imap.gmail.com              ☑        [ auto ▾ ]                                ┃   │
│ ┃ imap.qq.com                 ☐        [ direct ▾ ]                              ┃   │
│ ┃ WeCom API                   ☐        [ direct ▾ ]                              ┃   │
│ ┃ Feishu API                  ☐        [ direct ▾ ]                              ┃   │
│ ┃                                                                                ┃   │
│ ┃ ☑ Unlisted domains go direct by default                                        ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**The full explanation of the proxy scheme is in [Proxy Scheme](06-proxy.md).**

---

# Group 6: Permissions & Security

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│   Permissions & security                                                             │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│ ┏━ Who may assign work ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃                                                                                ┃   │
│ ┃ GitHub accounts                                                                ┃   │
│ ┃    ● <account 1>               [Remove]                                        ┃   │
│ ┃    [+ Add]                                                                     ┃   │
│ ┃                                                                                ┃   │
│ ┃ Email addresses                                                                ┃   │
│ ┃    [____________________]   [+ Add]                                            ┃   │
│ ┃                                                                                ┃   │
│ ┃ QQ numbers                                                                     ┃   │
│ ┃    ● <number>                  [Remove]                                        ┃   │
│ ┃                                                                                ┃   │
│ ┃ WeCom / Feishu                                                                 ┃   │
│ ┃    [+ Add]                                                                     ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
│ ┏━ Unified contact center ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃ ☑ Enable cross-platform identity recognition                                   ┃   │
│ ┃                                                                                ┃   │
│ ┃ One person across platforms:                                                   ┃   │
│ ┃ ┌──────────────────────────────────────────────────────────┐                   ┃   │
│ ┃ │ Identity "me"                                            │                   ┃   │
│ ┃ │  · GitHub:   <account>                                   │                   ┃   │
│ ┃ │  · QQ:       <number>                                    │                   ┃   │
│ ┃ │  · Email:    <address>                                   │                   ┃   │
│ ┃ │  · WeCom:    (not bound)                                 │                   ┃   │
│ ┃ │  · Feishu:   (not bound)                                 │                   ┃   │
│ ┃ └──────────────────────────────────────────────────────────┘                   ┃   │
│ ┃ [+ Add identity]                                                               ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
│ ┏━ Autonomous permissions (granted item by item) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃                                                                                ┃   │
│ ┃ ☑ Accept explicit requests on its own (an allowlisted person names it)         ┃   │
│ ┃ ☐ Accept inferred requests on its own (nobody named it, it judges)             ┃   │
│ ┃ ☐ Install plugins on its own                                                   ┃   │
│ ┃ ☐ Install skills on its own                                                    ┃   │
│ ┃ ☐ Change its own code on its own                                               ┃   │
│ ┃ ☐ Open PRs against its own repository on its own                               ┃   │
│ ┃ ☐ Merge PRs on its own                                                         ┃   │
│ ┃ ☐ Send email on its own                                                        ┃   │
│ ┃ ☐ Send IM messages on its own                                                  ┃   │
│ ┃ ☐ Delete files on its own                                                      ┃   │
│ ┃ ☐ Run shell commands on its own                                                ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
│ ┏━ Second confirmation for dangerous actions ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃ ☑ Delete files      ☑ Change config                                            ┃   │
│ ┃ ☑ Push code         ☑ Send external messages                                   ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
│ ┏━ Blocked commands ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃ [ command pattern 1       ] [×]                                                ┃   │
│ ┃ [ command pattern 2       ] [×]                                                ┃   │
│ ┃ [____________________] [+]                                                     ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### About the Unified Contact Center

The official design **deliberately does not** map identities across sources. This project adds that layer, because "the same person counts as allowlisted everywhere" is a hard requirement.

```json
{
  "uid": "owner",
  "identities": {
    "github": ["<account>"],
    "email": ["<address>"],
    "qq": ["<number>"],
    "wecom": ["<account>"],
    "feishu": ["<open_id>"]
  },
  "policy": {
    "canRequest": true,
    "canProactive": false
  }
}
```

### Why Autonomous Permissions Are Split Item by Item

**"Allow it to act autonomously" is not one yes/no question; it is a dozen yes/no questions.**

| Permission | Risk |
|---|---|
| Accept inferred requests on its own | May do things you did not want |
| Install plugins on its own | May pull in untrusted code |
| Change its own code | May break itself |
| Send messages on its own | May say the wrong thing |
| Delete files on its own | Irreversible |

**Recommendation**: turn everything off first, observe for a week, then enable item by item.

---

# Group 7: Self-Evolution

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│   Self-evolution                                                                     │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│ ┏━ Self-check and retrospective ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃ ☑ Self-retrospective after every completed task                                ┃   │
│ ┃ ☑ Record lessons in the lesson library                                         ┃   │
│ ┃ ☑ Periodic consolidation (every [ 7 ] days)                                    ┃   │
│ ┃                                                                                ┃   │
│ ┃ Lesson library    [ <stateDir>/lessons/ ]                                      ┃   │
│ ┃ Current entries   [ 0 ]                                                        ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
│ ┏━ Code self-optimization ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃                                                                                ┃   │
│ ┃ ☑ Scan its own code for redundancy                                             ┃   │
│ ┃ ☑ Suggest a merge when duplicated code is found                                ┃   │
│ ┃ ☑ Suggest a removal when dead code is found                                    ┃   │
│ ┃                                                                                ┃   │
│ ┃ Change method:                                                                 ┃   │
│ ┃    ⦿ Through a PR, wait for my review                                          ┃   │
│ ┃    ○ Directly (not recommended)                                                ┃   │
│ ┃                                                                                ┃   │
│ ┃ Scan frequency  [ weekly ▾ ]                                                   ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
│ ┏━ Capability extension ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃ ☐ Let it install plugins itself (also enable it on the permissions page)       ┃   │
│ ┃ ☐ Let it write skills itself                                                   ┃   │
│ ┃ ☑ Suggest when a capability is missing, wait for my decision                   ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**Mechanism details are in [Self-Evolution](07-evolution.md).**

---

# Group 8: Advanced

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│   Advanced                                                                           │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│ ┏━ Execution environment ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃ prepare command    [ git worktree add ... ]                                    ┃   │
│ ┃ Concurrency cap    [ 3 ]                                                       ┃   │
│ ┃ Per-task directory [ <stateDir>/work/ ]                                        ┃   │
│ ┃ ☑ Isolate process environment variables (mandatory in integrated mode)         ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
│ ┏━ Stability ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃ ☑ Process watchdog (liveness probe every 15 s)                                 ┃   │
│ ┃ ☑ Port arbitration (cleans up zombie processes automatically)                  ┃   │
│ ┃ ☑ Circuit breaker (degrade after [ 5 ] consecutive failures)                   ┃   │
│ ┃ ☑ Message deduplication                                                        ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
│ ┏━ Session limits ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃ IM message word ceiling  [ 100 ] words (hard limit, not configurable)          ┃   │
│ ┃ Eval timeout             [ 120 ] s                                             ┃   │
│ ┃ Max background work      [ 30 ] min                                            ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
│ ┏━ Maintenance ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃ [Export config]   [Import config]   [Back up data]   [Clear data]              ┃   │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Why "Isolate Process Environment Variables" Matters

This plugin modifies the process's `PATH`, inserting the `gh` and `lark-cli` wrapper scripts at the front.

**In integrated mode this affects other plugins in the same process.** With isolation enabled, it uses its own environment internally and does not pollute the global one.

**Integrated mode must have this enabled.**

---

# Main Panel (Not Settings)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Super Agent                                            [● Silent]  [⚙ Settings]  [⟳] │
├───────────────────────────────────────┼──────────────────────────────────────────────┤
│                                       │                                              │
│  Needs you (2)                        │  System health                               │
│   ┌──────────────────────────────────┐│    runtime   ● ready                         │
│   │ ⚠ #12 needs your answer          ││    github    ● ready                         │
│   │    "Which branch?"               ││    email     ● ready                         │
│   │                 [View]           ││    wecom     ● ready                         │
│   └──────────────────────────────────┘│    proxy     ● not configured                │
│   ┌──────────────────────────────────┐│                                              │
│   │ 👀 #15 needs your review         ││  Today                                       │
│   │    "Done, PR #23"                ││    12 received                               │
│   │                 [View]           ││    8 accepted                                │
│   └──────────────────────────────────┘│    6 completed                               │
│                                       │    ¥12.4 spent                               │
│  In progress (3)                      │                                              │
│   ┌──────────────────────────────────┐│  Executors                                   │
│   │ #18 working                45%   ││    ▓▓▓░░  3/6 running                        │
│   └──────────────────────────────────┘│                                              │
│   ┌──────────────────────────────────┐│                                              │
│   │ #19 queued                       ││                                              │
│   └──────────────────────────────────┘│                                              │
│                                       │                                              │
└───────────────────────────────────────┴──────────────────────────────────────────────┘
```

## Sub-Session Collaboration View

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│   Ticket #18 — sub-session view                                                      │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│ Main session   deepseek-v4-pro   high thinking     [progress 45%]                    │
│    │                                                                                 │
│    ├─ A   kimi-k2-turbo     high     🟢 running  60%                                 │
│    ├─ B   claude-sonnet-4   medium   🟡 waiting  20%                                 │
│    └─ C   deepseek-v4-pro   high     🔴 stuck     --   [take over]                   │
│                                                                                      │
│ Shared task board:                                                                   │
│   ┌──────────────────────────────────────────────────────┐                           │
│   │ Task            Owner   Status      Progress         │                           │
│   │ Analyze         A       ✅ done     100%             │                           │
│   │ Design          B       🟡 running  20%              │                           │
│   │ Write code      A       🟢 running  60%              │                           │
│   │ Write tests     C       🔴 stuck    --               │                           │
│   └──────────────────────────────────────────────────────┘                           │
│                                                                                      │
│ [Let A take over C]   [Restart C]   [View C's log]                                   │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

[← Previous: Multi-Session Collaboration](03-collaboration.md) | [Back to README](../README.md) | [Next: Sources →](05-sources.md)
