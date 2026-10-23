# opencode

Last verified 2026-10-23 against `opencode v2.1.4`, whose plugin runtime is Bun 1.4.4.

## Entry files

opencode loads a plugin from a package folder, so its entry is the root `package.json`, shared with Pi. `scripts/sync-manifests.mjs` renders that file once for both harnesses and adds `"main": "index.js"`. This is compound-engineering's shape:

- `index.js` re-exports the default export of `.opencode/plugins/pstack.js`.
- `.opencode/plugins/pstack.js` is the plugin. opencode also auto-discovers it when this repo is opened as a project.
- `.opencode/INSTALL.md` is the install guide.

A local `plugins` entry must name the folder. opencode 2.1.4 rejects a file path with `configured plugin path must be a directory`. It also resolves `index.js` when `main` is missing, so `main` documents the entry and nothing breaks without it.

## Plugin

The plugin exports `{ id: "pstack", setup }`, the V2 shape. It has no V1 `server()` export.

At import it reads one data shape from `pstack/`:

- `skills`, one record per `pstack/skills/<id>/SKILL.md`: `id`, `name`, `description`, `path`, `content` (the body after the frontmatter), and `autoinvoke`. `autoinvoke` is false for `disable-model-invocation: true`, the mapping opencode's own skill loader uses. A skill with `user-invocable: false` would get no command. No pstack skill sets it.
- `agents`, one record per `pstack/agents/*.md`: `id` (frontmatter `name`), `description`, and `body`. Cursor-only fields such as `is_background` are dropped.

The frontmatter is parsed with `Bun.YAML.parse`. pstack descriptions use escaped double quotes and, in `make-bot-ui`, a `>-` folded block. compound-engineering's line parser would mangle both.

`setup` then:

- adds every skill through `ctx.skill.transform`. opencode hides a skill with `autoinvoke: false` from `<available_skills>`, and its `skill` tool still loads it by id.
- adds a `pstack:<id>` command for every skill through `ctx.command.transform`. A command prompts the session with ``Load and execute the `<id>` skill.`` followed by the user's text. The `pstack:` prefix matches Claude Code's `/pstack:<name>`, because pstack skill names such as `how`, `why` and `bro` are generic.
- upserts `poteto-agent` and `comment-sicko` through `ctx.agent.transform` as `mode: "subagent"`, and adds the two denies that opencode gives its built-in `general` agent, `question` and `subagent`. pstack delegates never ask the user or spawn. opencode drops a denied tool from the request, so a child has neither tool.
- registers one `context` hook. For every model request it appends the adapter line, the same sentence as the Claude Code hook and the Pi extension. When the request's agent is a pstack agent, it first appends that agent's body. The plugin does not set the agent's `system`, because that replaces opencode's base prompt. Claude Code and Pi both keep the harness prompt and add the agent body.

The adapter line lands once at the end of the system message of each request, also on later turns of a session. Title generation requests do not pass through the hook.

## Adapter

Upstream ships no opencode adapter, and `pstack/` must stay upstream bytes, so the adapter lives at `docs/harness/opencode.md`. It follows `pstack/docs/harness/claude-code.md` section for section. `Task` maps to the `subagent` tool, which returns the child's answer inside `<subagent sessionID="ses_..." state="completed">`. `resume` maps to that `sessionID`. `environment: "cloud"` maps to a worktree that the parent creates with `git worktree add` under `<git common dir>/pstack-worktrees/`, the same place as the Pi port, because the `subagent` tool has no worktree option.

## Install

```json
{ "plugins": ["pstack@git+https://github.com/dragosdm/pstack-all.git"] }
```

For a local checkout, put the repo root's absolute path in `plugins`. Opening the checkout itself as a project also loads the plugin. With both, opencode keeps the project copy and marks the second `failed` with `Duplicate plugin ID: pstack`, as seen in `/api/plugin`.

## Inventory

Against `opencode serve` with the repo root in `plugins`:

- `/api/plugin` lists `pstack`, source `local`, path `<repo>/index.js`, status `active`.
- `/api/skill` lists 57 skills whose path is under `pstack/skills/`, the same names as on disk. 56 have `autoinvoke: false`. `<available_skills>` in the model's system prompt offers one pstack skill, `setup-pstack`, as Cursor, Claude Code and Pi do.
- `/api/command` lists 57 `pstack:<name>` commands.
- `/api/agent` lists `poteto-agent` and `comment-sicko` as subagents with the `question` and `subagent` denies.

opencode's compatibility loader also reads `~/.claude/skills` and `~/.agents/skills`, so a count must filter by path.

## Check

`scripts/check-opencode.sh` runs `opencode serve` on 127.0.0.1 with `HOME` and every XDG dir in a throwaway folder, `OPENCODE_DISABLE_MODELS_FETCH=1` and `OPENCODE_DISABLE_AUTOUPDATE=1`. It resolves the binary with `mise which opencode` before it moves `XDG_DATA_HOME`. The mise shim installs opencode afresh under a moved data dir. The model is `scripts/opencode-mock-model.mjs`, a scripted OpenAI-compatible server on localhost registered as a V2 custom provider. No login, network or billing. The check:

- polls `/api/plugin` until pstack loads, and requires it active from `index.js` with no plugin error or warning in the server log.
- compares `/api/skill`, `/api/command` and `/api/agent` with the files on disk, as in Inventory.
- prompts a session with `spawn`. The model calls `subagent` for `comment-sicko`, then for `poteto-agent`, and each child answers at once. The parent's request must tell the model to read a file equal to `docs/harness/opencode.md`, and `<available_skills>` must offer exactly the pstack skills without `disable-model-invocation`. Each child's request must hold its agent heading, `# Comment Sicko` or `# Poteto subagent`, and the adapter line, and must have no `subagent` tool. Both children have no `subagent` tool, so the deny removes it.
- posts `pstack:how` to `/api/session/<id>/command`. The model's last user message must be ``Load and execute the `how` skill.`` and `probe`, and its `skill` call must return `<skill_content name="how">` with the body of `pstack/skills/how/SKILL.md`.

It kills the server and the mock on exit. Set `OPENCODE_BIN` to choose the binary.

## Not verified

- opencode 1.x and the V1 plugin API. The plugin has no `server()` export.
- Install from the git URL. Only a local path was loaded.
- A billed model run. No real model has read the adapter or followed a skill in opencode.
- The worktree mapping for `environment: "cloud"` end to end. No run created, used and removed one.
- Slash dispatch in the TUI. `opencode run "/pstack:how"` sends the text as is, so the check posts the command over the API.
- `background: true`, `sessionID` resume, explicit `model` values and the `todo` tool. The scripted run used none of them.

## Gotchas

- `opencode models` and `opencode run` without `--standalone` talk to the background service. With moved XDG dirs, `opencode models` tried to start a second service on the configured port and failed.
- The first `GET /api/plugin` after start can return no local plugin. Plugins load after the server answers.
