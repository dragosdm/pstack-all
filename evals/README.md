# Cells

`pstack/` is upstream bytes, so this repo cannot change what a skill says. It changes how each harness loads the skills: entry manifests, the Claude `SessionStart` hook, the Pi extension and adapter, the opencode plugin, and `pstack-subagent`. A cell checks that layer. It runs one pstack skill in a real harness session, loaded natively from a copy of this repo, and grades what the harness recorded.

compound-engineering runs its skill evals by injecting a skill's folder by path and bypassing the install. That isolates the skill's prose, which is what CE changes. Here the install is the thing that changes, so cells load the plugin the way a user does.

## Commands

```
node evals/cells.mjs list
node evals/cells.mjs run --scenario <ids|all> --host <claude,pi,cursor,grok,opencode> [--arm post,ablate,ref:<sha>,upstream,ab] [--trials N]
node evals/cells.mjs grade <run dir or cell dir> [--criteria current|original]
node evals/cells.mjs check
```

`run` bills each harness's own login. It refuses to start without `--scenario` and `--host`. Evidence goes to `.verify-runs/<stamp>-cells/`, or to `--out`, with one folder per cell and `summary.md` at the top. It exits 0 when every gated cell is ok, 1 otherwise, and 2 when nothing ran.

Options: `--claude-model` (default `sonnet`), `--claude-budget` (USD per cell, default 2), `--pi-model provider/id[:thinking]` (default `openai-codex/gpt-6.1-sol:medium`, or `PSTACK_CELL_PI_MODEL`), `--cursor-model`, `--grok-model`, `--opencode-model provider/id`, `--opencode-config <file>`, `--pi-agent-dir`, `--timeout` (seconds per cell, default 900). `--opencode-config` is JSON merged into the cell's `opencode.json`, such as a `providers` entry.

`grade` checks each cell's `manifest.json`, then normalizes and grades again from the sealed evidence, with no model call. Use it after changing a criterion or a host parser. `--criteria current`, the default, grades with today's scenario and today's code. `--criteria original` grades with the scenario the cell ran with. It reports `not-assessable`, neither ok nor failed, when the grading code changed since the run or the cell predates the snapshot. Compare runs under the same criteria and code before you call a change an improvement. A regrade under a corrected criterion is a reassessment, not a better model.

`check` is the free part, run by `scripts/check-eval.sh` in `scripts/check.sh`. It checks the scenario table and regrades `golden/`, real transcripts with expected verdicts. The layer also runs cells end to end against scripted models. Three Pi cells run against `scripts/pi-mock-model.mjs`. `mock/how-complex-good.json` must pass. `mock/how-complex-wrong.json` must fail exactly the seven criteria it breaks, and its `shims.log` must hold the parent's `gh pr create` and a subagent's `git push`. `mock/swarm-worktree-good.json` must pass, with two `--worktree` workers started together and stopped. Two opencode cells run against `scripts/opencode-mock-model.mjs`. `mock/opencode-how-complex-good.json` must pass. `mock/opencode-how-complex-wrong.json` reads no adapter, starts no subagent and pushes from the shell tool, so it must fail exactly `adapter`, `spawns`, `parallel` and `noRemoteWrites`.

## What a cell is

A cell is a scenario, a host, an arm and a trial.

- **Scenario** (`scenarios.mjs`). A pstack skill, a prompt as a user types it, a fixture project, expected criteria, and `control`, the criteria the ablate arm must fail. An optional `baseline_ref` names the commit before the change the scenario guards.
- **Host** (`hosts/*.mjs`). How the harness is launched, and how its transcript becomes a normalized run. `claude` uses `claude -p --plugin-dir <tree> --setting-sources project,local`. `pi` uses `pi install -l <tree>` in the project, then `pi -p --approve`. `cursor` uses `cursor-agent -p --trust --plugin-dir <tree>/pstack`. `grok` installs the tree with `grok plugin install <tree> --trust`, runs `grok -p --output-format streaming-json --always-approve`, and uninstalls when the run ends. `opencode` writes a throwaway `opencode.json` whose `plugins` entry is the tree, starts `opencode serve`, and posts the `pstack:<skill>` command to a session, as the TUI does. `opencode run "/pstack:how"` would send the text as is. Cursor runs pstack natively with no adapter, and pstack-all ships no Grok adapter, so both are reference columns and never gate. opencode is a reference column too, because only scripted models have run it.
- **Arm**. `post` is the working tree. `ablate` removes the adapter delivery: the hook on Claude, `.pi/extensions/pstack.ts` on Pi, the adapter line of the context hook on opencode. `ref:<sha>` is the tree at a commit, which also covers a base bump, since `pstack/` comes along. `upstream` is upstream's generated Claude tree at the locked commit, which needs `PSTACK_UPSTREAM_DIR`. `ab` is `ref:<baseline_ref>,post` for each selected scenario, and `run` refuses before anything starts when a selected scenario has no `baseline_ref`. No scenario sets one yet. Before 0c59caa the Pi tree kept no child records to grade, and the Claude hook has not changed since it was added, so no earlier commit gives a comparison the criteria can see.

