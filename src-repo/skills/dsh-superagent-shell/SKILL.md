---
name: dsh-superagent-shell
description: Run shell commands, long jobs and background work in a worker Session — timeouts, the sandbox, and how to use the host's job tools instead of blocking.
---

A worker's shell moves a long command to the background rather than waiting for it, and the job's end arrives as a message.
Pass `run_in_background: true` yourself when you expect a command to outlast the turn; pass a short `timeoutMs` when you
want a failure rather than a wait. Never `sleep` to wait for something: use `job_output` with `wait`, or end the turn and
let the result come to you.

## Choosing between bash and pwsh

`bash` is the portable choice and the one most repositories expect. Use `pwsh` only when the command needs a Windows
API — a registry key, a service, a COM object — because its quoting differs and a command that works in one often does
not work in the other. Do not mix the two inside one pipeline.

## What the sandbox changes

Commands run under the profile's sandbox. A denied file operation reports it in the output rather than failing silently,
and it is not an error in your command. Read the denial, then choose a path inside the allowed root instead of retrying
the same one.

## Long work

A build, a test run or a download belongs in a background job. Start it, keep working on something independent, and act
on the result when its message arrives. Killing a job with `job_kill` is for work that no longer matters, not for work
that is merely slow.

## When a command fails

Read the actual error before changing anything. The usual causes, in order: the working directory is not what you
assumed; a tool is not on the sandbox's `PATH`; the command is written for a different shell; or the dependency it needs
is genuinely absent. Fix the cause, do not paper over it with `|| true`.
