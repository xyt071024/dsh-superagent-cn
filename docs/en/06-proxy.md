# 06 · Proxy Architecture

[← Previous: Sources and Stability](05-sources.md) | [Back to README](../README.md) | [Next: Self-Evolution →](07-evolution.md)

---

## 1. Why a Proxy Is Needed

Some services are unstable when accessed from certain regions:

| Service | Problem |
|---|---|
| GitHub API | Intermittent timeouts |
| raw.githubusercontent.com | Frequently reset |
| Gmail IMAP | Times out on a direct connection |
| Some npm / pypi registries | Slow |

**Not every source needs a proxy.** Domestic WeCom, Feishu, QQ and QQ Mail are **fastest on a direct connection** — routing them through a proxy only makes them slower.

---

## 2. Three-Layer Architecture

```
┌───────────────────────────────────────────────┐
│  L1: User proxy (highest priority)            │
│  · Configured by the user                     │
│  · Manual entry / drag-and-drop detection     │
└───────────────────────────────────────────────┘
                  ↓ if absent
┌───────────────────────────────────────────────┐
│  L2: System proxy                             │
│  · Reads the proxy from system settings       │
│  · Windows: Internet Settings registry        │
└───────────────────────────────────────────────┘
                  ↓ if absent
┌───────────────────────────────────────────────┐
│  L3: Built-in proxy                           │
│  · Subscription provided by the user          │
│  · Or reuse an existing local proxy app       │
└───────────────────────────────────────────────┘
                  ↓ if none of the above
┌───────────────────────────────────────────────┐
│  L4: Direct connection                        │
└───────────────────────────────────────────────┘
```

**Priority**: user proxy > system proxy > built-in proxy > direct

---

## 3. User Proxy: Two Ways to Configure

### 3.1 Manual Entry

```
HTTP   [ http://127.0.0.1:____ ]
SOCKS5 [ socks5://127.0.0.1:____ ]
```

Suited to users who already know their proxy port.

### 3.2 Drag-and-Drop Detection (No Setup Knowledge Needed)

```
┌───────────────────────────────────────────────┐
│                                               │
│   Drag the proxy app's executable file or     │
│   folder here                                 │
│                                               │
│        [ drag area / click to select ]        │
│                                               │
└───────────────────────────────────────────────┘
```

**Detection flow**:

```
User drops a file / folder
   ↓
1. Scan the directory structure and identify the app type
   · Look at the executable name (signatures of known apps)
   · Look at config files (config.json / clash.yaml, etc.)
   · Look at process names
   ↓
2. Find the proxy port in its configuration
   · Read it from the config file
   · Or probe common default ports (7890 / 1080 / 7891, etc.)
   ↓
3. Test whether the port actually works
   · Try to connect
   · Try to reach a test address through it
   ↓
4. Success → save the configuration
   Failure → show "Recognized X, but the port is unreachable, please fill it in manually"
```

**Types that support automatic detection** (examples; matching is by signature in practice):

| Type | Signature |
|---|---|
| Config-driven | Has `config.yaml` / `config.json` containing a port field |
| GUI client | Has a GUI, with the port written in its settings |
| Command line | Has a kernel executable, with the port in its arguments |

### 3.3 Auto Start and Takeover

```
Detected that the proxy is not running
   ↓
☑ Auto-start the recognized proxy
   ↓
Launch the program (may need to wait for the GUI to come up)
   ↓
⚠ If interaction is required (login / watch an ad / click confirm)
   ↓
☑ Complete the interaction automatically
   ↓
Open it in the built-in browser and click the necessary buttons
   ↓
Wait for the connection to be established (probe the port + test request)
   ↓
Start working once it succeeds
```

**A note on "watch the ad automatically"**:

Some free proxies require you to watch an ad before they connect. The way to automate that is:

1. Open its interface (the built-in browser if it is web-based)
2. Wait for the ad timer to finish
3. Click "Skip" or "Close" automatically
4. Confirm that the connection is established

**This requires per-app adaptation** and is not a general capability. The UI must state clearly: "Only adapted apps are supported."

---

## 4. System Proxy

```
Read the system proxy settings
   ↓
Windows: HKEY_CURRENT_USER\...\Internet Settings
   · ProxyEnable
   · ProxyServer
   ↓
If enabled → use it
If disabled → skip
```

**Detection is on by default**, because most users who run a proxy app also have it set the system proxy automatically.

---

## 5. Built-In Proxy

### 5.1 Three Node Sources

| Source | Description | Recommended |
|---|---|---|
| **Subscription provided by the user** | Paste a subscription link, nodes are pulled automatically | ★★★★★ |
| **Reuse the existing local one** | Use a proxy program that was recognized | ★★★★★ |
| **Built-in free node pool** | Ships with a batch of public nodes | ⚠ see below |

### 5.2 About Free Nodes — This Has to Be Said Clearly

**The overwhelming majority of public free nodes are not clean.**

