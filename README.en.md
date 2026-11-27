<p align="center">
  <img src="assets/hero-cover.jpg" alt="Super Agent for DeepSeek Harness" width="920">
</p>

<h1 align="center">Super Agent for DeepSeek Harness</h1>

<p align="center">
  <a href="README.md">简体中文</a> &nbsp;·&nbsp;
  <a href="README.en.md"><strong>English</strong></a> &nbsp;·&nbsp;
  <a href="README.ja.md">日本語</a> &nbsp;·&nbsp;
  <a href="https://xyt071024.github.io/dsh-superagent-cn/en/index.html">Documentation</a> &nbsp;·&nbsp;
  <a href="https://xyt071024.github.io/dsh-superagent-cn/en/install.html">Install Guide</a> &nbsp;·&nbsp;
  <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <a href="https://github.com/xyt071024/dsh-superagent-cn/releases/latest"><img src="https://img.shields.io/badge/Release-v0.4.0-10b981?style=flat-square" alt="Release v0.4.0"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-38bdf8?style=flat-square" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Node.js-22.19%2B%20%7C%2024%2B-339933?style=flat-square" alt="Node.js">
  <img src="https://img.shields.io/badge/DSH-0.2.2%2B-6366f1?style=flat-square" alt="DeepSeek Harness">
  <img src="https://img.shields.io/badge/Linux%20CI-1393%20Passed%20%7C%200%20Failed-2ea44f?style=flat-square" alt="Linux CI Tests">
</p>

Super Agent is a community-maintained DeepSeek Harness (DSH) plugin that connects workspace chat, external messages, and background tickets. You can assign a project task from one main conversation, let multiple independent conversations work on parallel parts, and return to the main conversation to check progress, test results, and review feedback.

---

## Start from a Task

For example, when you need to change a feature, add tests, and verify the installation docs at the same time, start a chat in your DSH workspace, pick the Super Agent auto-division preset, and enable automatic division in Settings. Once the task starts, you can open each division conversation in the same workspace to give targeted follow-up instructions or inspect the consolidated summary back in the main conversation. Simple tasks stay in the current chat. Actual split counts and throughput depend on the task, chosen models, and provider concurrency limits.

Fresh profiles allow up to **5** extra division conversations per task by default. You can freely adjust that limit (no fixed 16 cap, with paginated slot browsing and sparse storage) and assign a provider and model to each slot; unassigned slots strictly inherit the model active in the originating main chat. Independent review is tracked separately, alongside complexity thresholds, reasoning effort, and daily token budget controls.

<p align="center">
  <img src="assets/multi-session-collab.jpg" alt="Independent Multi-Session Divisions, Peer Collaboration, and Independent Review" width="880">
</p>

---

## How Work Moves End to End

<p align="center">
  <img src="assets/architecture-flow.svg" alt="Super Agent Workflow Architecture" width="940">
</p>

- **Intake.** Workspace chats launch tasks directly. Configured external sources translate incoming messages into events carrying conversation or thread identifiers. Based on code-enforced policy, ticket linkage, and authorization scope, the runtime decides whether to continue existing work, enter evaluation, or stay quiet. External messages or web pages cannot escalate permissions.
- **Division & Collaboration.** The coordinator persists work items, dependencies, and owners in local SQLite. Members keep independent contexts and can message peers directly, publish splittable work items, claim open items from other members, and submit deliverables back to the original owner.
- **Verification & Review.** Code work items require controlled test credentials bound to the current deliverable version (rejecting missing results, forged passes, stale credentials, and manual acceptance on code items). Documentation and research items can record explicit manual acceptance notes. When independent review is enabled, authors cannot self-approve and review findings trigger up to 3 rework rounds.
- **Context Relay.** Long tasks support automatic context compression and generational session handover (`r1 → r2 → r3`) across main, ticket worker, subagent, and division sessions at a configurable threshold (**60%** by default), with live follow-up routing from older windows.
- **Outbound Delivery & Crash Recovery.** The outbox persists pending, sent, and dropped receipts. Speculative drafts wait for explicit user confirmation or revocation; while paused or offline, drafts stay pending and settle strictly from authoritative outbox receipts (sending at most once on recovery). `v0.4.0` adds PID-aware state-directory locking that never deletes a live instance's lock while safely reclaiming verified orphaned locks immediately after a Windows forced termination.

<p align="center">
  <img src="assets/context-relay-engine.jpg" alt="60% Threshold Lossless Context Relay Engine" width="880">
</p>

---

## Entrypoints & Prerequisites

