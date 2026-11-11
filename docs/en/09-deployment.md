# 09 · Deployment and Engineering Effort

[← Previous: Cost Control](08-cost.md) | [Back to README](../README.md)

---

## 1. Prerequisites

| Item | Requirement |
|---|---|
| DeepSeek Harness | 0.2.x or later |
| Node.js | 22.19+ or 24+ |
| Package manager | pnpm |
| OS | Windows 10/11, macOS, Linux |

---

## 2. Two Installation Shapes

### 2.1 Merged Edition

**Installs into the DSH you already have — one more entry point, no other plugin touched.**

```sh
# 1. Create a separate profile (does not overwrite the existing one)
dsh superagent --from-default-profile web --dump-config > /dev/null

# 2. Install the plugin package
dsh plugin --profile superagent add link:<project path>

# 3. Configure
# Edit ~/.dsh/profiles/superagent/cordis.patch.yml
# Set stateDir and the port

# 4. Start
dsh --profile superagent
```

**Key point**: "Isolate process environment variables" must be enabled, otherwise it will affect the `gh` / CLI calls of other plugins.

### 2.2 Clean Edition

**A brand-new blank DSH with only this installed, following the official update path.**

```sh
# 1. Install DSH the official way (if you do not have it yet)
npm install -g @deepseek-ai/dsh

# 2. Create a blank profile
dsh superagent --from-default-profile web --dump-config > /dev/null

# 3. Install
dsh plugin --profile superagent add link:<project path>

# 4. Start
dsh --profile superagent
```

**Advantage**: clean, no legacy baggage, upgradeable along with official releases.

---

## 3. Configuration

### 3.1 Minimal Configuration

```yaml
# ~/.dsh/profiles/superagent/cordis.patch.yml
- id: webserver
  config:
    host: 127.0.0.1
    port: 3082

- id: superagent
  config:
    stateDir: <absolute path>/state/superagent
```

**Note**: `stateDir` must be an absolute path. On Windows use the `C:/path/with/forward/slash` form.

### 3.2 Full Configuration

Configuration through the UI is recommended over hand-editing the file.

See the eight groups in [Settings UI](04-settings.md).

---

## 4. First Start

```
1. Start the process
   ↓
2. Open the dashboard (the terminal prints a URL containing the token)
   ↓
3. The first-run wizard begins:
   · Configure GitHub (repository + CLI)
   · Configure other sources (as needed)
   · Configure the proxy (if needed)
   · Set the permission whitelist
   · Set the budget
   ↓
4. Run it in "observe mode" for a week
   ↓
5. Look at the decisions it recorded; switch to "automatic mode" once you trust them
```

---

## 5. What Each Source Needs From You

| Source | Needed | How to obtain it |
|---|---|---|
| **GitHub** | Repository + CLI authorization | Already logged in is enough |
| **WeCom** | Corp ID + App Secret + AgentId | Create an app in the admin console |
| **QQ Mail** | Authorization code | Mail settings → Account → Enable IMAP → Generate authorization code |
| **Feishu** | App ID + App Secret | Create a custom app on the open platform |
| **Gmail** | App-specific password | Enable two-step verification → Generate an app password |
| **QQ** | Existing bridge | No extra configuration |
| **WeChat** | Local client authorization | Scan the QR code on first login |

---

## 6. Engineering Effort Estimate

### 6.1 By Phase

| Phase | Content | Days |
|---|---|---|
| **P0** | Fix the GitHub source + environment isolation switch | 0.5 |
| **P1** | Settings UI skeleton (eight groups) | 3 |
| **P2** | Model mandate + tiering + cost control | 2 |
| **P3** | Multi-session collaboration (interop / task board / rescue / replay) | 4 |
| **P4** | Proxy system (three layers + drag-and-drop detection) | 3 |
| **P5** | Self-evolution mechanism | 2 |
| **P6** | Seven connection sources | 6 |
| **P7** | Stability hardening (five layers) | 2 |
| **P8** | Browser mandate wizard | 2 |
| **P9** | Dual state + foreground/background switching | 1.5 |
| **P10** | Packaging + trilingual documentation | 2.5 |
| **Total** | | **~28.5 days** |

### 6.2 Suggested Batches

**Batch 1 (3.5 days)**: P0 + P1 + P2
→ You can see the complete settings UI and configure models

**Batch 2 (7 days)**: P3 + P4
→ Multi-session collaboration and the proxy can run

**Batch 3 (10 days)**: P5 + P6 + P7
→ Self-evolution, seven sources onboarded, stability

**Batch 4 (5.5 days)**: P8 + P9 + P10
→ Browser wizard, dual state, packaging

**Why not do it all at once**: you need to review and adjust direction along the way; doing it all in one go tends to drift off course.

---

## 7. External Dependencies

