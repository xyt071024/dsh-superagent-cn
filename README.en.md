<p align="center">
  <img src="assets/banner.svg" alt="Super Agent" width="820">
</p>

<h1 align="center">Super Agent</h1>

<p align="center">
  <strong>A proactive agent for DeepSeek Harness — it works when you don't ask.</strong>
</p>

<p align="center">
  <a href="README.md">中文</a> | <a href="README.en.md">English</a> | <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="https://github.com/xyt071024/dsh-superagent-cn/releases"><img src="https://img.shields.io/badge/release-v0.2.0-2ea44f" alt="release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="license"></a>
  <a href="https://xyt071024.github.io/dsh-superagent-cn/"><img src="https://img.shields.io/badge/docs-中文%20%7C%20EN%20%7C%20日本語-6f42c1" alt="docs"></a>
  <img src="https://img.shields.io/badge/Node-22.19%2B%20%7C%2024%2B-339933" alt="node">
  <img src="https://img.shields.io/badge/DSH-0.2.1--0.2.9-4b5563" alt="dsh">
</p>

---

**An ordinary assistant: you ask, it answers.**

**Super Agent: it works while you are away.** An email arrives, someone mentions it on GitHub, a message comes in on
QQ — it decides whether the work should be taken, how far it can go, then does it and reports back.

> Takes work from many sources → decides whether to accept → splits it across parallel child sessions → reports when done.
> Built on DeepSeek's open-source [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)
> (MIT), adding three message sources, multiple instances, routing, self-evolution, automatic context hand-off and a
> general-purpose tool surface.

---

## ✨ At a glance

- 📥 **Seven intakes, watched for you** — GitHub / QQ Mail / QQ / WeChat / WeCom / Feishu / Gmail. Configure one or all.
- 🚦 **Three-stage authorization** — gate (plain code, looks only at who sent it) / assessment (model judgement on whether to take it) / mandate (immutable)
- 🧠 **Splits the work** — a hard task goes to several child sessions, each free to run a different model
- 🗂️ **Automatic context hand-off** — at a configurable share of the window (65% by default) the session archives and hands over to a fresh context that continues rather than restarts
- 💰 **A spending ceiling** — a local daily token ledger; over the limit it takes no new work but lets running work finish
- 🔧 **A general-purpose tool surface** — code, documents, research, shell, **and installing plugins for itself**; it installs what it lacks instead of reporting the task impossible
- 📚 **Six built-in skills** — shell / install / research / delegate / verify / docs — the standing knowledge that shapes how it works
- 🔇 **Quiet by default** — it speaks only when a person has to decide something
- 🪶 **Two shapes** — a standalone bundle that runs from a zip, or one command into an existing DSH

---

## 🚀 Quick start

### Prerequisites

- **Node.js 22.19+ or 24+**
- **DeepSeek Harness** (needed for the plugin form; the standalone bundle brings its own profile)
- A GitHub CLI already signed in with `gh auth login` (for the GitHub source)

### Option 1 — plugin (DSH already installed)

```bash
dsh plugin add https://github.com/xyt071024/dsh-superagent-cn/releases/download/v0.2.0/Super-Agent-Plugin-Stable-v0.2.0.tgz
```

Restart DSH; a **Superagent** entry appears in the sidebar.

### Option 2 — standalone (runs from a zip)