| Entrypoint | Prerequisites |
|---|---|
| **DSH Workspace Chat** | Configure a working model connection and pick the auto-division preset inside the target workspace |
| **GitHub** | Connect the target repository with credentials, watched scope, and permitted actions (supports `@` mentions in both Issue/PR titles and bodies) |
| **Personal QQ, WeChat, WeCom** | Use a compatible OneBot gateway, log in per the gateway's instructions, and configure event/message endpoints (supports scoped reply lookup and image attachments; some setups need a separate gateway service) |
| **Official QQ Bot** | Configure Tencent Open Platform bot credentials within the bot's authorized scope |
| **Feishu, Gmail / Email** | Configure bot (supports `post` rich text and embedded images) or mailbox authorization; email uses IMAP for intake and SMTP for sending |

---

## Installation & First Run

### Option 1: One-Line Installer (Dynamic Release Resolution + SHA-256 Check)

**Windows (PowerShell):**
```powershell
irm https://xyt071024.github.io/dsh-superagent-cn/install.ps1 | iex
```

**macOS / Linux (Bash):**
```bash
curl -fsSL https://xyt071024.github.io/dsh-superagent-cn/install.sh | bash
```

### Option 2: Zero-Dependency Bundled Archives or Standalone Plugin ([v0.4.0 Release](https://github.com/xyt071024/dsh-superagent-cn/releases/latest))

| Target Environment | Release Asset | Start / Install |
|---|---|---|
| **Windows x64** (Node + DSH included) | `Super-Agent-Bundled-Windows-x64-v0.4.0.zip` | Extract and run `start.cmd` |
| **macOS Apple Silicon (arm64)** | `Super-Agent-Bundled-macOS-arm64-v0.4.0.zip` | Extract and run `./start.sh` |
| **macOS Intel (x64)** | `Super-Agent-Bundled-macOS-x64-v0.4.0.zip` | Extract and run `./start.sh` |
| **Linux x64** | `Super-Agent-Bundled-Linux-x64-v0.4.0.zip` | Extract and run `./start.sh` |
| **Existing Compatible DSH Profile** | `Super-Agent-Plugin-v0.4.0.tgz` | `dsh plugin add ./Super-Agent-Plugin-v0.4.0.tgz` |

### First-Run Steps

1. Extract the bundle for your platform and run `start.cmd` (Windows) or `./start.sh` (Linux/macOS), then open the local URL printed by the launcher. Existing profiles are backed up and upgraded in place while preserving your `cordis.patch.yml` and other plugins. See the [Install Guide](https://xyt071024.github.io/dsh-superagent-cn/en/install.html).
2. Configure your model connection first, then review **Superagent → Settings** (Routing & Models, Context & Budget).
3. Try a read-only parallel task first before connecting external accounts.

---

## v0.4.0 Verification & Known Boundaries

- **Automated & Cross-Platform CI**:
  - **Windows Local Vitest (80 files)**: `1,380 passed | 0 failed | 15 skipped` (15 POSIX service-script specs run in Linux CI);
  - **Linux CI Vitest (80 files)**: `1,393 passed | 0 failed | 2 skipped`;
  - **Historical Acceptance Suites (41–50, 8 files)**: `37 passed | 0 failed`;
  - **Packaging & Preflight**: `unix-bundle` `2/2`, strict `windows-bundle` `2/2 (0 skipped)`, `profile-bootstrap-selftest` `8/8`, `test_release_preflight.py` `1/1`, `release_preflight.py` **0 issues** across all 5 assets.
- **Isolated Windows Bundle Lifecycle**: Verified fresh boot, missing-plugin repair, lossless upgrade, HTTP 200 management API, live-instance lock guard (`ELOCKED` without deleting live locks), and forced-termination restart recovery at **0s / 5s / 35s / 60s**.
- **Scope Not Yet Verified on Real Hardware/Accounts**: Live commercial API key throughput, real-account send/receive across external channels, physical Linux/macOS desktop install/rollback, cloud offline continuation, cross-month memory, and autonomous external watchdogs are outside this release's verified guarantees. See each [GitHub Release](https://github.com/xyt071024/dsh-superagent-cn/releases/latest) for details.

---

## Origin & License

Built on the public Super-agent prototype from the DeepSeek Harness team and independently maintained by the community under the [MIT License](LICENSE).

- **Upstream Prototype**: [deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) (MIT)
- **Repository**: [xyt071024/dsh-superagent-cn](https://github.com/xyt071024/dsh-superagent-cn)
