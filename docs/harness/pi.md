# pstack in Pi

pstack skills use Cursor names. In Pi, read this file once per session, then map each Cursor name in a skill with the tables below. `<pstack>` means the `pstack/` folder next to this file's `docs/`, the folder that holds `skills/` and `agents/`. If a Cursor field has no row, drop it and say so. Never pass a field or value the tool schema rejects.

pstack's Pi package spawns subagents with the `pstack-subagent` command, which its extension puts on the `bash` tool's `PATH`. Each subagent is a separate Pi in its own tmux session. If `pstack-subagent` is missing, or it fails because tmux is not installed, tell the user once, then do each spawn's work yourself, one at a time, and say so. A subagent cannot spawn subagents. When a skill run inside one calls for `Task`, do that work yourself and say so.

## Spawning

```sh
pstack-subagent spawn --name <role> [--agent <name>] [--provider <p> --model <id> --thinking <effort>] [--tools <list>] [--worktree <ref>] --prompt "<brief>"
pstack-subagent wait <handle>
pstack-subagent stop <handle>
```

- `spawn` returns at once and prints `Spawned <name> (<handle>)` and the subagent's model. Keep the handle. The subagent works in the background.
- A spawn without `--model` runs on the session's model. When any subagent did, your final answer says so in one sentence that names the model and the reason, such as "The subagents ran on the session model openai-codex/gpt-6.1-sol, because no pstack-models.md line names one that this session has."
- `wait` blocks until the subagent finishes and prints its final answer. Give the `bash` call a timeout above 1800 seconds, and run `wait` without pipes or redirects.
- `stop` ends the subagent and deletes its transcript. Stop each subagent once you have its result, unless you will `send` it more work.
- `send <handle> "<message>"` gives an idle subagent a new prompt, or steers a busy one. `--follow-up` queues the message until the current work ends.
- `list` shows this session's subagents, their state and their handles. `--file <path>` attaches a file to the first prompt.
- The user can attach to a running subagent with `/pstack-subagent`.

## Tools

| Cursor | Pi |
| --- | --- |
| `Task` | `pstack-subagent spawn`, then `wait` and `stop`. See Spawning. Several `Task` calls in one message are several `spawn` calls first, then one `wait` per handle. |
| `AskQuestion` | An ask tool if the session offers one, such as `ask_user` from `pi-ask-user`. Otherwise ask in plain text and stop for the answer. |
| Open a todolist | Keep the list in your reply and update it at each phase. |
| Run another pstack skill (`/name` or "the **name** skill") | `read` `<pstack>/skills/<name>/SKILL.md` and follow it. When you tell the user to type it, write `/pstack:<name>`. `/skill:<name>` also works. |
| `Grep`, `Glob` | `bash` with `rg`. |

## Subagent fields

| Cursor | `pstack-subagent spawn` |
| --- | --- |
| `subagent_type: generalPurpose` | Omit `--agent`. |
| `poteto-agent`, `comment-sicko` | `--agent poteto-agent`, `--agent comment-sicko`. The command reads `<pstack>/agents/<name>.md` and appends it to the subagent's system prompt. For `poteto-agent`, put the absolute path of `<pstack>/skills/poteto-mode/SKILL.md` in the prompt, because its fallback search looks in `~/.cursor/plugins/`. |
| `readonly: true` | `--tools read,bash,grep,find,ls`, and the prompt says "do not edit files". Check `git status` afterward. Use `--tools read,grep,find,ls` when the subagent needs no shell, which enforces read-only. |
| `readonly: false` | Omit `--tools`. |
| `environment: "cloud"` | `--worktree HEAD`. The subagent works in a new git worktree on branch `pstack-subagent/<handle>`, and `spawn` prints both. Tell it to commit there. `stop` removes the worktree and keeps the branch. |
| `environment: "local"` | Omit `--worktree`. |
| `cloud_base_branch: <b>` | `--worktree <b>` |
| `run_in_background: true` | Omit. Every spawn runs in the background until you `wait`. |
| `resume` | `pstack-subagent send <handle> "<message>"` when the subagent is not stopped, then `wait`. Otherwise spawn a new one and paste the earlier result into its prompt. |
| `file_attachments` | `--file <path>` for each file. |

