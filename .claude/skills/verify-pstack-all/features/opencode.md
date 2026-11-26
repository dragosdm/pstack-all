# pstack in opencode

An opencode user adds this repo to the `plugins` array of `opencode.json`. Examples are `"pstack@git+https://github.com/dragosdm/pstack-all.git"`, or for local development the absolute path of the repo root. opencode imports `index.js` through `package.json#main`, which re-exports `.opencode/plugins/pstack.js`. The plugin registers the 59 pstack skills, one `/pstack:<name>` command per skill, and the subagents `poteto-agent` and `comment-sicko`. Its `context` hook adds the adapter line, which points the model at `docs/harness/opencode.md`.

## Sub-features

- `opencode-install` loads `pstack` as an active plugin from the repo root, with 59 skills from `pstack/skills/` and a `pstack:<name>` command for each.
- `opencode-adapter` puts the adapter line in every model request's system prompt. Only `setup-pstack` is offered to the model in `<available_skills>`, because the other 58 skills have `disable-model-invocation`.
- `opencode-agents` registers `poteto-agent` and `comment-sicko` as subagents that can't ask the user or spawn. Each child's system prompt holds its agent body and the adapter line.
- `opencode-subagents` fans a skill out through background `subagent` calls. The parent waits for each `<subagent>` notice before it answers.

## How to get to it (user POV)

- Add `pstack` to `plugins` in `~/.config/opencode/opencode.json` or a project's `opencode.json` (`.opencode/INSTALL.md`). Then type `/pstack:how ...` in a session.
- Open this checkout as an opencode project. opencode finds `.opencode/plugins/pstack.js` on its own.

## Driving it with check-opencode.sh and cells

Preconditions:

- `opencode`, `node`, `jq` and `curl` on `PATH`. No helper in `scripts/` launches opencode.

- **Install, adapter and agents, free.** Run `scripts/check-opencode.sh`. It starts `opencode serve` on 127.0.0.1, with `HOME` and the XDG dirs in a temp folder, the repo root in `plugins`, and `scripts/opencode-mock-model.mjs` as the provider. Its output must end with `opencode: PASS repo root loads as an opencode plugin with every pstack skill, pstack:<name> commands, both agents, and the adapter line`. The lines before it include:
  - `opencode: /api/plugin lists pstack active from the repo root`
  - `opencode: /api/skill lists 59 skills from pstack/skills, the same names as on disk`
  - `opencode: /api/agent has comment-sicko and poteto-agent as subagents that cannot ask the user or spawn`
  - `opencode: the parent's system prompt tells the model to read docs/harness/opencode.md`
  - `opencode: the comment-sicko child got '# Comment Sicko' and the adapter line, and has no subagent tool`, and the same line for `poteto-agent` with `'# Poteto subagent'`
  - `opencode: /pstack:how asks the model to load how, and the skill tool returns the SKILL.md body`
- **Scripted skill runs, free.** `scripts/check-eval.sh` grades a correct and a wrong scripted `how-complex` run in opencode ([Graded skill cells](./cells.md)).
- **A real model, billed.** `node evals/cells.mjs run --scenario how-simple,how-complex --host opencode --opencode-config <provider.json> [--opencode-model <provider>/<id>]`. `<provider.json>` is merged into the cell's `opencode.json` and must hold a provider with credentials, because the cell's data dir starts empty. No billed opencode cell has run yet, so a real model reading the adapter is unverified (`docs/specs/opencode.md` Not verified).

## Gotchas

- opencode 2.3 runs every subagent in the background. The `subagent` call returns a `sessionID`, and the answer arrives later as a `<subagent ...>` user message. A parent that answers before every notice arrives gets woken and answers again. Whether a real model waits is unverified.
- A local `plugins` entry must be the repo folder, not `index.js`. opencode rejects a file path with `configured plugin path must be a directory`.
- A `plugins` entry plus opening the checkout as a project gives `Duplicate plugin ID: pstack`. The project copy wins, and the other shows `failed` in `/api/plugin`.
- `opencode run "/pstack:how"` sends the text as a plain message. The check and the cells post the command to `/api/session/<id>/command`. Typing the command in the TUI is unverified.
- The opencode `mise` shim reinstalls opencode under a moved `XDG_DATA_HOME`. Resolve the binary with `mise which opencode`, or set `OPENCODE_BIN`. Never run `opencode models` without isolation: it once left a service running against the real `HOME`.
- opencode also reads `~/.claude/skills` and `~/.agents/skills`, so count only the skills whose path is under `pstack/skills/`.
- The plugin keeps only each agent's name, description and body, so `poteto-agent`'s `model:` slug is dropped.
- Install from the git URL is unverified. Only a local path has been loaded.
