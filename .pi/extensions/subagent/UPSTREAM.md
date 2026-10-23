# Upstream

`index.ts`, `shared.ts` and `subagent.ts` start from Mario Zechner's [`badlogic/pi-subagent`](https://github.com/badlogic/pi-subagent) at `4fc1fe5178d1a2b474794a5ee39e7295844e9d3c`. That repo has no license file. Ask its author before publishing this copy.

Diff against that commit to see every change. They are:

- Names. The command is `pstack-subagent`, runs live in `<agent dir>/pstack-subagents/`, tmux sessions are `pstack-subagent-<handle>`, and the child marker is `PSTACK_SUBAGENT_RUN_DIR`. Upstream installed beside pstack would otherwise share runs and deliver each inbox message twice.
- `--agent <name>` appends the body of `pstack/agents/<name>.md` to the child's system prompt.
- `--worktree <ref>` runs the child in a new git worktree on branch `pstack-subagent/<handle>`. Discarding a run removes the worktree and keeps the branch.
- The extension puts `.pi/bin` on `PATH` and exports `PSTACK_PI_BIN`, so the `bash` tool finds `pstack-subagent` and children run the parent's own pi. Upstream needs a symlink in `~/.pi/agent/bin`.
- The first prompt goes to the child as `@<run dir>/task.md`, not as a command-line argument. tmux rejects long command lines with `command too long`, which a real `/skill:how` run hit when it handed three explorers' findings to the explainer.
- The child's environment passes `PI_CODING_AGENT_DIR` and `PATH`, because an already running tmux server keeps the environment it started with.
- `readMetadata` rejects a `metadata.json` whose `runDir` is not the folder it was read from, or whose `tmuxSession` does not match its handle, and a run only removes a worktree at `<runDir>/worktree`. `stop` deletes `runDir` and kills `tmuxSession`, so neither may come from the file alone.
- Dropped: the `pi-test.sh` launcher found in the child's cwd, and the bundled skill. `docs/harness/pi.md` documents the command instead.
