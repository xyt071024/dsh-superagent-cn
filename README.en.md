# Super Agent for DeepSeek Harness

[中文](README.md) | **English** | [日本語](README.ja.md)

---

### What this is

An **agent that looks for work**, running on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

A normal AI assistant: you ask, it answers.

This one: **it works while you are away**. An email arrives, someone mentions it on GitHub, a message comes in on QQ — it decides whether the work should be taken, what it can do within that scope, then does it and reports back.

### What it solves

| Your problem | How it handles it |
|---|---|
| Watching several platforms for new work | Seven entry points watch automatically; it calls you only when there is work |
| Not knowing whose request to trust | Three-layer authorization; only allow-listed people can request work |
| Complex tasks too big for one pass | Splits into sub-sessions with different models running in parallel |
| Repeating the same mistakes | Reflects after each task and keeps the lessons |
| Constant supervision | Silent while working; speaks only when needed |

### Where it connects

GitHub · QQ Mail · QQ · WeChat · Feishu · WeCom · Gmail

Configure as many as you need; one is enough to start.

### Two ways to run it

| Form | For |
|---|---|
| **Standalone** | Download, unzip, run. Everything bundled. |
| **Plugin** | Already have DSH? One command. |

### Is it reliable

**Authorization has two stages, and only the first is hard.** The **gate** is plain code: it looks at who sent the message, not what it says, so "ignore previous instructions" written inside a message cannot get past it. The **assessment** after it is a model judgement about whether the request should be taken and how far it may go — **that stage can be influenced by message content**. Do not confuse the two.

**Capabilities are honest.** It edits code, opens PRs, writes documents, researches. It does not install software for you, train models, or make design decisions.

### Documentation

| # | Document | Content |
|---|---|---|
| 01 | [Positioning and Core Concepts](docs/en/01-overview.md) | What it is, how authorization is designed |
| 02 | [Complete Task Flow](docs/en/02-flow.md) | What happens after a message arrives |
| 03 | [Multi-Session Collaboration](docs/en/03-collaboration.md) | How complex tasks split and cooperate |
| 04 | [Settings UI](docs/en/04-settings.md) | Eight groups, item by item |
| 05 | [Sources](docs/en/05-sources.md) | Seven platforms and how they stay connected |
| 06 | [Proxy](docs/en/06-proxy.md) | When you need it and how to set it |
| 07 | [Self-Evolution](docs/en/07-evolution.md) | How it learns from completed work |
| 08 | [Cost Control](docs/en/08-cost.md) | Keeping API spend predictable |
| 09 | [Deployment](docs/en/09-deployment.md) | Architecture and dependencies |

### How to install

#### Standalone (simplest)

```
1. Download the archive for your platform from Releases (~120MB)
2. Unzip anywhere
3. Run the launcher (Windows: double-click `start.cmd`; macOS/Linux: `chmod +x start.sh && ./start.sh`)
4. The panel opens in your browser
5. Follow the prompts to scan and sign in
```

**Node.js 22.19 or newer is required** (https://nodejs.org). The first launch installs itself into `~/.dsh/profiles/superagent`, after which the unzip folder can be deleted.

#### Plugin (for existing DSH users)

**One command**:

```powershell
## Windows
irm https://xyt071024.github.io/dsh-superagent-cn/install.ps1 | iex
```

```bash
## macOS / Linux
curl -fsSL https://xyt071024.github.io/dsh-superagent-cn/install.sh | bash
```

It checks the environment, creates a separate profile, installs the plugin, writes config, and starts the service.

**Nothing you already have is touched** — it lives in its own profile.

#### Requirements

| Item | Standalone | Plugin |
|---|---|---|
| OS | Win 10/11 / macOS 11+ / Linux | Same |
| Node.js | Required | 22.19+ or 24+ |
| DSH | Installed for you on first launch | 0.2.1-rc.1 ~ 0.2.2 |
| Disk | ~500MB | ~100MB |

#### Connect your accounts

Everything happens in the panel, by clicking and scanning:

```
Settings → Sources → pick a platform → follow the prompts
```

Each platform has a guided walkthrough telling you where to get credentials and how to enter them.

**Full steps: [Install & Connect](install.md)**

### About Purge Mode

> ## ⚠️ High risk — read this first
>
> Purge Mode **modifies the host program itself** — 86 patches to DSH, bypassing some built-in content limits.
>
> **Nothing is guaranteed**: output is unpredictable, DSH upgrades may break it, and compliance responsibility is entirely yours.
>
> **Use it only in an environment you own and whose consequences you accept.**

It is not our work; it integrates two upstream open-source projects (full attribution in [Credits](credits/README.md)).

Both standalone and plugin forms are available.

**Installation, recovery, troubleshooting: [Purge Mode](purge.md)**

### Credits

The core architecture comes from **DeepSeek's open-source [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)** by **DeepSeek Harness Team** (MIT, 2026-11-02, based on commit `8c32a9d`).

**The six-layer architecture and three-layer authorization design come from that project and are unchanged.** This project adds multi-source intake, multi-session collaboration, self-evolution, stability hardening, and localized documentation.

Full source list, upstream contributor roster, third-party notices: **[Credits & References](credits/README.md)**

### License

MIT

---
