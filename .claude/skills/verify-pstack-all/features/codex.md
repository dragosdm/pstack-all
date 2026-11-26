# pstack in Codex

A Codex user adds this repo as a marketplace with `codex plugin marketplace add <path of this repo>`, then runs `codex plugin add pstack@pstack-all`. Codex reads `.agents/plugins/marketplace.json` and `.codex-plugin/plugin.json`, and copies the repo root into its plugin cache. The user types `$pstack:<name>`. A `SessionStart` hook in `.codex-plugin/hooks.json` gives the model the adapter line, which points at `docs/harness/codex.md`, but only after the user trusts the hook in the TUI. Codex plugins can't register agents, so the adapter has the model put `pstack/agents/<name>.md` into the `spawn_agent` message.

## Sub-features

- `codex-install` reads the `pstack-all` marketplace from `.agents/plugins/marketplace.json` and installs `pstack@pstack-all` at the `.codex-plugin/plugin.json` version.
- `codex-inventory` gives the model the same 59 `pstack:` skill names as `pstack/skills/`.
- `codex-adapter-hook` gives the model the adapter line once the hook is trusted.
- `codex-skill-run` turns a `$pstack:<name>` mention into the whole `SKILL.md` as a message.

## How to get to it (user POV)

- `codex plugin marketplace add <local path>`, then `codex plugin add pstack@pstack-all`. Start the TUI once and choose "Trust all and continue" at the "Hooks need review" prompt.
- Type `$pstack:poteto-mode ...` or another `$pstack:<name>`.

## Driving it with check-codex.sh

Preconditions:

- `codex`, `node` and `jq` on `PATH`. `CODEX_BIN` picks another binary. No helper in `scripts/` launches Codex, and cells have no Codex host.

- **Install, hook, inventory and skill delivery, free.** Run `scripts/check-codex.sh`. It uses a throwaway `HOME` and `CODEX_HOME` and a local Responses API mock, `scripts/codex-mock-model.mjs`. It reads the hook list from `codex app-server` and trusts the hook the way the TUI does, then runs one `codex exec` turn. Its output must end with `codex: PASS`, after:
  - `codex: the pstack-all marketplace is read from .agents/plugins/marketplace.json`
  - `codex: pstack@pstack-all installed version <version> into the plugin cache`
  - `codex: hooks/list shows the pstack SessionStart hook from .codex-plugin/hooks.json, untrusted until the user trusts it`
  - `codex: the trusted hook gives the model the adapter line, naming the installed docs/harness/codex.md`
  - `codex: the model's skill list names 59 pstack: skills, the same names as pstack/skills`
  - `codex: $pstack:poteto-mode reached the model as the whole SKILL.md, <bytes> bytes`
- **A real model.** Not scripted. The 2026-11-03 real-session runs in `docs/specs/codex.md` were manual: `codex exec` and the TUI with a ChatGPT login, under a throwaway `CODEX_HOME`, with the hook trusted by hand. They bill the user's OpenAI account. Report a real-model claim as skipped unless you repeat that run and name its evidence.

## Gotchas

- `codex exec` never asks for hook trust and skips an untrusted hook without saying so. A user who has never opened the TUI gets no adapter. The trust is stored in `config.toml` under `[hooks.state."pstack@pstack-all:.codex-plugin/hooks.json:session_start:0:0"]`.
- `codex features list` shows `plugin_hooks` as `removed`, but plugin hooks still run. Don't trust that flag.
- The install is a copy. Reinstall after editing the repo.
- The root `plugin.json` must have no `$schema`. With an Agent Plugins `$schema` there, Codex skips `.codex-plugin/plugin.json` and loads no pstack skill.
- The hook file is `.codex-plugin/hooks.json`, not `hooks/hooks.json`, because Claude Code would load that default path from the same root as a second adapter hook.
- Without `.agents/plugins/marketplace.json`, Codex falls back to `.claude-plugin/marketplace.json` without saying so. The check fails on that fallback.
- Unverified: `/pstack:<name>` in the TUI, install from a git URL or the Codex app, and the text of spawn messages, which Codex encrypts.
