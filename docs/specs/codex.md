# Codex

Last verified 2026-11-03 against `codex-cli 0.165.0`.

## Entry files

Codex reads `.agents/plugins/marketplace.json` and `.codex-plugin/plugin.json` at the repo root. This is compound-engineering's shape: the catalog entry has `source: {source: "local", path: "./"}`, and the plugin root is the repo root. `scripts/sync-manifests.mjs` writes both files and `.codex-plugin/hooks.json`. `plugin.json` is `pstack/plugin.json` without `$schema`, plus three keys:

```json
"skills": "./pstack/skills/",
"hooks": "./.codex-plugin/hooks.json",
"interface": { "displayName": "pstack", "category": "Coding", "logo": "./pstack/assets/logo.png", ... }
```

The marketplace is named `pstack-all`, like the Claude and Cursor catalogs, so the plugin id is `pstack@pstack-all`.

## Install

```
codex plugin marketplace add <local path of this repo>
codex plugin add pstack@pstack-all
```

Then start the Codex TUI once and choose "Trust all and continue" at "Hooks need review", so the adapter hook runs. The git form, `codex plugin marketplace add dragosdm/pstack-all`, is unverified. `codex plugin add` copies the plugin root into `$CODEX_HOME/plugins/cache/pstack-all/pstack/<version>/`, so later edits to the tree need a reinstall.

Codex names pstack skills `pstack:<name>`. A prompt that mentions `$pstack:<name>` gets that skill's `SKILL.md` as a message.

## Manifest precedence

If the plugin root has a `plugin.json` whose `$schema` starts with `https://agent-plugins.org/schemas/`, Codex reads it as an Agent Plugin and does not read `.codex-plugin/plugin.json`. It then logs `ignoring unknown Agent Plugins manifest field` for `skills` and `agents`, and the model gets no pstack skill. compound-engineering drops that `$schema` for the same reason. Its `docs/specs/agent-plugins.md` adds that Codex cuts an Agent Plugin `SKILL.md` to its first 8000 bytes, and five pstack skills are longer than that, `poteto-mode` at 21670 bytes among them.

So `scripts/sync-manifests.mjs` writes the root `plugin.json`, the Grok CLI entry file, without `$schema`. `scripts/check-grok.sh` passes on it with the same 58 skills and 2 agents as `pstack/`.

If `.agents/plugins/marketplace.json` is missing, Codex reads `.claude-plugin/marketplace.json` from the same root instead. The check fails on that fallback, because Codex documents only the `.agents/plugins/` path.

## Inventory

The model's skill list names 58 `pstack:` skills, the same names as `pstack/skills/`. Codex lists the 57 skills with `disable-model-invocation: true` too. opencode keeps those out of the model's list (`docs/specs/opencode.md`).

`.codex-plugin/plugin.json` declares no agents, so `poteto-agent` and `comment-sicko` are not registered. compound-engineering's plan `docs/plans/2026-04-20-001-feat-codex-native-plugin-manifests-plan.md` says Codex plugins cannot declare agents. The adapter tells the model to put an agent file's body into the spawn message instead.

## Adapter

`docs/harness/codex.md` maps the Cursor names in pstack skills to Codex: `Task` to `spawn_agent`, the subagent fields, the model rule at `"${CODEX_HOME:-$HOME/.codex}/pstack-models.md"`, paths and transcripts. `.codex-plugin/hooks.json` holds a `SessionStart` hook that prints one line naming that file under `${PLUGIN_ROOT}`. Codex sets `PLUGIN_ROOT` to the installed plugin root and gives the hook's output to the model as a developer message.

Codex runs a plugin hook only after the user trusts it. On the first TUI start after install, Codex shows "Hooks need review" with "Trust all and continue". `/hooks` manages hooks later. The TUI writes the trust to `config.toml` as `[hooks.state."pstack@pstack-all:.codex-plugin/hooks.json:session_start:0:0"]` with `trusted_hash` and `trusted_content_hash`. `codex exec` never asks, and skips an untrusted hook with no message, so the model gets no adapter line. `codex features list` shows `plugin_hooks` as `removed`, and plugin hooks run anyway, so that flag says nothing about them.

The file is not `hooks/hooks.json`. Codex reads that default path too, and so does Claude Code, which would then run a second adapter hook from the same plugin root. Claude Code's `learning-output-style` 1.0.1 plugin declares no `hooks` key, and its `hooks/hooks.json` `SessionStart` output reached a Claude Code session on 2026-11-03.

## Real model run

2026-11-03, `codex exec -s workspace-write` with `gpt-6.1-sol` on a ChatGPT login, the adapter hook trusted, pstack installed from this branch, and the question "how does this repo deliver the same pstack skills to each harness" through `$pstack:how`. 2 minutes 36 seconds. The model read `docs/harness/codex.md` first, checked `$CODEX_HOME/pstack-models.md`, spawned three explorers and one explainer with `fork_turns: "none"`, and said in its answer that the subagents ran on the session model. Every child command was a read, and `git status` stayed clean. Codex stores each spawn payload encrypted, so the "do not edit files" text itself cannot be read back.