The plugin tree holds only what harnesses load: `pstack/`, `.claude-plugin/`, `.cursor-plugin/`, `plugin.json`, `package.json`, `index.js`, `.pi/`, `.opencode/`, `docs/harness/`. A `ref:` tree takes the ones that commit has. The session never sees this folder.

Each `cell.json` records `scenarioSnapshot`, the scenario object the cell ran with, and `gradingSha`, a sha256 of `criteria.mjs`, `hosts/common.mjs` and the host module. Original-mode grading reads both.

## Criteria

`criteria.mjs` grades a normalized run with fields `loaded`, `adapterRead`, `spawns[{turn, agent, readonly, worktree, model, effort}]`, `final`, `dirty`, `stagedChanged`, `rulesChanged`, `remoteWrites`, `leftover`. Spawns come from what the harness recorded:

- On Claude, from the parent's `Agent` tool calls. `turn` is the assistant message.
- On Pi, from the `metadata.json` that `pstack-subagent` writes for each child, kept through `PSTACK_SUBAGENT_KEEP_DIR`. A child started before an earlier child finished shares its turn.
- On Cursor, from `taskToolCall` events. `turn` is the model call.
- On Grok, from `spawn_subagent` tool calls. `turn` is the call id's model-call part. The tool takes no model or read-only field, and parent and subagent text arrive interleaved, so Grok's answer text is only rough.
- On opencode, from the root session's `subagent` tool calls. `turn` is the assistant message. `agent: "explore"` is read-only. A spawn has a worktree when its prompt names a `pstack-worktrees/` path, because the tool has no worktree option. `loaded` needs the plugin active from the tree's `index.js` and a `skill` call that loaded from the tree.

Verdicts are `pass`, `fail` or `n/a`. A post-like cell is ok when nothing fails. An ablate cell is ok when every control criterion fails. `announced` is a keyword check on the answer, so read the answer before you trust it. `noRemoteWrites` fails when `shims.log` has a line, and is `n/a` for a cell sealed without one, as the golden cells are.

## Safety and isolation

- Cells run in `$TMPDIR/workbench-*`, which is deleted afterwards. The fixture is a fresh git repo per cell.
- Each cell's harness starts with a shim folder first on `PATH`, outside the project, and every child it starts inherits it. `git push`, a `gh pr` write, and a `gh api` call that writes are logged to the cell's `shims.log` and refused with the error an offline machine prints. Every other `git` or `gh` call runs the real binary. A git alias that expands to `push` is not caught.
- `~/.claude/rules/pstack-models.md`, `~/.pi/agent/pstack-models.md` and `~/.cursor/rules/pstack-models.mdc` are snapshotted around each cell and restored if a session changed them. `rulesUntouched` then fails.
- Claude runs without user settings, so an installed pstack can't answer for the tree. It gets `--permission-mode acceptEdits`, so edits are accepted only inside the project. It gets an allowlist: read tools, `Agent`, edits, Bash for named git subcommands (status, diff, log, show, add, commit, branch, worktree and the like), and read-only commands such as `ls`, `rg` and `cat`. No `node`, no `find`, no `git config`, no `git push`. Web tools are disallowed. Any other call is denied, and the run lists it under `denied`.
- Pi runs with your `~/.pi/agent` for its login. Your global Pi packages and context files load too. The workbench gets a `trust.json` entry for the run, and the file's original bytes are restored afterwards. Children left running are stopped, kept, and counted by `noLeftover`.
- Cursor loads your user state. It read `~/.claude/rules/pstack-models.md` in the first probe.
- Grok runs with `--always-approve` but `--deny` on every tool that writes or executes, because its cells are read-only `how` scenarios. Grok has no per-project plugin scope, so a Grok run installs pstack into `~/.grok` and uninstalls it afterwards. It refuses to start if a `pstack` plugin is already installed. The free Grok Build tier stops a run partway once its usage limit is reached.
- opencode runs with `HOME` and every XDG dir in the cell's workbench folder, so none of your opencode config, login or `~/.claude/skills` loads. A billed run needs its provider in `--opencode-config`. The `question`, `webfetch` and `websearch` tools are denied. Other tools keep opencode's defaults, so the shell is open as on Pi. A permission ask is rejected and listed under `denied`. The binary comes from `OPENCODE_BIN`, `mise which opencode`, or `PATH`, resolved before the XDG dirs move.

## Adding a scenario

Add a row to `scenarios.mjs` with a `why`, a negative control, and a prompt that never names how it is observed (`check` rejects words like eval or test). Add fixture files under `fixtures/` or an overlay under `overlays/`. Set `baseline_ref` only when a commit before the change exists whose tree the criteria can grade, and say why in `why`. `check` rejects a `baseline_ref` that is not a commit. Run `check`, then one billed trial, and read the transcript before you trust the verdict. To turn a real run into a golden case, copy its cell folder to `golden/<name>/`, replace personal paths, write `expected.json` from the requirement rather than from the run, and run `node evals/cells.mjs seal golden/<name>`.
