# Graded skill cells

A cell runs one pstack skill in a real harness session, with the plugin loaded natively from a copy of this repo. It grades what the harness recorded: the adapter read, each spawn's agent, read-only flag, worktree and model, git state, remote write attempts, and the answer. `evals/README.md` is the reference. This file covers when to run cells and how to report them.

## Sub-features

- `post` cells: the working tree, on Claude Code (`claude`), Pi (`pi`), Cursor (`cursor`, reference only), Grok CLI (`grok`, reference only), and opencode (`opencode`, reference only).
- `ablate` cells, on Claude, Pi and opencode: the same tree with the adapter delivery removed. The scenario's `control` criteria must fail, which shows the scenario can tell a working adapter from a missing one. Cursor and Grok have no adapter, and the driver silently skips arms a host doesn't support.
- `ref:<sha>` cells for before and after a change, which also covers a base bump. `ab` runs a scenario's `baseline_ref` and the working tree, and refuses a scenario without one. No scenario sets one yet. `upstream` cells, Claude only, use upstream's generated Claude tree and need `PSTACK_UPSTREAM_DIR`.
- `grade <dir>` regrades sealed evidence with no model call, after a criterion or parser change. `--criteria original` grades with the scenario the cell ran with, and reports `not-assessable` when the grading code changed since the run or the cell predates the snapshot. `seal <dir>` seals a hand-built golden case.
- Shims: every cell starts its harness with `git` and `gh` shims first on `PATH`. A `git push` or a GitHub write lands in the cell's `shims.log`, is refused, and fails `noRemoteWrites`.
- The free layer: `scripts/check-eval.sh`, in `scripts/check.sh`, regrades the golden transcripts and runs cells against scripted models. Three Pi cells: a correct `how-complex` run, a wrong one that must fail exactly seven criteria and log a push and a PR, and two `--worktree` workers. Two opencode cells: a correct `how-complex` run and a wrong one that must fail exactly four criteria. It needs `tmux` and opencode, and fails if a `pstack-subagent` tmux session is left behind.

## How to get to it (user POV)

A user never runs cells. A cell is the user's session, `/pstack:<skill>` in Claude Code and opencode, `/skill:<skill>` in Pi, `/<skill>` in Cursor and Grok, typed into a small project and recorded.

## Driving it with cells.mjs

- Run cells when a change touches `.claude-plugin/**`, the hook text, `package.json#pi`, `.pi/**`, `docs/harness/pi.md`, `.opencode/**`, `index.js`, `docs/harness/opencode.md`, root `plugin.json`, `.cursor-plugin/**`, or `base/pstack.lock`. Run them on each affected harness. The post arm always runs. The pre arm (`ref:<base sha>`) runs only when no earlier evidence exists.
- `node evals/cells.mjs run --scenario <ids> --host <hosts> [--arm post,ablate] [--trials 2]`. Evidence goes to `.verify-runs/<stamp>-cells/`, and `summary.md` holds the table. An opencode cell needs a provider in `--opencode-config`, because its data dir starts empty.
- Read each `NOT OK` cell's transcript before you act on it. `announced` is a keyword check. A scenario that every arm passes, or that every arm fails, is not discriminating.
- Report a claim with its run folder, the cells, trials, models and cost. A claim moves out of a spec's Not verified list only with at least two trials on that harness.

## Gotchas

- Tiny fixtures let a model skip fan-out ("I read it directly and skipped the subagents"). How scenarios use `billing-service` for that reason.
- Claude cells skip user settings, so `~/.claude/rules/pstack-models.md` is not loaded and the role defaults apply. Unlike `drive-claude.sh`, they allow `Agent`, edits inside the project and named git subcommands, with `--permission-mode acceptEdits`, and record any other call under `denied`. Pi cells load your global Pi packages and context files. Cursor cells read your user rules.
- opencode cells run `opencode serve` with `HOME` and the XDG dirs in the workbench, and post the command over the API, because `opencode run` sends `/pstack:<name>` as plain text.
- `check-eval.sh` counts every `pstack-subagent-*` tmux session on the machine. A Pi cell or check that runs at the same time in another worktree makes it fail.
- Grok cells install into `~/.grok` for the run and uninstall afterwards, and refuse to start if a `pstack` plugin is already installed. The free Grok Build tier hit its usage limit during the first `how` probe and blocked the next cell.