The same question without the adapter, in a read-only session, spawned two explorers and one explainer with the default `fork_turns`, then looked for the missing `pstack/docs/harness/codex.md` and for a `pstack-models` file in the project.

The `spawn_agent` description says a spawned agent has the same tools and can spawn its own subagents.

## Adapter rows in real sessions

2026-11-03, `gpt-6.1-sol` on a ChatGPT login, the hook trusted, a throwaway `CODEX_HOME`, and a two-file toy repo. The TUI runs went through `rex`. Codex wraps its tools in a JavaScript `exec` tool, so a rollout shows calls as `tools.spawn_agent(...)` inside `exec`, with each `spawn_agent` call also logged on its own.

- `setup-pstack`, TUI. The model listed the five `spawn_agent` models, asked for the budget, showed the roles, took the user's changes, and wrote `$CODEX_HOME/pstack-models.md` with no frontmatter and the role lines in order. With no rule yet, every role came out `inherit-parent`, so the budget changed nothing. The adapter now says so.
- `AskQuestion`. The session offered `request_user_input`, and the model asked in plain text anyway. Codex's Default mode instructions keep `request_user_input` for optional questions and tell the model to ask a required question in plain text. The adapter row now says to ask in plain text.
- Model overrides, `$pstack:swarm` in `codex exec`. Both workers ran as `gpt-6-luna` at `high`, the `swarm workers` line, with `fork_turns: "none"`.
- The rule path. A `$pstack:poteto-mode` run read only `~/.codex/pstack-models.md`, which the run's `CODEX_HOME` did not hold, and spawned its delegates on the session model. The adapter now gives one path, `"${CODEX_HOME:-$HOME/.codex}/pstack-models.md"`. The rerun read that path and spawned its delegate on `gpt-6-luna`.
- `poteto-agent` and `comment-sicko`. The parent read both agent files before it spawned an `implement` and a `comments` subagent. The `implement` child's first command read `pstack/skills/poteto-mode/SKILL.md` by its absolute path, as the agent body tells it to. The spawn message itself is encrypted.
- `resume`. Asked to give the finished `implement` subagent more work, the model called `followup_task` on it and spawned no new agent.
- `environment: "cloud"`. Under `workspace-write`, `.git` is read-only. `git worktree add` failed with `cannot lock ref`. In `codex exec` the model cloned the repo to `/tmp` and added both worktrees there, and the workers committed on those branches. In the TUI, `git worktree add`, then `git add` and `git commit` in the worktree, each asked for approval to run outside the sandbox. The adapter row now says both.
- Paths. `$pstack:recall` read `$CODEX_HOME/sessions/2026/11/03/` and kept the rollouts whose `session_meta` `cwd` was the workspace.

The TUI's `/new` popup can pick a command that starts a Codex-managed worktree under `$CODEX_HOME/worktrees/`. `codex --worktree` does the same at startup. Neither is a tool the model can call.

## Check

`scripts/check-codex.sh` runs Codex with a throwaway `HOME` and `CODEX_HOME`, and a local Responses API mock, `scripts/codex-mock-model.mjs`, as the model provider. It adds the repo root as a marketplace and installs `pstack@pstack-all`. It reads `hooks/list` from `codex app-server` through `scripts/codex-hooks.mjs`, then trusts the pstack hook the way the TUI does. Then it runs one `codex exec` turn that mentions `$pstack:poteto-mode`. It fails if any of these is false:

- `codex plugin list` reads the `pstack-all` marketplace from `.agents/plugins/marketplace.json`.
- The installed version equals the `.codex-plugin/plugin.json` version.
- `hooks/list` shows one pstack hook, the `SessionStart` hook from `.codex-plugin/hooks.json`, untrusted before the check trusts it.
- The model's input has the adapter line, and the file it names is the installed copy of `docs/harness/codex.md`.
- Codex logs no Agent Plugins manifest warning for pstack.
- The skill list in the request names the same `pstack:` skills as `pstack/skills/`.
- The `poteto-mode` message holds the whole `SKILL.md`, byte for byte.

Set `CODEX_BIN` to choose the binary. No login, network or billing.

## Not verified

- Each adapter row ran in one session, and the fixed rows were rerun once. `cloud_base_branch`, `file_attachments`, the Cursor-only skip line, and `request_user_input` in Plan mode were not exercised.
- The text of a spawn message. Codex encrypts it, so the agent-body rows rest on what the child did.
- Install from a git URL, and install through the Codex app. Only a local path was tested.
- Whether `/pstack:<name>` works in the Codex TUI. Only a `$pstack:<name>` mention in `codex exec` was tested.
