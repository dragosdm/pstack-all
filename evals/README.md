# Cells

`pstack/` is upstream bytes, so this repo cannot change what a skill says. It changes how each harness loads the skills: entry manifests, the Claude `SessionStart` hook, the Pi extension and adapter, and `pstack-subagent`. A cell checks that layer. It runs one pstack skill in a real harness session, loaded natively from a copy of this repo, and grades what the harness recorded.

compound-engineering runs its skill evals by injecting a skill's folder by path and bypassing the install. That isolates the skill's prose, which is what CE changes. Here the install is the thing that changes, so cells load the plugin the way a user does.

## Commands

```
node evals/cells.mjs list
node evals/cells.mjs run --scenario <ids|all> --host <claude,pi,cursor,grok> [--arm post,ablate,ref:<sha>,upstream] [--trials N]
node evals/cells.mjs grade <run dir or cell dir>
node evals/cells.mjs check
```

`run` bills each harness's own login. It refuses to start without `--scenario` and `--host`. Evidence goes to `.verify-runs/<stamp>-cells/`, or to `--out`, with one folder per cell and `summary.md` at the top. It exits 0 when every gated cell is ok, 1 otherwise, and 2 when nothing ran.

Options: `--claude-model` (default `sonnet`), `--claude-budget` (USD per cell, default 2), `--pi-model provider/id[:thinking]` (default `openai-codex/gpt-6.1-sol:medium`, or `PSTACK_CELL_PI_MODEL`), `--cursor-model`, `--grok-model`, `--pi-agent-dir`, `--timeout` (seconds per cell, default 900).

`grade` checks each cell's `manifest.json`, then normalizes and grades again from the sealed evidence, with no model call. Use it after changing a criterion or a host parser.

`check` is the free part, run by `scripts/check-eval.sh` in `scripts/check.sh`. It checks the scenario table and regrades `golden/`, real transcripts with expected verdicts. The layer also runs three Pi cells end to end against `scripts/pi-mock-model.mjs`. `mock/how-complex-good.json` must pass. `mock/how-complex-wrong.json` must fail exactly the six criteria it breaks. `mock/swarm-worktree-good.json` must pass, with two `--worktree` workers started together and stopped.

## What a cell is

A cell is a scenario, a host, an arm and a trial.

- **Scenario** (`scenarios.mjs`). A pstack skill, a prompt as a user types it, a fixture project, expected criteria, and `control`, the criteria the ablate arm must fail.
- **Host** (`hosts/*.mjs`). How the harness is launched, and how its transcript becomes a normalized run. `claude` uses `claude -p --plugin-dir <tree> --setting-sources project,local`. `pi` uses `pi install -l <tree>` in the project, then `pi -p --approve`. `cursor` uses `cursor-agent -p --trust --plugin-dir <tree>/pstack`. `grok` installs the tree with `grok plugin install <tree> --trust`, runs `grok -p --output-format streaming-json --always-approve`, and uninstalls when the run ends. Cursor runs pstack natively with no adapter, and pstack-all ships no Grok adapter, so both are reference columns and never gate.
- **Arm**. `post` is the working tree. `ablate` removes the adapter delivery: the hook on Claude, `.pi/extensions/pstack.ts` on Pi. `ref:<sha>` is the tree at a commit, which also covers a base bump, since `pstack/` comes along. `upstream` is upstream's generated Claude tree at the locked commit, which needs `PSTACK_UPSTREAM_DIR`.

The plugin tree holds only what harnesses load: `pstack/`, `.claude-plugin/`, `.cursor-plugin/`, `plugin.json`, `package.json`, `.pi/`, `docs/harness/`. The session never sees this folder.

## Criteria

`criteria.mjs` grades a normalized run with fields `loaded`, `adapterRead`, `spawns[{turn, agent, readonly, worktree, model, effort}]`, `final`, `dirty`, `stagedChanged`, `rulesChanged`, `leftover`. Spawns come from what the harness recorded:

- On Claude, from the parent's `Agent` tool calls. `turn` is the assistant message.
- On Pi, from the `metadata.json` that `pstack-subagent` writes for each child, kept through `PSTACK_SUBAGENT_KEEP_DIR`. A child started before an earlier child finished shares its turn.
- On Cursor, from `taskToolCall` events. `turn` is the model call.
- On Grok, from `spawn_subagent` tool calls. `turn` is the call id's model-call part. The tool takes no model or read-only field, and parent and subagent text arrive interleaved, so Grok's answer text is only rough.

Verdicts are `pass`, `fail` or `n/a`. A post-like cell is ok when nothing fails. An ablate cell is ok when every control criterion fails. `announced` is a keyword check on the answer, so read the answer before you trust it.

## Safety and isolation

- Cells run in `$TMPDIR/workbench-*`, which is deleted afterwards. The fixture is a fresh git repo per cell.
- `~/.claude/rules/pstack-models.md`, `~/.pi/agent/pstack-models.md` and `~/.cursor/rules/pstack-models.mdc` are snapshotted around each cell and restored if a session changed them. `rulesUntouched` then fails.
- Claude runs without user settings, so an installed pstack can't answer for the tree. It gets `--permission-mode acceptEdits`, so edits are accepted only inside the project. It gets an allowlist: read tools, `Agent`, edits, and Bash for git, node and read-only commands. Web tools are disallowed. Any other call is denied, and the run lists it under `denied`.
- Pi runs with your `~/.pi/agent` for its login. Your global Pi packages and context files load too. The workbench gets a `trust.json` entry for the run, and the file's original bytes are restored afterwards. Children left running are stopped, kept, and counted by `noLeftover`.
- Cursor loads your user state. It read `~/.claude/rules/pstack-models.md` in the first probe.
- Grok runs with `--always-approve` but `--deny` on every tool that writes or executes, because its cells are read-only `how` scenarios. Grok has no per-project plugin scope, so a Grok run installs pstack into `~/.grok` and uninstalls it afterwards. It refuses to start if a `pstack` plugin is already installed. The free Grok Build tier stops a run partway once its usage limit is reached.

## Adding a scenario

Add a row to `scenarios.mjs` with a `why`, a negative control, and a prompt that never names how it is observed (`check` rejects words like eval or test). Add fixture files under `fixtures/` or an overlay under `overlays/`. Run `check`, then one billed trial, and read the transcript before you trust the verdict. To turn a real run into a golden case, copy its cell folder to `golden/<name>/`, replace personal paths, write `expected.json` from the requirement rather than from the run, and run `node evals/cells.mjs seal golden/<name>`.