## Models

`pi --list-models` lists the providers and model ids this session can use. Without `--provider`, `--model` and `--thinking`, a subagent runs on the session's model and effort.

| Cursor | Pi |
| --- | --- |
| `claude-<family>-<version>-<effort>[-fast]`, `grok-*`, `gpt-*`, or any other slug | `--provider <provider> --model <id> --thinking <effort>` when the models list has a matching id. Drop `-fast`. Otherwise omit all three so the agent runs on the session model, and say so. |
| `auto` or `inherit-parent` | Omit `--provider`, `--model` and `--thinking`. |
| The `pstack-models.mdc` rule, `~/.cursor/rules/pstack-models.mdc` | `~/.pi/agent/pstack-models.md`. Pi does not load it, so read it when a skill needs a role line. If the file or the role's line is missing, use the skill's default slug. |
| A role value `<provider>/<id> <effort>` | `--provider <provider> --model <id> --thinking <effort>`. |

## setup-pstack

Follow its steps with these changes:

- Detect. The detected models are the rows of `pi --list-models`. Write each as `<provider>/<id> <effort>`, with an effort from `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. The effort is the last token, so the budget step works as written.
- Defaults. Map each default slug with the rows above. A default with no matching id is `inherit-parent`.
- Write. Write `~/.pi/agent/pstack-models.md` with no frontmatter, then the comment lines, the `# budget` line, and one line per role. Overwrite the whole file. Never put the role lines in `AGENTS.md`.

## Paths

| Cursor | Pi |
| --- | --- |
| `.cursor/skills/`, `~/.cursor/skills/` | `.pi/skills/`, `~/.pi/agent/skills/` |
| `~/.cursor/plugins/`, `.cursor-plugin/plugin.json` | `pi list` prints where each package lives. pstack's Pi manifest is `package.json` next to `<pstack>`. |
| `.cursor/rules/*.mdc`, always-applied rules | `AGENTS.md`. Pi never reads `.mdc` files. The model rule is the exception. See Models. |
| `https://github.com/cursor/plugins/blob/main/pstack/<path>` | `<pstack>/<path>` when that file exists. Read the local copy and never fetch it. Give the user the URL when they need a link. |
| Transcripts in `~/.cursor/projects/<slug>/agent-transcripts/` | `~/.pi/agent/sessions/<slug>/<timestamp>_<id>.jsonl`. The slug is the workspace path with each `/` changed to `-`, wrapped in `--`, so `/home/you/proj` is `--home-you-proj--`. The newest `.jsonl` in that folder is the current session. Read only this workspace's folder. |

## Cursor-only features

Pi has no Cursor Automations, Bugbot, Cursor cloud agents, or built-in PR tool. When a step needs one, put one line in your reply, `Skipped in Pi: <step>. <reason>.`, then go on to the next step. Do not stop, ask, or retry. When a later step needs what the skipped step made, such as a URL or a key, leave a placeholder and name it in the line.

| Cursor | Pi |
| --- | --- |
| Cursor Automations: routines, `update_state` routine calls, `api2.cursor.sh/automations` webhooks, routine wakes, and `SendToUser` secret requests | Skip with the line. |
| Bugbot | Bugbot comments on a GitHub PR are ordinary review threads, so triage them with the forge command that the step gives. Skip a step that starts, waits for, or configures Bugbot when the PR has no Bugbot check or comment. |
| Cursor cloud agents | `environment: "cloud"` maps to a worktree, as in Subagent fields. Skip a step that needs the cloud agent itself, such as its dashboard status or its own machine. |
| A built-in PR tool | Use the forge command that the step gives, such as `gh pr create`. That is not a skip, so write no line. |
