# pstack in opencode

pstack skills use Cursor names. In opencode, read this file once per session, then map each Cursor name in a skill with the tables below. `<pstack>` means the `pstack/` folder next to this file's `docs/`, the folder that holds `skills/` and `agents/`. If a Cursor field has no row, drop it and say so. Never pass a field or value the tool schema rejects.

pstack's opencode plugin registers every pstack skill, a `/pstack:<name>` command for each one, and the `poteto-agent` and `comment-sicko` subagents. A subagent cannot spawn subagents or ask the user. When a skill run inside one calls for `Task`, do that work yourself and say so.

## Tools

| Cursor | opencode |
| --- | --- |
| `Task` | The `subagent` tool, with `agent`, `description` and `prompt`. It returns the subagent's final answer. Several `Task` calls in one message are several `subagent` calls with `background: true`, then wait for each completion notice. Do not sleep or poll. |
| `AskQuestion` | The `question` tool. |
| Open a todolist | The `todo` tool if the session offers it. Otherwise keep the list in your reply and update it at each phase. |
| Run another pstack skill (`/name` or "the **name** skill") | The `skill` tool with the skill's id, such as `{"id": "how"}`. It loads the skill even when the skill is not in `<available_skills>`. When you tell the user to type it, write `/pstack:<name>`. |
| `Grep`, `Glob` | `grep`, `glob`. |

## Subagent fields

| Cursor | `subagent` tool |
| --- | --- |
| `subagent_type: generalPurpose` | `agent: "general"` |
| `poteto-agent`, `comment-sicko` | `agent: "poteto-agent"`, `agent: "comment-sicko"`. The plugin adds the agent file from `<pstack>/agents/` to the subagent's system prompt. For `poteto-agent`, put the absolute path of `<pstack>/skills/poteto-mode/SKILL.md` in the prompt, because its fallback search looks in `~/.cursor/plugins/`. |
| `readonly: true` | `agent: "explore"`, and the prompt says "do not edit files". Check `git status` afterward. |
| `readonly: false` | `agent: "general"` |
| `environment: "cloud"` | Before the call, run `git worktree add "$(git rev-parse --git-common-dir)/pstack-worktrees/<name>" -b pstack-subagent/<name> <base>` with the `shell` tool, where `<base>` is `HEAD`. Tell the subagent to work and commit only under that absolute path. After the result, run `git worktree remove` on the path and keep the branch. |
| `environment: "local"` | Omit. |
| `cloud_base_branch: <b>` | `<b>` as the `<base>` of the worktree above. |
| `run_in_background: true` | `background: true` |
| `resume` | `sessionID` set to the earlier subagent's session id, which its result carries. Otherwise start a new subagent and paste the earlier result into its prompt. |
| `file_attachments` | List the paths in the prompt. |

## Models

`opencode models` lists the model ids this session can use, one `provider/model` per line. Without `model`, a subagent runs on the session's model. The `subagent` tool tells you to set `model` only when the user asks for one. A pstack role line, or a model a skill names, counts as that ask.

| Cursor | opencode |
| --- | --- |
| `claude-<family>-<version>-<effort>[-fast]`, `grok-*`, `gpt-*`, or any other slug | `model: "<provider>/<id>"` when `opencode models` lists a matching id, with `#<variant>` for the effort when the provider has variants. Drop `-fast`. Otherwise omit `model` so the agent runs on the session model, and say so in one sentence that names the model and the reason. |
| `auto` or `inherit-parent` | Omit `model`. |
| The `pstack-models.mdc` rule, `~/.cursor/rules/pstack-models.mdc` | `~/.config/opencode/pstack-models.md`. opencode does not load it, so read it when a skill needs a role line. If the file or the role's line is missing, use the skill's default slug. |
| A role value `<provider>/<id> <effort>` | `model: "<provider>/<id>#<effort>"`, or `model: "<provider>/<id>"` when the provider has no variants. |

## setup-pstack

Follow its steps with these changes:

- Detect. The detected models are the lines of `opencode models`. Write each as `<provider>/<id> <effort>`, with an effort from the variants that the provider offers for that model. The effort is the last token, so the budget step works as written.
- Defaults. Map each default slug with the rows above. A default with no matching id is `inherit-parent`.
- Write. Write `~/.config/opencode/pstack-models.md` with no frontmatter, then the comment lines, the `# budget` line, and one line per role. Overwrite the whole file. Never put the role lines in `AGENTS.md`.

## Paths

| Cursor | opencode |
| --- | --- |
| `.cursor/skills/`, `~/.cursor/skills/` | `.opencode/skills/`, `~/.config/opencode/skills/` |
| `~/.cursor/plugins/`, `.cursor-plugin/plugin.json` | The `plugins` entry in `opencode.json` names where pstack lives. pstack's opencode entry is `package.json` and `index.js` next to `<pstack>`. |
| `.cursor/rules/*.mdc`, always-applied rules | `AGENTS.md`. opencode never reads `.mdc` files. The model rule is the exception. See Models. |
| `https://github.com/cursor/plugins/blob/main/pstack/<path>` | `<pstack>/<path>` when that file exists. Read the local copy and never fetch it. Give the user the URL when they need a link. |
| Transcripts in `~/.cursor/projects/<slug>/agent-transcripts/` | Run `opencode session list` from the workspace to list its top-level sessions, newest first. `opencode session export <id>` prints one as JSON. Read only sessions of this workspace. |

## Cursor-only features

opencode has no Cursor Automations, Bugbot, Cursor cloud agents, or built-in PR tool. When a step needs one, put one line in your reply, `Skipped in opencode: <step>. <reason>.`, then go on to the next step. Do not stop, ask, or retry. When a later step needs what the skipped step made, such as a URL or a key, leave a placeholder and name it in the line.

| Cursor | opencode |
| --- | --- |
| Cursor Automations: routines, `update_state` routine calls, `api2.cursor.sh/automations` webhooks, routine wakes, and `SendToUser` secret requests | Skip with the line. |
| Bugbot | Bugbot comments on a GitHub PR are ordinary review threads, so triage them with the forge command that the step gives. Skip a step that starts, waits for, or configures Bugbot when the PR has no Bugbot check or comment. |
| Cursor cloud agents | `environment: "cloud"` maps to a worktree, as in Subagent fields. Skip a step that needs the cloud agent itself, such as its dashboard status or its own machine. |
| A built-in PR tool | Use the forge command that the step gives, such as `gh pr create`. That is not a skip, so write no line. |
