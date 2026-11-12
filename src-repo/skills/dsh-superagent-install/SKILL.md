---
name: dsh-superagent-install
description: Install a capability the profile lacks — a DSH plugin, a CLI, a language runtime — and verify it actually works before reporting.
---

When the assignment needs something this machine does not have, install it. Reporting "the profile has no X" is not a
deliverable; installing X and saying what you ran is.

## A DSH plugin

Use the plugin manager tool, not a hand-edited `package.json`:

- list what is installed before adding anything, so you do not duplicate an entry under two names
- install into the profile the work runs in, naming it explicitly
- after installing, confirm the plugin appears in the list and that the tool it provides is callable

A plugin that installs but does not appear usually means one of four registration points is missing — the build entry,
the package exports, the bundle's patch insert, or `disabled: false` in the profile. Check those before concluding the
plugin is broken.

## A CLI or a runtime

Prefer the package manager the project already uses. On Windows, `npm`/`npx` are `.cmd` shims and cannot be spawned
directly by every runner; wrap them through the shell when a script fails with `EINVAL`. Confirm with `--version` from
the same shell the worker uses, not from your own terminal — a sandbox `PATH` differs.

## Verification is the deliverable

Installing is not done until you have run the thing. A CLI: run `--version`. A plugin: call one of its tools. A runtime:
execute a one-line program. Put that output in your report; "installed successfully" without a command transcript is not
evidence.

## Do not

Do not install into a location outside the workspace the profile allows, and do not upgrade an existing dependency to
satisfy a new one without saying so — a version bump can break work that was passing.
