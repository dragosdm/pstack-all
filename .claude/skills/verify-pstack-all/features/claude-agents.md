# pstack agents in Claude Code

pstack ships two subagents, `poteto-agent` and `comment-sicko`. In Claude Code they register as `pstack:poteto-agent` and `pstack:comment-sicko`, the names the adapter tells skills to spawn.

## Sub-features

- `agents-registered` makes both types available to the `Agent` tool.
- `agents-spawn` lets a skill such as `/pstack:no-comments` spawn `pstack:comment-sicko`.

## How to get to it (user POV)

- Run `/pstack:poteto-mode` on a task. It delegates to `pstack:poteto-agent`, unless the user's model rule sets that playbook's role to `inherit-parent` or `auto`. Then it spawns `general-purpose` on the parent model.
- Run `/pstack:no-comments` on changed code. It spawns `pstack:comment-sicko`.

## Driving it with drive-claude.sh and cells

- **Registered.** Any drive's `init.json` lists `"agents":["pstack:comment-sicko","pstack:poteto-agent"]`. This is the cheapest proof and comes free with every session. `doctor.sh <id>` must be all `OK` first.
- **Spawn.** `drive-claude.sh` grants only `Read Glob Grep`, so it can't spawn. The `no-comments-agent` cell can: `node evals/cells.mjs run --scenario no-comments-agent --host claude --trials 2`. It sets up a fixture repo with a comment-heavy file, allows `Agent`, and accepts edits inside the project ([Graded skill cells](./cells.md)). Proof is `"agent": "pstack:comment-sicko"` in each cell's `run.json` spawns, the raw `subagent_type`. `run.json` is pretty-printed, so the string has a space after the colon. Read that, not `grade.json`, because the `agent` criterion strips the `pstack:` prefix.

## Gotchas

- `claude plugin details` reports `Agents (0)` for this plugin. Use `init.json`, not `details`.
- A user-level `pstack@cursor-plugins` registers the same names. Only a drive with `--setting-sources project,local` proves that this repo supplied them.
- Two cell trials (2026-10-23, `.verify-runs/20261023T103649Z-maint-claude-agents/`) each spawned `pstack:comment-sicko` on Sonnet, as did an earlier single trial and one on the 0.15.46 base (2026-11-23, `.verify-runs/20261123T214228Z-cells/`). No run has spawned `pstack:poteto-agent`, and no scenario covers `/pstack:poteto-mode`. Don't weaken the spawn proof to `agents-registered`.
- Since 0.15.46, `pstack/agents/poteto-agent.md` has `model: claude-opus-5-5-xhigh-fast`, a Cursor slug. The adapter tells the model to pass `model` and `effort` on every `pstack:poteto-agent` spawn so the slug never reaches the API. A poteto-agent spawn proof must show both fields in the `run.json` spawn. No run has checked them yet.