| Component | Purpose | Required |
|---|---|---|
| DeepSeek Harness | Runtime environment | Required |
| Node.js | Runtime | Required |
| Git | Code operations | Required |
| Playwright | Browser automation | Needed by the mandate wizard |
| Microsoft Edge | Built-in browser | Needed by the mandate wizard |
| IMAP library | Mail retrieval | Needed by the mailbox source |

---

## 8. Data Location

```
<stateDir>/
  orchestrator.sqlite    ← main database
  worker-bin/            ← command shims
  work/                  ← ticket working directory
  lessons/               ← experience library
  logs/                  ← logs
  config-backup/         ← configuration backups
```

**Backup strategy**: back up the whole `<stateDir>` directory periodically.

### 8.1 One instance serves one thing

Two repositories, two teams or two platform accounts mean **two instances**. Do not let one instance carry two.

The rule:

> **One instance = one profile = one repository = one bot.**

Nothing is shared between instances: not the profile, not the state directory, not the port, not the account list. That is what makes it safe to change one without touching the other.

**When adding a second instance, the first thing that matters is not disturbing the first one.** Four things must each be unique:

| Item | Rule |
| --- | --- |
| profile | a new name, never reused |
| port | a different one, confirmed free |
| stateDir | a new directory, absolute (the plugin does not expand `~`) |
| bot credential directory | **must be separate** — a shared credential directory means two instances acting as the same identity |

**Write `--profile` explicitly in every command.** The default is meant for a single instance.

For the full procedure — read-only pre-checks, verifying the configuration parses, saving settings by revision, and the acceptance list — see `docs/009-second-instance.md` in the source repository.

**The two things most easily missed**:

1. **A new profile has no models configured.** A model that works in your desktop profile may not exist there at all: each profile's providers are registered by its own plugins. Pick `eval` and `executor` models the new profile actually has.
2. **`status` exiting 3 on the first start is normal.** It means the service runs and still waits for settings. Do not keep restarting it — go and save the settings.

---

## 9. Upgrading

### 9.1 Upgrading the Merged Edition

```sh
# Upgrade the plugin
dsh plugin --profile superagent update

# Upgrade DSH itself (follow your main version)
# Note: a major version upgrade may affect compatibility
```

### 9.2 Upgrading the Clean Edition

```sh
# Follow the official release entirely
npm update -g @deepseek-ai/dsh
```

### 9.3 Pre-Upgrade Checklist

| # | Check |
|---|---|
| 1 | Back up `<stateDir>` |
| 2 | Record the current configuration (export it) |
| 3 | Confirm no task is currently running |
| 4 | If you run a locally patched build, confirm the patch can be reapplied |

---

## 10. Troubleshooting

### 10.1 Startup Failure

| Symptom | Cause | Fix |
|---|---|---|
| `EADDRINUSE` | Port already in use | Kill the old process or change the port |
| `ValidationError: stateDir` | Wrong path format | Use an absolute path with forward slashes |
| `cannot resolve profile bundle` | Wrong package name | Check the package name in `package.json` |
| `spawn env ENOENT` | Platform incompatibility | See the next section |

### 10.2 A Source Is Not Working

| Symptom | Check |
|---|---|
| Status `error` | Read the specific error message |
| Status `paused` | Configuration incomplete |
| 0 messages received | Whitelist / receive scope mismatched |
| Repeated polling failures | CLI path or authorization problem |

**Key point**: look at the **business-layer status**, not only at `runtime: ready`.

### 10.3 Platform Compatibility

On some platforms the original implementation may need small adjustments:

| Problem | Symptom | Direction |
|---|---|---|
| No `env` command | `spawn env ENOENT` | Pass the environment via process arguments instead |
| Path format | `stateDir` validation fails | Use the format for that platform |
| Different command names | Tool registration fails | Pick the shell that matches the platform |
| Port self-occupation | `EADDRINUSE` on restart | Stop the old process before starting |

---

## 11. Security Recommendations

| # | Recommendation | Reason |
|---|---|---|
| 1 | **Dedicated account** | Give the agent its own account; do not share yours |
| 2 | **Least privilege** | Put only the necessary people on the whitelist |
| 3 | **Start in observe mode** | First see what it wants to do |
| 4 | **Budget ceiling** | Prevents accidental spending |
| 5 | **Second confirmation for dangerous actions** | Deleting files, pushing, sending messages |
| 6 | **Leave autonomous plugin install off** | Unless you trust it |
| 7 | **Review the audit records periodically** | Know what it has done |

---

## 12. Minimal Working Configuration

If you want to get it running and take a look first, this is the simplest configuration:

```yaml
Sources: only GitHub enabled
Mode: observe
Budget: ¥10 per day
Autonomous permissions: all off
```

**Run it for a week and look at the decisions it recorded.** Once you trust them, open things up step by step.

---

[← Previous: Cost Control](08-cost.md) | [Back to README](../README.md)
