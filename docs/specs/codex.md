# Codex

Last verified 2026-11-03 against `codex-cli 0.165.0`.

## Entry files

Codex reads `.agents/plugins/marketplace.json` and `.codex-plugin/plugin.json` at the repo root. This is compound-engineering's shape: the catalog entry has `source: {source: "local", path: "./"}`, and the plugin root is the repo root. `scripts/sync-manifests.mjs` writes both files. `plugin.json` is `pstack/plugin.json` without `$schema`, plus two keys:

```json
"skills": "./pstack/skills/",
"interface": { "displayName": "pstack", "category": "Coding", "logo": "./pstack/assets/logo.png", ... }
```

The marketplace is named `pstack-all`, like the Claude and Cursor catalogs, so the plugin id is `pstack@pstack-all`.

## Install

```
codex plugin marketplace add <local path of this repo>
codex plugin add pstack@pstack-all
```

The git form, `codex plugin marketplace add dragosdm/pstack-all`, is unverified. `codex plugin add` copies the plugin root into `$CODEX_HOME/plugins/cache/pstack-all/pstack/<version>/`, so later edits to the tree need a reinstall.

Codex names pstack skills `pstack:<name>`. A prompt that mentions `$pstack:<name>` gets that skill's `SKILL.md` as a message.

## Manifest precedence

If the plugin root has a `plugin.json` whose `$schema` starts with `https://agent-plugins.org/schemas/`, Codex reads it as an Agent Plugin and does not read `.codex-plugin/plugin.json`. It then logs `ignoring unknown Agent Plugins manifest field` for `skills` and `agents`, and the model gets no pstack skill. compound-engineering drops that `$schema` for the same reason. Its `docs/specs/agent-plugins.md` adds that Codex cuts an Agent Plugin `SKILL.md` to its first 8000 bytes, and five pstack skills are longer than that, `poteto-mode` at 21670 bytes among them.

So `scripts/sync-manifests.mjs` writes the root `plugin.json`, the Grok CLI entry file, without `$schema`. `scripts/check-grok.sh` passes on it with the same 58 skills and 2 agents as `pstack/`.

If `.agents/plugins/marketplace.json` is missing, Codex reads `.claude-plugin/marketplace.json` from the same root instead. The check fails on that fallback, because Codex documents only the `.agents/plugins/` path.

## Inventory

The model's skill list names 58 `pstack:` skills, the same names as `pstack/skills/`. Codex lists the 57 skills with `disable-model-invocation: true` too. opencode keeps those out of the model's list (`docs/specs/opencode.md`).

`.codex-plugin/plugin.json` declares no agents, so `poteto-agent` and `comment-sicko` are not registered. compound-engineering's plan `docs/plans/2026-04-20-001-feat-codex-native-plugin-manifests-plan.md` says Codex plugins cannot declare agents. pstack-all ships no Codex adapter. `codex features list` in 0.165.0 shows `plugin_hooks` as `removed`, so a plugin cannot add a `SessionStart` line the way the Claude Code entry does.

## Check

`scripts/check-codex.sh` runs Codex with a throwaway `HOME` and `CODEX_HOME`, and a local Responses API mock, `scripts/codex-mock-model.mjs`, as the model provider. It adds the repo root as a marketplace and installs `pstack@pstack-all`. Then it runs one `codex exec` turn that mentions `$pstack:poteto-mode`. It fails if any of these is false:

- `codex plugin list` reads the `pstack-all` marketplace from `.agents/plugins/marketplace.json`.
- The installed version equals the `.codex-plugin/plugin.json` version.
- Codex logs no Agent Plugins manifest warning for pstack.
- The skill list in the request names the same `pstack:` skills as `pstack/skills/`.
- The `poteto-mode` message holds the whole `SKILL.md`, byte for byte.

Set `CODEX_BIN` to choose the binary. No login, network or billing.

## Not verified

- A real model run. The check proves what reaches the model, not what a model does with it.
- Whether a Codex model maps the Cursor names in pstack skills, such as `Task` and `AskQuestion`, to Codex tools without an adapter.
- Install from a git URL, and install through the Codex app. Only a local path was tested.
- Whether `/pstack:<name>` works in the Codex TUI. Only a `$pstack:<name>` mention in `codex exec` was tested.
