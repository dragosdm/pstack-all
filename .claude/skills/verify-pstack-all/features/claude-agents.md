# pstack agents in Claude Code

pstack ships two subagents, `poteto-agent` and `comment-sicko`. In Claude Code they register as `pstack:poteto-agent` and `pstack:comment-sicko`, the names the adapter tells skills to spawn.

## Sub-features

- `agents-registered` makes both types available to the `Agent` tool.
- `agents-spawn` lets a skill such as `/pstack:no-comments` spawn `pstack:comment-sicko`.

## How to get to it (user POV)

- Run `/pstack:poteto-mode` on a task. It delegates to `pstack:poteto-agent`.
- Run `/pstack:no-comments` on changed code. It spawns `pstack:comment-sicko`.

## Driving it with drive-claude.sh

Preconditions:

- `doctor.sh <id>` is all `OK`.

- **Registered.** Any drive's `init.json` lists `"agents":["pstack:comment-sicko","pstack:poteto-agent"]`. This is the cheapest proof and comes free with every session.
- **Spawn.** Not yet driven. A candidate is a scratch git repo with one commented change in the instance dir, then `/pstack:no-comments` with `--allowedTools` widened to `Agent`. Proof would be an `Agent` tool call with `subagent_type` `pstack:comment-sicko` in `tools.txt`.

## Gotchas

- `claude plugin details` reports `Agents (0)` for this plugin. Use `init.json`, not `details`.
- A user-level `pstack@cursor-plugins` registers the same names. Only a drive with `--setting-sources project,local` proves that this repo supplied them.
- The spawn journey needs a scratch repo and wider tools. `drive-claude.sh` grants only `Read Glob Grep` today. Add a flag before you drive it. Don't weaken the proof to `agents-registered`.
