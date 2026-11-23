---
trigger: model_decision
description: "Read this before you follow any pstack skill, such as one the user invoked with /pstack:<name>. It maps the Cursor names in pstack skills to Antigravity tools."
---

# pstack in Antigravity

pstack skills use Cursor names. In Antigravity, read this file once per session, then map each Cursor name in a skill with the tables below. If a Cursor field has no row, drop it and say so. Never pass a field or value the tool schema rejects.

## Where pstack lives

This rule ships in the `pstack-agy` plugin, at `<plugins>/pstack-agy/rules/pstack-adapter.md`. `<pstack>` means `<plugins>/pstack/`, the `pstack` plugin folder next to it, which holds `skills/`, `agents/` and `docs/`. Build its absolute path from this file's path.

A skill the user invokes with `/pstack:<name>` arrives without its folder. Resolve each relative link in it, such as `references/explainer-prompt.md`, against `<pstack>/skills/<name>/`.

## Spawning

Antigravity spawns subagents with `invoke_subagent`.

- `invoke_subagent` takes `TypeName`, `Role`, `Prompt`, `Model` and `Workspace`. It returns a `conversationId` at once, and the subagent works in the background.
- Each subagent sends you a message when it finishes. Do not poll. After the spawns, stop calling tools until every subagent you need has reported.
- `send_message` gives a subagent more work by its `conversationId`, and wakes it when it is idle. `manage_subagents` lists or kills them.
- Several `Task` calls in one message are several `invoke_subagent` calls in one turn.

## Tools

| Cursor | Antigravity |
| --- | --- |
| `Task` | `invoke_subagent`. See Spawning. |
| `AskQuestion` | `ask_question`. Put a recommended option first, prefixed with `(Recommended)`. Ask a yes or no question in plain text. |
| Open a todolist | Keep the list in your reply and update it at each phase. |
| Run another pstack skill (`/name` or "the **name** skill") | Read `<pstack>/skills/<name>/SKILL.md` and follow it. When you tell the user to type it, write `/pstack:<name>`. |
| `Grep`, `Glob` | `run_command` with `rg`. |

## Subagent fields

| Cursor | `invoke_subagent` |
| --- | --- |
| `prompt` | `Prompt`. |
| `description` | `Role`, two to five words. |
| `subagent_type: generalPurpose` | `TypeName: "self"`. |
| `poteto-agent`, `comment-sicko` | `TypeName: "poteto-agent"` or `TypeName: "comment-sicko"`. For `poteto-agent`, put the absolute path of `<pstack>/skills/poteto-mode/SKILL.md` in `Prompt`. |
| `readonly: true` | `TypeName: "research"`, which has read-only tools. Keep `subagent_type`'s mapping when it names a pstack agent, and say "do not edit files" in `Prompt`. Check `git status` after it answers. |
| `readonly: false` | Omit. |
| `environment: "cloud"` | `Workspace: "branch"`. Name the branch or commit the subagent checks out in `Prompt`. |
| `environment: "local"` | Omit. |
| `cloud_base_branch: <b>` | Tell the subagent to check out `<b>` first. |
| `run_in_background: true` | Omit. Every subagent runs in the background. |
| `resume` | `send_message` to the subagent's `conversationId`. Spawn a new one when it was killed. |
| `file_attachments` | List the paths in `Prompt`. |

## Models

`invoke_subagent` takes `Model` as a tier: `inherit`, `flash_lite`, `flash` or `pro`. It has no reasoning-effort field.

| Cursor | Antigravity |
| --- | --- |
| A `claude-*`, `grok-*`, `gpt-*` or other slug | Omit `Model` so the subagent runs on your model, and say so in one sentence of your final answer. Drop the effort. |
| `auto` or `inherit-parent` | Omit `Model`. |
| The `pstack-models.mdc` rule, `~/.cursor/rules/pstack-models.mdc` | `~/.gemini/config/rules/pstack-models.md`. Antigravity loads it in every session because its frontmatter is `trigger: always_on`. If the file or the role's line is missing, use the skill's default slug. |
| A role value `pro`, `flash` or `flash_lite` | `Model` with that value. |

## setup-pstack

Follow its steps with these changes:

- Detect. The detected models are the tiers `pro`, `flash` and `flash_lite`. Antigravity takes no per-subagent effort, so write a role as the tier alone, such as `pro`. The budget step changes nothing in Antigravity. Say so when you ask for the budget.
- Defaults. Every skill default is a Claude or Grok slug, so a first setup maps every role to `inherit-parent`.
- Write. Write `~/.gemini/config/rules/pstack-models.md`. Start it with the frontmatter `trigger: always_on` between `---` lines, then the comment lines, the `# budget` line, and one line per role. Overwrite the whole file. Never put the role lines in `AGENTS.md` or `GEMINI.md`.

## Paths

| Cursor | Antigravity |
| --- | --- |
| `.cursor/skills/`, `~/.cursor/skills/` | `.agents/skills/`, `~/.gemini/config/skills/`. |
| `~/.cursor/plugins/`, `.cursor-plugin/plugin.json` | `~/.gemini/config/plugins/<name>/`, `plugin.json`. pstack is the `<pstack>` folder. |
| `.cursor/rules/*.mdc`, always-applied rules | `AGENTS.md` or `GEMINI.md`, or a `.agents/rules/*.md` file with a `trigger` in its frontmatter. Antigravity never reads `.mdc` files. The model rule is the exception. See Models. |
| `https://github.com/cursor/plugins/blob/main/pstack/<path>` | `<pstack>/<path>` when that file exists. Read the local copy and never fetch it. Give the user the URL when they need a link. |
| Transcripts in `~/.cursor/projects/<slug>/agent-transcripts/` | `~/.gemini/antigravity-cli/brain/<conversation-id>/.system_generated/logs/transcript.jsonl`. A subagent's transcript sits under its own `conversationId`. Find subagents by searching `transcript.jsonl` for `invoke_subagent`. |

## Cursor-only features

Antigravity has no Cursor Automations, Bugbot, Cursor cloud agents, or built-in PR tool. When a step needs one, put one line in your reply, `Skipped in Antigravity: <step>. <reason>.`, then go on to the next step. Do not stop, ask, or retry. When a later step needs what the skipped step made, such as a URL or a key, leave a placeholder and name it in the line.

| Cursor | Antigravity |
| --- | --- |
| Cursor Automations: routines, `update_state` routine calls, `api2.cursor.sh/automations` webhooks, routine wakes, and `SendToUser` secret requests | Skip with the line. |
| Bugbot | Bugbot comments on a GitHub PR are ordinary review threads, so triage them with the forge command that the step gives. Skip a step that starts, waits for, or configures Bugbot when the PR has no Bugbot check or comment. |
| Cursor cloud agents | `environment: "cloud"` maps to `Workspace: "branch"`, as in Subagent fields. Skip a step that needs the cloud agent itself, such as its dashboard status or its own machine. |
| A built-in PR tool | Use the forge command that the step gives, such as `gh pr create`. That is not a skip, so write no line. |