Download `Super-Agent-Standalone-Windows-macOS-Linux-Stable-v0.2.0.zip` from [Releases](https://github.com/xyt071024/dsh-superagent-cn/releases), unzip it, and run `start.cmd` (Windows) or `./start.sh` (macOS / Linux).

The first run installs the profile into `~/.dsh/profiles/superagent` and picks a free port (3082–3182). **Read the panel address it prints** — that is your port, not a documented default.

### Then

Open the panel → **Superagent** in the sidebar → **Settings** → **Sources**, and configure one. Each platform has a
walkthrough telling you where to get the credentials and how to enter them.

Full steps: **[Install and connect](install.md)**.

---

## 📦 Where it can take work from

| Platform | Protocol | Status |
|---|---|---|
| **GitHub** | `gh` CLI notifications + polling | ✅ **measured working** |
| **QQ** | OneBot v11 HTTP | ✅ **measured working** |
| **QQ Mail** | IMAP polling + SMTP | implemented, not yet verified |
| **Gmail** | same | implemented, not yet verified |
| **WeChat** | OneBot v11 (via a WeChat bridge) | implemented, not yet verified |
| **WeCom** | OneBot v11 (via a WeCom bridge) | implemented, not yet verified |
| **Feishu** | CLI event stream + history polling | implemented, not yet verified |

**Only the rows marked measured have actually run here.** The rest are complete code that has never connected — a
claim without evidence is not written as a conclusion.

---

## 🧩 Features

<details>
<summary><b>Authorization and safety</b> (click to expand)</summary>

**Two stages, and only the first is hard.**

| Stage | Nature | What it does |
|---|---|---|
| Gate | **plain code** | looks at who sent the message, not what it says; "ignore previous instructions" cannot get past it |
| Assessment | model judgement | after the gate, the model decides whether to take the work and how far it may go — **this stage can be influenced by message content** |
| Mandate | immutable | issued when work is accepted; only a person can stop it, or a failed revalidation |

The hard guarantee is the first stage only. This project never claims that "no message content can change a
permission decision".

</details>

<details>
<summary><b>Multiple instances: one instance serves one thing</b> (click to expand)</summary>

Two repositories, two teams or two platform accounts mean two instances.

> **One instance = one profile = one repository = one bot.**

Four things must each be unique: profile / port / stateDir / **bot credential directory** (sharing one means two
instances acting as the same identity).

The two things most easily missed: **a new profile has no models configured** (providers are registered by that
profile's own plugins), and **`status` exiting 3 on the first start is normal** (it is waiting for settings — do not keep
restarting it).

Full procedure: [deployment and a second instance](https://xyt071024.github.io/dsh-superagent-cn/docs/en/09-deployment.html).

</details>

<details>
<summary><b>Two running states</b> (click to expand)</summary>

| State | Meaning |
|---|---|
| **Conversational** | the panel is visible; it acts when you speak, and you can interrupt |
| **Silent** | resident in the background; it costs almost nothing when idle and wakes on a message |

The processing path is identical; only the interface differs.

</details>

<details>
<summary><b>Is it reliable — the honest limits</b> (click to expand)</summary>

**It can**: change code, open PRs, write documents, research, run commands, operate files, use the web, and **install
plugins to extend itself**.

**It cannot**: train a model for you (that is the vendor's job — this is a caller), or make design decisions for you.

**The real limits of multi-agent work**: there is `subagent`, `subagent_fork` and `workflow`, but children have **no
shared information, no shared progress, are killed rather than rescued when stuck, and are single-use and tree-shaped**.
The idea of peer sessions that report back to each other is not implemented.

Reliability comes from **hard rules** — a gate in plain code, an immutable mandate, a structured report — not from the
agents being clever.

</details>

---

## 🛠 Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22.19+ / 24+, DeepSeek Harness `0.2.1`–`0.2.9` |
| Language | TypeScript (strict; `tsc --noEmit` clean) |
| Build | tsdown (rolldown + dts) |
| Plugin kernel | [Cordis](https://github.com/shigma/cordis) + `@deepseek-ai/dsh-*` service injection |
| Storage | SQLite (WAL) — tickets, decisions, cursors, lessons |
| Tests | Vitest (65 files / 1258 cases) |
| Panel | React + its own HTTP API (same-origin `x-orchestrator-request` check) |
| Context | reuses the host's `ctx.compaction`; this project decides only the threshold and the hand-off |
| Sources | OneBot v11 (one factory for QQ/WeChat/WeCom), hand-written IMAP + curl SMTP, `gh` CLI, `lark-cli` event stream |
| Distribution | GitHub Releases (six packages) + GitHub Pages (36-page docs site, zh/en/ja) |

---

## 🗂 Project layout

```
src/
├── sources/            # github / qq (OneBot factory) / mail (IMAP+SMTP) / feishu
│   ├── registry.ts     # instances; one kind can carry several accounts (qq-work)
│   ├── poll.ts         # polling cursors and failure counting
│   └── host.ts         # the Source host
├── app/                # the runtime
│   ├── runtime.ts      # composition root: start/stop, pause, long-task notices
│   ├── sessions.ts     # the WORK_TOOLS allow-list and Session decoration
│   ├── assessment.ts   # assessment: whether to take it, how hard it is
│   ├── routing.ts      # model per difficulty, splitting, foreground/background
│   ├── archive.ts      # automatic context hand-off (reuses the host compaction)
│   ├── usage.ts        # the daily token ledger
│   ├── self-inspect.ts # self-check: what is missing and what to do next
│   ├── tools/          # main-Session tools (route / read / report / plugin …)
│   └── views/          # panel views and HTTP
├── client/             # front end: settings, routing, budget, locales
├── core/               # domain: Ticket / Mandate / Assignment / Report
├── policy.ts           # every settings schema + the Policy version + the gate
├── deployment.ts       # configuration resolution and the machine abstraction
└── setup.ts            # environment probes and the problems they raise

prompts/                # worker.md(<=1000) / orchestrator.md(<=1400) / work.md / shared.md
skills/                 # six built-in skills, registered into the skill roots at runtime
├── dsh-superagent-shell/      # shell, background jobs, the sandbox
├── dsh-superagent-install/    # install a plugin/CLI/runtime, then verify it
├── dsh-superagent-research/   # read the source, separate verified from assumed
├── dsh-superagent-delegate/   # hand off to subagents: the brief, and checking what returns
├── dsh-superagent-verify/     # prove it: types and tests are separate gates, baseline diffing
└── dsh-superagent-docs/       # documentation that matches the code

docs/                   # 000 philosophy … 009 second instance
scripts/dsh-superagent # service script (exit 0 ok / 1 main service / 2 component / 3 awaiting setup)
tests/                  # 65 test files
```

---

## 📖 Read further

- **[Documentation site](https://xyt071024.github.io/dsh-superagent-cn/)** — Chinese / English / Japanese, switching keeps the same page
- **[Positioning](docs/en/01-overview.md)** — what it is and how authorization is designed
- **[The full flow](docs/en/02-flow.md)** — what happens after a message arrives
- **[Multi-session collaboration](docs/en/03-collaboration.md)** — how a hard task is split
- **[Sources](docs/en/05-sources.md)** — how to connect each platform
- **[Deployment](docs/en/09-deployment.md)** — architecture, dependencies, a second instance
- **[Changelog](CHANGELOG.md)** — what each version changed
- **[Differences from upstream](UPSTREAM-DIFF.md)** — what changed and why
- **[Security](SECURITY.md)** — where the boundary stops

---

## ⚠️ Purge mode

The purge build **modifies the host program itself** — 86 patches to DSH, bypassing some built-in content limits.

- **Nothing is guaranteed**: output is unpredictable, a DSH upgrade may break it, and compliance is entirely yours
- **Use it only in an environment you own and whose consequences you accept**
- It needs an explicit `dsh purge apply`; `dsh purge revert` undoes it

See **[Purge mode](purge.md)**.

---

## 📄 License

[MIT](LICENSE).

The core architecture comes from DeepSeek's open-source **[dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype)**
by **DeepSeek Harness Team** (MIT, based on commit `8c32a9d`).

**The six-layer architecture and the three-stage authorization design come from that project and are unchanged.** This
project adds multi-source intake, multi-session collaboration, self-evolution, stability hardening and three-language
documentation.

Full source list, upstream contributor roster, third-party notices: **[Credits and references](credits.html)**.

---

## 🙏 Credits

- **Upstream**: [DeepSeek Harness Team](https://github.com/deepseek-ai/deepseek-harness) — architecture and plugin kernel
- **Plugin kernel**: [Cordis](https://github.com/shigma/cordis) (MIT)
- **Message bridge**: the [OneBot v11](https://github.com/botuniverse/onebot-11) protocol; implementations such as SnowLuma / NapCat
- **Icons**: [Lucide](https://lucide.dev) (ISC)
- **README layout**: learned from [Playa-Cyrene/Cyrene-Agent](https://github.com/Playa-Cyrene/Cyrene-Agent)

If this project uses your work without naming you, [open an issue](https://github.com/xyt071024/dsh-superagent-cn/issues) and it is fixed immediately.
