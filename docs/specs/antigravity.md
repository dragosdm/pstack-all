# Antigravity CLI

Last verified 2026-11-23 against `agy 1.5.15`.

## Install

Antigravity takes two plugins from this repo:

```
agy plugin install <checkout>/pstack
agy plugin install <checkout>/.agy
```

`pstack/` is upstream, unchanged. It gives the 58 skills as `/pstack:<name>` and the `comment-sicko` agent. `.agy/` is the `pstack-agy` adapter plugin. It gives the adapter rule and both pstack agents with Antigravity frontmatter.

From GitHub, `agy plugin install https://github.com/dragosdm/pstack-all/tree/main/pstack` cloned the repo and installed `pstack` with 58 skills and `comment-sicko`, in a throwaway `HOME`. `https://github.com/dragosdm/pstack-all/tree/main/.agy` installed `pstack-agy` with both agents and the rule the same way, on 2026-11-23 after the merge.

`agy plugin install` copies the folder into `~/.gemini/config/plugins/<name>/`, so the two land in `plugins/pstack/` and `plugins/pstack-agy/`. `agy plugin uninstall pstack` and `agy plugin uninstall pstack-agy` remove them. `scripts/check-agy.sh` runs both installs in a throwaway `HOME`.

## Why two plugins

Each claim below was observed with `agy plugin validate --json`, `agy plugin install`, `agy plugin list --json` and `agy -p "/skills"` on copies of this repo.

- agy names a plugin skill from its path relative to the plugin's own `skills/` folder. Installed from the repo root, where the skills sit in `pstack/skills/`, every skill is `pstack:..:pstack:skills:<name>`. This held for the root `plugin.json` `skills` key, the same key in `.antigravity-plugin/plugin.json` as a string in three spellings and as an array of skill folders or `SKILL.md` files, and a root `skills.json`. The long name does expand when typed. Installed from `pstack/`, the names are `pstack:<name>`.
- A root `skills` symlink to `pstack/skills` gives `pstack:<name>`, and the Grok, Pi, opencode, Codex and eval layers still pass with it. `claude plugin validate --strict .claude-plugin/plugin.json` fails on it ("This directory is a symlink, so the validator read nothing in it"). That validation is a CI gate, so the symlink is out.
- agy refuses to install a folder holding a symlink that points outside it: `failed to copy plugin: symlink .agy/skills points outside .agy`. So `.agy/` cannot link to `../pstack/skills`, and holds real files only.
- The user chose two installs with clean names over one install with long names (`decisions.tsv`, 2026-11-23).

## Adapter plugin

`scripts/sync-manifests.mjs` writes `.agy/plugin.json` and one `.agy/agents/<name>.md` per `pstack/agents/*.md`. `.agy/rules/pstack-adapter.md` is written by hand.

### Agents

An agy agent file keeps upstream's `name`, `description` and body, and gets `mainAgent: false` and a `tools` list. Every other upstream frontmatter key is dropped.

- `model`. agy skips an agent whose `model` is not one of its tiers. Upstream `poteto-agent` has `model: claude-opus-5-5-xhigh-fast`. Installed from `pstack/`, only `comment-sicko` loads, and `agy plugin validate pstack` reports `Invalid model tier claude-opus-5-5-xhigh-fast. The loader skips this agent`. Through a plugin's `agents.json` the same agent is skipped with no finding.
- `tools`. An agent with no `tools` key gets `send_message`, `read_file`, `search_web`, `schedule`, `generate_image` and `manage_task`, so it cannot edit. With the list in `scripts/sync-manifests.mjs`, the child request declares exactly those tools. Both were read from the child's request to the mock model.
- `mainAgent: false` keeps the agents out of the primary agent picker. That rests on agy's docs (`https://antigravity.google/docs/subagents.md`) only.

Both plugins define `comment-sicko`. With both installed, a spawn of `comment-sicko` reached the `pstack-agy` copy, the one with write tools. `scripts/check-agy.sh` asserts it.

### Adapter rule

`.agy/rules/pstack-adapter.md` has `trigger: model_decision`. agy puts its absolute path and `description` in the system prompt under the conditional rules, and the model reads the file on demand. This was read from the request to the mock model. It plays the part of the Claude and Codex `SessionStart` hooks. The rule is also the adapter doc, because only `.agy/` is copied on install.

## Skill commands

A user types `/pstack:<name>`. In print mode, agy puts the skill body into the user turn as `The user has explicitly invoked the (pstack:how) skill`, with no folder path. The adapter tells the model to resolve relative links against `<pstack>/skills/<name>/`.

Upstream sets `disable-model-invocation: true` on every skill except `setup-pstack`. agy listed only `setup-pstack` of the pstack skills to the model, so the other 57 run only by command.

## Tools

The tool declarations agy 1.5.15 sends the model, read from the mock: `read_file`, `run_command`, `manage_task`, `send_message`, `schedule`, `invoke_subagent`, `define_subagent`, `manage_subagents`, `write_file`, `edit_file`, `search_web`, `run_workflow`, `swarm`, `ask_question`. `invoke_subagent` takes `TypeName`, `Role`, `Prompt`, `Model` (`inherit`, `flash_lite`, `flash`, `pro`) and `Workspace`. It returned a `conversationId` at once, and the child's completion reached the parent as a system message.

## Mock model

`scripts/check-agy.sh` points agy at `scripts/agy-mock-model.mjs` with `GEMINI_API_KEY`, `GOOGLE_GEMINI_BASE_URL` and `--settings '{"modelProvider":"gemini"}'`. agy then posts to `/v1beta/models/<model>:streamGenerateContent?alt=sse` and accepts one SSE event per reply.

## Not verified

- A real Gemini model following the adapter rule. No billed cell exists for Antigravity yet.
- The interactive TUI. Every run here was `agy -p`.
- `Workspace: "branch"` as the mapping for `environment: "cloud"`. It rests on the `invoke_subagent` description only.
- `~/.gemini/config/rules/pstack-models.md` loading in every session. It rests on agy's rules docs (`https://antigravity.google/docs/rules.md`).
- Which `comment-sicko` wins on another machine or agy version. The check pins it on each run.
- The transcript path in the adapter. It comes from agy's system prompt, not from a read file.
