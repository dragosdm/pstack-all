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

- **Install, adapter and subagents, free.** Run `scripts/check-pi.sh`. It installs the repo into a throwaway `PI_CODING_AGENT_DIR`. Its output must end with `pi: PASS repo root installs as a Pi package with every pstack skill, the adapter extension, and working subagents`, after lines for the skill count, the adapter line in a real request, and a mock-model spawn of `comment-sicko` read-only and `poteto-agent` in a worktree.
- **A skill in a real session, billed.** `node evals/cells.mjs run --scenario how-simple,how-complex --host pi` ([Graded skill cells](./cells.md)). Proof is `ok` in `summary.md`, with each cell's `run.json` spawns taken from the child `metadata.json` that `pstack-subagent` writes.

## Gotchas

- Pi cells use your real `~/.pi/agent` for the login, so your global Pi packages and context files load too. The run adds a workbench entry to `~/.pi/agent/trust.json` and restores the file's bytes afterwards.
- An interactive child can't answer a project trust prompt. Worktrees live in `<repo git dir>/pstack-worktrees/<handle>`, inside the trusted project, and every child gets `--extension <package root>` so it keeps the bridge `wait` depends on.
- `pstack-subagent stop` deletes the child's run folder. Set `PSTACK_SUBAGENT_KEEP_DIR` to keep a copy, as cells do.
