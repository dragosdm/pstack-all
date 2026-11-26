# pstack in Antigravity

An Antigravity (`agy`) user installs two plugins from this repo. `pstack`, from `pstack/`, gives the 59 skills as `/pstack:<name>`. `pstack-agy`, from `.agy/`, gives the agents `poteto-agent` and `comment-sicko` and the rule `pstack-adapter`. agy offers that rule's path and description to the model, which reads it before following a skill. The rule does the job of the Claude and Codex `SessionStart` hooks.

## Sub-features

- `agy-install` installs `pstack` with 59 skills and `pstack-agy` with both agents and the rule.
- `agy-skill-names` lists every skill as `pstack:<name>` and nothing else under `pstack:`. `/pstack:how` sends the how skill to the model.
- `agy-adapter-rule` puts the rule `pstack-adapter` and its description in the system instruction.
- `agy-agents` starts a child for `invoke_subagent` on `poteto-agent` or `comment-sicko`, with the agent's body and the write tools.

## How to get to it (user POV)

- `agy plugin install <checkout>/pstack`, then `agy plugin install <checkout>/.agy`. Both are copied into `~/.gemini/config/plugins/`.
- From GitHub: `agy plugin install https://github.com/dragosdm/pstack-all/tree/main/pstack`, then the same URL ending in `/.agy`.
- Type `/pstack:how ...` in a session.

## Driving it with check-agy.sh

Preconditions:

- `agy`, `node` and `jq` on `PATH`. `AGY_BIN` picks another binary. No helper in `scripts/` launches agy, and cells have no Antigravity host.

- **Install, names, rule and agents, free.** Run `scripts/check-agy.sh`. It sets `HOME` and the XDG dirs to a temp folder, so it never touches your `~/.gemini`. It uses a dummy key and a scripted Gemini endpoint, `scripts/agy-mock-model.mjs`. Its output must end with `agy: PASS pstack and pstack-agy install, every skill is pstack:<name>, the rule is offered, both agents spawn with write tools`, after:
  - `agy: .agy passes plugin validate --strict`
  - `agy: pstack installs 59 skills; pstack-agy installs agents comment-sicko,poteto-agent and rule pstack-adapter`
  - `agy: /skills lists pstack:<name> for every skill on disk, and nothing else under pstack:`
  - `agy: /pstack:how sends the how skill to the model`
  - `agy: the system instruction offers rule pstack-adapter with its description`
  - `agy: invoke_subagent poteto-agent starts a child with its body and write_file, edit_file, run_command`, and the same line for `comment-sicko`
- **A real model.** Not scripted. No billed run exists. A real Gemini model following the rule is in `docs/specs/antigravity.md` Not verified. Report it as skipped.

## Gotchas

- The repo root can't be the install source. agy names a skill by its path under the plugin's own `skills/` folder, so a root install names every skill `pstack:..:pstack:skills:<name>`. A root `skills` symlink gives clean names but fails `claude plugin validate --strict`, and agy refuses an `.agy/skills` symlink that points outside `.agy/`.
- Installed from `pstack/` alone, upstream's `poteto-agent` is skipped. Its `model: claude-opus-5-5-xhigh-fast` is not an agy tier. The generated `.agy/agents/` copies drop `model` and add `mainAgent: false` and a tool list. Without a `tools` key, an agent can't edit.
- Both plugins define `comment-sicko`. agy doesn't specify which copy wins. `check-agy.sh` pins it on each run, but another machine or agy version may differ.
- The adapter lives in `.agy/rules/` because agy copies only the plugin folder on install.
- The `.agy` GitHub URL install was verified from the `antigravity-adapter` branch. The `main` URL in `README.md` has not been rerun since the merge.
- Unverified: the interactive TUI (every run used `agy -p`), `~/.gemini/config/rules/pstack-models.md` loading in each session, and the transcript path.
