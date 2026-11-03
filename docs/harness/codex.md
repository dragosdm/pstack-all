# pstack in Codex

pstack skills use Cursor names. In Codex, read this file once per session, then map each Cursor name in a skill with the tables below. `<pstack>` means the `pstack/` folder next to this file's `docs/`, the folder that holds `skills/` and `agents/`. If a Cursor field has no row, drop it and say so. Never pass a field or value the tool schema rejects.

## Spawning

Codex spawns subagents with the `collaboration` tools.

- `spawn_agent` takes `task_name`, `message`, `fork_turns`, `model` and `reasoning_effort`. It returns at once, and the subagent works in the background.
- Pass `fork_turns: "none"`. A pstack prompt is written to stand alone, like a Cursor `Task` prompt, and the default `"all"` copies your whole conversation into the subagent.
- `wait_agent` blocks until a subagent has an update or the timeout ends. It does not return the answer. Each subagent's final answer reaches you as a message when it finishes, so call `wait_agent` until every subagent you spawned has answered.
- `send_message` and `followup_task` give a running subagent more work. `interrupt_agent` stops one. `list_agents` shows them.
- A subagent runs with your sandbox and approval settings, and it can spawn subagents of its own.

## Tools

| Cursor | Codex |
| --- | --- |
| `Task` | `spawn_agent`, then `wait_agent` until each answer arrives. See Spawning. Several `Task` calls in one message are several `spawn_agent` calls in one turn. |
| `AskQuestion` | `request_user_input` when the session offers it. Otherwise ask in plain text and stop for the answer. |
| Open a todolist | Keep the list in your reply and update it at each phase. |
| Run another pstack skill (`/name` or "the **name** skill") | Read `<pstack>/skills/<name>/SKILL.md` and follow it. When you tell the user to type it, write `$pstack:<name>`. |
| `Grep`, `Glob` | The shell with `rg`. |

## Subagent fields

| Cursor | `spawn_agent` |
| --- | --- |
| `prompt` | `message`. |
| `description` | `task_name`. |
| `subagent_type: generalPurpose` | Omit. |
| `poteto-agent`, `comment-sicko` | Codex does not register pstack's agents. Read `<pstack>/agents/<name>.md`, and put its body, without the frontmatter, at the top of `message`. For `poteto-agent`, also put the absolute path of `<pstack>/skills/poteto-mode/SKILL.md` in `message`. |
| `readonly: true` | `message` says "do not edit files". Codex has no per-subagent read-only flag, and a subagent gets your sandbox. Check `git status` after it answers. |
| `readonly: false` | Omit. |
| `environment: "cloud"` | Run `git worktree add` yourself, then name the worktree path in `message` and tell the subagent to work and commit there. |
| `environment: "local"` | Omit. |
| `cloud_base_branch: <b>` | Create the worktree from `<b>`. |
| `run_in_background: true` | Omit. Every spawn runs in the background. |
| `resume` | `followup_task` when the subagent is still listed by `list_agents`. Otherwise spawn a new one and paste the earlier result into its `message`. |
| `file_attachments` | List the paths in `message`. |

## Models

The `spawn_agent` description lists the model overrides this session can use, each with its reasoning efforts. Without `model` and `reasoning_effort`, a subagent runs on your model and effort.

| Cursor | Codex |
| --- | --- |
| `gpt-<version>-<effort>`, such as `gpt-6.1-sol-high` | `model: "gpt-6.1-sol"` and `reasoning_effort: "high"`, when `spawn_agent` lists that model with that effort. Drop `-fast`. |
| A `claude-*`, `grok-*` or other slug that `spawn_agent` does not list | Omit `model` and `reasoning_effort` so the subagent runs on your model, and say so in one sentence of your final answer. |
| `auto` or `inherit-parent` | Omit `model` and `reasoning_effort`. |
| The `pstack-models.mdc` rule, `~/.cursor/rules/pstack-models.mdc` | `~/.codex/pstack-models.md`, or `$CODEX_HOME/pstack-models.md` when `CODEX_HOME` is set. Codex does not load it, so read it when a skill needs a role line. If the file or the role's line is missing, use the skill's default slug. |
| A role value `<model> <effort>`, such as `gpt-6.1-sol high` | `model: "gpt-6.1-sol"` and `reasoning_effort: "high"`. |

## setup-pstack

Follow its steps with these changes:

- Detect. The detected models are the overrides that the `spawn_agent` description lists. Write each as `<model> <effort>`, with an effort that the description lists for that model. The effort is the last token, so the budget step works as written.
- Defaults. Map each default slug with the rows above. A default that `spawn_agent` does not list is `inherit-parent`.
- Write. Write the rule file named in Models with no frontmatter, then the comment lines, the `# budget` line, and one line per role. Overwrite the whole file. Never put the role lines in `AGENTS.md`.

## Paths

| Cursor | Codex |
| --- | --- |
| `.cursor/skills/`, `~/.cursor/skills/` | `.agents/skills/`, `$CODEX_HOME/skills/`. `$CODEX_HOME` is `~/.codex` when it is not set. |
| `~/.cursor/plugins/`, `.cursor-plugin/plugin.json` | `$CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>/`, `.codex-plugin/plugin.json`. pstack's Codex manifest is `.codex-plugin/plugin.json` next to `<pstack>`. |
| `.cursor/rules/*.mdc`, always-applied rules | `AGENTS.md`. Codex never reads `.mdc` files. The model rule is the exception. See Models. |
| `https://github.com/cursor/plugins/blob/main/pstack/<path>` | `<pstack>/<path>` when that file exists. Read the local copy and never fetch it. Give the user the URL when they need a link. |
| Transcripts in `~/.cursor/projects/<slug>/agent-transcripts/` | `$CODEX_HOME/sessions/<yyyy>/<mm>/<dd>/rollout-<timestamp>-<id>.jsonl`. Each subagent has its own rollout file in the same tree. Read only rollouts whose `session_meta` `cwd` is this workspace. |

## Cursor-only features

Codex has no Cursor Automations, Bugbot, Cursor cloud agents, or built-in PR tool. When a step needs one, put one line in your reply, `Skipped in Codex: <step>. <reason>.`, then go on to the next step. Do not stop, ask, or retry. When a later step needs what the skipped step made, such as a URL or a key, leave a placeholder and name it in the line.

| Cursor | Codex |
| --- | --- |
| Cursor Automations: routines, `update_state` routine calls, `api2.cursor.sh/automations` webhooks, routine wakes, and `SendToUser` secret requests | Skip with the line. |
| Bugbot | Bugbot comments on a GitHub PR are ordinary review threads, so triage them with the forge command that the step gives. Skip a step that starts, waits for, or configures Bugbot when the PR has no Bugbot check or comment. |
| Cursor cloud agents | `environment: "cloud"` maps to a worktree, as in Subagent fields. Skip a step that needs the cloud agent itself, such as its dashboard status or its own machine. |
| A built-in PR tool | Use the forge command that the step gives, such as `gh pr create`. That is not a skip, so write no line. |
