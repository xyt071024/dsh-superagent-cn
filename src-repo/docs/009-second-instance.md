# Adding a second instance

One instance serves one repository, one bot and one account list. Two teams, two repositories or two chat platforms
need two instances, and the safest way to add the second is to leave the first one alone.

The rule that keeps them separate:

> **One instance = one DSH profile = one GitHub repository = one bot.**

Nothing is shared between instances: not the profile, not the state directory, not the port, not the account list. That
is what makes it safe to change one without touching the other.

## Before you start

These checks are read-only. Run them against the **running** instance too — a second instance must not disturb it.

```sh
# The new profile must not exist yet.
test ! -e ~/.dsh/profiles/<NEW_PROFILE> && echo "profile free"

# The new port must be free.
lsof -nP -iTCP:<NEW_PORT> -sTCP:LISTEN

# The new state directory must not exist yet.
test ! -e ~/.dsh/state/<NEW_PROFILE> && echo "state free"

# The instance that already works must stay healthy; record its exit code.
scripts/dsh-superagent --profile <OLD_PROFILE> status; echo "old instance exit: $?"
```

Also confirm `node`, `pnpm`, `git`, `gh` and `dsh` meet what `SETUP.md` lists, and that `dsh --version` satisfies
`engines.dsh` in `package.json`. A version outside that range is the failure that shows up later as a plugin that will
not load.

Read the settings you intend to copy from the running instance rather than retyping them; a typo in a model name is
hard to see and easy to blame on the new instance.

```sh
curl -s -H 'x-orchestrator-request: 1' http://127.0.0.1:<OLD_PORT>/orchestrator/api/settings > /tmp/old-settings.json
curl -s -H 'x-orchestrator-request: 1' http://127.0.0.1:<OLD_PORT>/orchestrator/api/state    > /tmp/old-state.json
```

## 1. Create the profile and install the plugin

```sh
dsh <NEW_PROFILE> --from-default-profile web --dump-config > /dev/null
dsh plugin --profile <NEW_PROFILE> add "link:$PWD"
```

If the profile already exists, **stop and report it**. `--from-default-profile` replaces `cordis.patch.yml`, and that
file is the whole configuration of an instance that may already be in use.

## 2. Write the machine configuration

```sh
cp examples/profile.cordis.patch.yml ~/.dsh/profiles/<NEW_PROFILE>/cordis.patch.yml
```

Change exactly three things:

| Field | Value |
| --- | --- |
| `webserver.port` | `<NEW_PORT>` |
| `dsh-superagent.stateDir` | an absolute path, `~/.dsh/state/<NEW_PROFILE>` |
| the platform Source entry | uncomment it, then fill in its account |

`stateDir` must be absolute: the plugin does not expand `~`. Then check that the YAML parses before starting anything:

```sh
dsh --profile <NEW_PROFILE> --dump-config > /dev/null && echo "configuration parses"
```

## 3. Give the new bot its own credential directory

A bot that shares a credential directory with another instance acts as the other instance. Give each its own, and keep
the secret out of every file, command line and transcript: the operator types it into their own terminal.

```sh
mkdir -p ~/.lark-cli-<NEW_PROFILE>
# Send this line to the operator and wait for them to say it is done:
#   LARKSUITE_CLI_CONFIG_DIR="$HOME/.lark-cli-<NEW_PROFILE>" lark-cli config init --app-id <APP_ID> --app-secret-stdin
LARKSUITE_CLI_CONFIG_DIR="$HOME/.lark-cli-<NEW_PROFILE>" lark-cli config strict-mode bot --global
```

Then a wrapper, so every call this instance makes carries the right identity:

```sh
cat > ~/.local/bin/lark-bot-<NEW_PROFILE> <<'EOF'
#!/bin/sh
export LARKSUITE_CLI_CONFIG_DIR="$HOME/.lark-cli-<NEW_PROFILE>"
exec lark-cli "$@"
EOF
chmod +x ~/.local/bin/lark-bot-<NEW_PROFILE>
```

Confirm the wrapper sees the bot identity and that the bot is in the chat it is meant to serve:

```sh
~/.local/bin/lark-bot-<NEW_PROFILE> im +chat-list --page-all
```

If the chat does not exist yet, stop and ask the operator to create it and add the bot; then put the returned `oc_…`
id into the configuration. Do not guess a chat id.

## 4. Start it

```sh
scripts/dsh-superagent --profile <NEW_PROFILE> start
scripts/dsh-superagent --profile <NEW_PROFILE> --url http://127.0.0.1:<NEW_PORT> status
```

Exit **3** on the first start is expected: it means the service runs and still waits for settings. Go on to step 5
instead of restarting. Exit 1 or 2 is a real problem — read `docs/006-deployment.md` → Troubleshooting.

## 5. Save the settings

Every save is `PUT` with the `revision` you just read, so a stale revision is rejected rather than silently overwriting
something a person changed in the panel.

| Block | What it needs |
| --- | --- |
| `source:github` | repository `owner/name`, the agent CLI path, and the same observe switches as the instance you copied |
| `source:feishu` | the bot CLI wrapper from step 3, the chats it may read (each with its mentions-only mode), and whether direct messages count |
| `policy` | `allowed` may start empty; sync it from the chat, then confirm it filled in |
| `executor` | directory root, prepare command, blocked commands, `maxWorkers`, and the eval/executor models — a new profile has no models configured, and a model that is right in your desktop profile may not exist here |
| `prompts` | copy the prompts block from the old instance, changing only what names the repository or the project |

When a save answers `restarting: true`, wait for `status` to stop exiting 1, then read a fresh `revision` before the next
block. Saving the next block against the old revision is rejected.

## 6. Accept it

```sh
scripts/dsh-superagent --profile <NEW_PROFILE> --url http://127.0.0.1:<NEW_PORT> status; echo "exit: $?"
curl -s -H 'x-orchestrator-request: 1' http://127.0.0.1:<NEW_PORT>/orchestrator/api/state
```

Done means all of these:

- `status` exits **0**
- `setup.problem` and the platform's own problem field are both `null`
- every entry under `health` is `ready`, not `error`
- the panel at `http://127.0.0.1:<NEW_PORT>` opens, and **Sources** lists both Sources as ready

Report the profile, the port, the panel URL, each Source's state, and what you still need from the operator — inviting
the GitHub account to the repository, adding the bot to the chat, accepting the invitation.

## What not to do

- Do not stop, restart or edit the instance that already works, not even to "clean up" before starting the new one.
- Do not reuse a profile, a port, a state directory or a credential directory.
- Do not write a bot secret into a file, a command line, a log or a transcript.
- Do not rely on a script's default `--profile`: name it explicitly in every command.

## Keeping it checked

Add the hourly check from `docs/006-deployment.md` → Hourly check, once per instance, in the profile you normally use
(not in either agent profile). It must keep running when an agent instance is down — that is the only way it can tell you
the instance went down.
