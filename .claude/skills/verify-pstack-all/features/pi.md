# pstack in Pi

A Pi user runs `pi install <this repo>` (or `pi install -l` for one project). Pi reads the `pi` key of the root `package.json`: it loads `pstack/skills/` as `/skill:<name>` commands, `.pi/extensions/pstack.ts`, which points the model at `docs/harness/pi.md` and lets users type `/pstack:<name>`, and `.pi/extensions/subagent/`, which puts the `pstack-subagent` command on the `bash` tool's `PATH`.

## Sub-features

- `pi-install` lists every pstack skill as a `/skill:<name>` command.
- `pi-adapter` adds the line that tells the model to read `docs/harness/pi.md`.
- `pi-subagents` spawns, waits for and stops subagents through `pstack-subagent`, with `--agent`, `--tools` and `--worktree`.

## How to get to it (user POV)

- `pi install <this repo>`, then type `/pstack:how ...` or `/skill:how ...` in a session. Cells still drive `/skill:<name>`, so they pass without the extension.
- A skill that fans out, such as `/skill:how` on a large question, runs `pstack-subagent spawn` itself.

## Driving it with check-pi.sh and cells

Preconditions:

- `pi` and `tmux` on `PATH`. No helper in `scripts/` launches Pi.

- **Install, adapter and subagents, free.** Run `scripts/check-pi.sh`. It installs the repo into a throwaway `PI_CODING_AGENT_DIR` and drives Pi against a scripted mock model. Its output must end with `pi: PASS repo root installs as a Pi package with every pstack skill, the adapter extension, and working subagents`. The lines before it include:
  - `pi: get_commands lists 58 skills from pstack/skills, the same names as on disk`
  - `pi: run inside the checkout with pstack installed from another path too, each pstack:<name> is listed once, without a suffix`, which also proves that a second copy of either extension stays inert
  - `pi: the system prompt of a print run tells the model to read docs/harness/pi.md`
  - `pi: /pstack:how loads the how skill with its arguments`
  - `pi: a print run spawned comment-sicko read-only and poteto-agent in a worktree through pstack-subagent, and waited for both`. The poteto child starts a `pi --mode rpc` of its own, which must not take over the child's run.
  - `pi: stop removed both runs, their tmux sessions and the worktree, and kept branch pstack-subagent/<handle>`
- **A skill in a real session, billed.** `node evals/cells.mjs run --scenario how-simple,how-complex --host pi` ([Graded skill cells](./cells.md)). Proof is `ok` in `summary.md`, with each cell's `run.json` spawns taken from the child `metadata.json` that `pstack-subagent` writes.

## Gotchas

- Pi cells use `--pi-agent-dir`, else `$PI_CODING_AGENT_DIR`, else your real `~/.pi/agent`, for the login, so your global Pi packages and context files load too. `evals/cells.mjs` adds a workbench entry to that dir's `trust.json` and afterwards restores the file's bytes. If something else changed the file meanwhile, it removes only the workbench entry.
- An interactive child can't answer a project trust prompt. Worktrees live in `<repo git dir>/pstack-worktrees/<handle>`, inside the trusted project. Every child gets `--extension <package root>`, or only the subagent extension under `--no-extensions`, so it keeps the bridge that `wait` depends on.
- A child pi learns it is the bridge from the `--pstack-subagent-run <run dir>` flag on its own argv, not from the environment. Any `pi` the child starts lacks the flag, so it can't claim the run. `PSTACK_SUBAGENT_RUN_DIR` still exists, but only to refuse nested spawns.
- `pstack-subagent stop` deletes the child's run folder. Set `PSTACK_SUBAGENT_KEEP_DIR` to keep a copy, as cells do.