| Risk | Description |
|---|---|
| **IP shared by many** | One IP may be used by tens of thousands of people; mainstream services will reject it or ban the account |
| **Credentials may be intercepted** | The proxy operator can see all of your traffic, including tokens and authorization codes |
| **Expires at any moment** | Free nodes usually live for hours, not days |
| **Unstable speed** | Can be slower than a direct connection |

**Where this project stands**:

- The option exists, but is **off by default**
- The UI shows the risk warning explicitly
- **No nodes of unknown origin are bundled**
- Users are advised to use their own subscription or reuse an existing proxy

**If you really must use free nodes**:
- Use them only for public content (never send credentials through them)
- Route critical operations (GitHub pushes, mailbox polling) through your own proxy

### 5.3 Node Health Checks

```
Node joins the pool
   ↓
Periodic test (every 30 minutes)
   · Can it connect
   · What is the latency
   · Can it reach the target service
   ↓
Score
   ↓
Scheduling prefers high-scoring nodes
   ↓
3 consecutive failures → temporarily removed from the pool
```

---

## 6. Per-Domain Policy

**Not all traffic should go through a proxy.**

```
┌───────────────────────────────────────────────┐
│  Domain                  Proxy?   Which       │
├───────────────────────────────────────────────┤
│  api.github.com            ☑      auto        │
│  raw.githubusercontent     ☑      auto        │
│  github.com                ☑      auto        │
│  imap.gmail.com            ☑      auto        │
│  smtp.gmail.com            ☑      auto        │
│  imap.qq.com               ☐      direct      │
│  smtp.qq.com               ☐      direct      │
│  WeCom API                 ☐      direct      │
│  Feishu API                ☐      direct      │
│  qq.com                    ☐      direct      │
│  bilibili.com              ☐      direct      │
├───────────────────────────────────────────────┤
│  ☑ Unlisted domains default to direct         │
└───────────────────────────────────────────────┘
```

**Why domestic services go direct**: routing them through a proxy takes a detour, adds latency, and burns proxy bandwidth for nothing.

---

## 7. Failure Handling

### 7.1 Tiered Retry

```
Request fails
   ↓
Retry 1: immediately (switch node)
   ↓ fails
Retry 2: after 1 second (switch node)
   ↓ fails
Retry 3: after 3 seconds (switch node)
   ↓ fails
Degrade: try a direct connection
   ↓ fails
Report the failure (with the attempt log)
```

### 7.2 Circuit Breaker

```
A proxy fails 5 times in a row
   ↓
Marked unavailable (cooldown 10 minutes)
   ↓
All requests go through other proxies or direct during that window
   ↓
Retest after 10 minutes
```

### 7.3 Fail Fast

**Do not wait too long on a broken proxy.**

```
Connect timeout: 5 seconds
Read timeout: 30 seconds
Total timeout: 60 seconds
```

---

## 8. Interface

```
proxy.resolve({
  target: 'api.github.com',
  prefer: 'user' | 'system' | 'builtin' | 'direct' | 'auto'
})
→ {
    agent,              // the actual connection config
    protocol: 'http' | 'socks5' | 'direct',
    source: 'user' | 'system' | 'builtin' | 'direct',
    node: 'node identifier (when built-in)'
  }
```

**Callers only care about "can it connect", not "how it connects".**

---

## 9. UI Design

See [Settings UI · Group 5: Proxy](04-settings.md#group-5-proxy).

Key elements:

| Element | Purpose |
|---|---|
| Priority radio group | Auto / specified only / direct only |
| Manual entry | HTTP / SOCKS5 port |
| Drop zone | Drop a program in to detect it automatically |
| Detected list | Shows the proxies found and their status |
| Auto-start switch | Launches it when it is not running |
| Auto-interaction switch | Completes ad watching / confirmations automatically |
| Per-domain table | Configure each domain separately |

---

## 10. FAQ

### Q: I already run a proxy app — do I still need to configure anything here?

**Usually not.** As long as the proxy app sets the system proxy, this project detects it and uses it automatically.

If it does not set the system proxy (TUN mode only), a direct connection works anyway and nothing needs to be configured.

**When manual configuration is needed**: the proxy app neither sets the system proxy nor enables TUN — it only listens on a local port.

### Q: Will configuring a proxy affect other programs?

**No.** This project's proxy configuration only affects its own requests; it does not modify system settings.

### Q: Are free nodes usable?

**Not for anything involving credentials.** If you only look up public documentation now and then, they are worth considering; but GitHub pushes and mailbox polling must go through a trusted channel.

### Q: Why should domestic services be set to direct?

A proxy means traffic detours abroad and comes back, which adds significant latency. Domestic WeCom, Feishu and QQ are fastest on a direct connection.

---

[← Previous: Sources and Stability](05-sources.md) | [Back to README](../README.md) | [Next: Self-Evolution →](07-evolution.md)
