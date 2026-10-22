# Run a pstack skill in Claude Code

A user types `/pstack:<skill>` in Claude Code. The SessionStart hook has already told the model where the Claude Code adapter is, and the model follows the skill with Claude Code names: `Agent` for `Task`, `~/.claude/rules/` for `.cursor/rules/`, and `/pstack:<name>` for `/<name>`.

## Sub-features

- `run-hook` makes the SessionStart hook print the adapter path under this repo.
- `run-adapter` has the model read `pstack/docs/harness/claude-code.md` while following a skill.
- `run-help` answers a `/pstack:poteto-help` question with Claude Code paths and commands.

## How to get to it (user POV)

- Type `/pstack:poteto-help <question>` in a Claude Code session.
- Type any other `/pstack:<skill>`. `poteto-help` is the cheap one, because it answers and does not start work.

## Driving it with drive-claude.sh

Preconditions:

- `doctor.sh <id>` is all `OK`, including the Claude login line.

- **Ask a help question.** Run `drive-claude.sh <id> poteto-help-models '/pstack:poteto-help how do I choose which model each pstack role uses, and where does that setting live?'`. Exit `0`.
- **Loaded plugin.** `drive-poteto-help-models/init.json` lists `{"name":"pstack","path":"<repo>","source":"pstack@inline"}`, agents `pstack:comment-sicko` and `pstack:poteto-agent`, and `"pstack_commands":57`. No other pstack plugin is listed.
- **Hook.** `hooks.txt` is one line, `SessionStart:startup: pstack skills use Cursor names. Before you follow a pstack skill, read <repo>/pstack/docs/harness/claude-code.md once per session.`
- **Adapter read.** `tools.txt` has `Read {"file_path":"<repo>/pstack/docs/harness/claude-code.md"}`.
- **Answer.** `answer.md` tells the user to type `/pstack:setup-pstack` and names `~/.claude/rules/pstack-models.md` as where the setting lives in Claude Code.

## Gotchas

- The hook says "before", but the model may read the routed skill file first and the adapter second. The 2026-10-22 run did. The proof is that the adapter read happens and the answer uses its mappings, not the order.
- `poteto-help` checks the user's real state, so the session may `Read` your real `~/.claude/rules/pstack-models.md`. That is the user path. The answer then describes your setup.
- The model may try `Bash`, which `--allowedTools` does not grant. That shows up in `denied.txt`. A denial is fine unless the answer depended on it.
- Answers vary between runs. Two runs agreeing on the paths and commands is stronger than one.
