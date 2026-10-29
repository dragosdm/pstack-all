# Pi

Last verified 2026-10-22 against `pi 1.4.0` and tmux 3.8.

## Entry files

Pi reads the root `package.json`. This is compound-engineering's shape: a Pi package is a `package.json` with a `pi` key, and the package root is the repo root. `scripts/sync-manifests.mjs` writes it as `pstack/plugin.json` without `$schema`, `skills` and `agents`, plus:

```json
"private": true,
"type": "module",
"keywords": [..., "pi-package"],
"pi": {
  "extensions": ["./.pi/extensions/pstack.ts", "./.pi/extensions/subagent/index.ts"],
  "skills": ["./pstack/skills"]
}
```

- `pi.skills` loads the 58 skills in place. Pi names them `/skill:<name>`.
- `.pi/extensions/pstack.ts` is the Pi counterpart of the Claude Code `SessionStart` hook. On `before_agent_start` it appends one line to the system prompt: read `docs/harness/pi.md` once per session.
- The same extension also returns `pstack/skills` from `resources_discover`. Pi auto-loads a trusted project's `.pi/extensions/` without its `package.json`, so before this, Pi run inside this checkout with nothing installed had the adapter line and `pstack-subagent` but no pstack skill. Pi drops the duplicate path when both routes load.
- It registers a `pstack:<name>` command for every folder under `pstack/skills/`, so `/pstack:<name>` is in the `/` menu. `/pstack:<name>` is the standard shared with Claude Code and opencode. The handler forwards `/skill:<name> <args>` with `pi.sendUserMessage(..., { expandPromptTemplates: true })`, which makes Pi expand the skill. Without that option Pi sends the text as is. In print and JSON modes the handler waits for `agent_settled`, because those modes exit when the command returns and `sendUserMessage` only starts the run.
- The extension reads each command's description from the skill's frontmatter at load time, because `pi.getCommands()` cannot run during loading and `session_start` runs before `resources_discover`. It parses the three shapes upstream uses: a double-quoted string, a plain scalar and a `>-` folded block.
- When a second copy of the extension loads in the same process, it registers no commands and adds no adapter line. Pi would otherwise list both copies' commands as `/pstack:how:1` and `/pstack:how:2`, and no plain `/pstack:how`. The first copy marks the process and clears the mark on `session_shutdown`, which `/reload` fires before loading the replacement runtime.
- `.pi/extensions/subagent/` is pstack's subagent support. See Subagents.
- `type: module` lets node run the `pstack-subagent` TypeScript without a warning on every call.

## Subagents

Pi has no built-in subagents. pstack ships its own in `.pi/extensions/subagent/`, so no other package is needed.

- The model runs `pstack-subagent spawn|wait|send|stop|list` through the `bash` tool. The extension puts `.pi/bin` on the tool's `PATH`.
- Each subagent is a full interactive Pi in a tmux session `pstack-subagent-<handle>`, with its own session file under `<agent dir>/pstack-subagents/<handle>/`. The same extension runs inside the child as a bridge: it moves messages from an inbox folder into the session and writes the run state to `metadata.json`.
- `wait` waits for the child to be idle with an empty inbox, then prints the last assistant message on the session's active branch.
- `--agent <name>` appends `pstack/agents/<name>.md`, without frontmatter, to the child's system prompt. This replaces `pi.subagents.agents`, which only `pi-subagents` read.
- `--worktree <ref>` runs the child in a new git worktree at `<repo git dir>/pstack-worktrees/<handle>`, on branch `pstack-subagent/<handle>`. `stop` removes the worktree and keeps the branch.
- Every child is launched with `--extension <package root>`, so it has pstack's skills, the adapter line and the bridge wherever its folder is.
- `--tools` is Pi's own allowlist, so `--tools read,grep,find,ls` makes a child read-only.
- When the parent session quits, its children stop and are relaunched idle when that session resumes. Only `stop` deletes a run.
- Subagents cannot spawn subagents.

`pi-subagents` was the earlier route. It added a `subagent` tool with its own agent registry, chains, and worktrees for workflow children. pstack uses none of those beyond what the table in `docs/harness/pi.md` maps, and the port covers each mapping with one CLI flag.

## Adapter

Upstream ships no Pi adapter, and `pstack/` must stay upstream bytes, so the adapter lives at `docs/harness/pi.md`. It follows `pstack/docs/harness/claude-code.md` section for section. `Task` maps to `pstack-subagent spawn`, `wait` and `stop`. Without tmux, the adapter has the model do each spawn's work itself and say so.

## Install

```
pi install git:github.com/dragosdm/pstack-all
```

For a local checkout, run `pi install <this repo>`. Pi loads a local path in place, without copying. For one session only, run `pi -e <this repo>`. Subagents need `tmux` and `node` 22.19 or newer on `PATH`.

## Inventory

`get_commands` over `pi --mode rpc` lists 58 `skill:` commands whose path is under `pstack/skills/`, the same names as on disk. Neither needs a model call.

The model's system prompt lists one pstack skill, `setup-pstack`. The other 56 set `disable-model-invocation: true`, so Pi hides them from the model and keeps `/skill:<name>`, as Cursor and Claude Code do.

## Check

`scripts/check-pi.sh`:

- installs the repo root into a throwaway `PI_CODING_AGENT_DIR`
- lists skills over RPC and compares the names under `pstack/skills/` with the folders on disk. Skills from `~/.agents/skills/` also load, so the check filters by path.
- fails on any startup error. A syntax error in either extension stops Pi at startup.
- requires `get_commands` to list an extension command `pstack:<name>` for every pstack skill, each with the same description as Pi's `skill:<name>`.
- lists skills over RPC again from the repo root with a fresh, empty agent dir and `--approve`. Nothing is installed, so only the auto-loaded `.pi/extensions/` can bring them, and the skills and `pstack:<name>` commands must still match.
- installs a copy of the repo from a second path into another agent dir and lists commands from the repo root. Both copies load, and each `pstack:<name>` must appear once, with no `:1` or `:2` suffix. Installing from the repo's own path loads the extension once, so it cannot test this.
- runs `pi -p` against a dummy provider, with a throwaway extension that saves the request at `before_provider_request` and exits before sending it. No login, network or model call. The system message must tell the model to read a file equal to `docs/harness/pi.md`, and must list exactly the pstack skills without `disable-model-invocation`. Pi silently ignores a missing extension file, so this step is the one that catches it. A second dummy run sends `/pstack:how check-pi`, and the last user message must be the `how` skill block ending in `check-pi`.
- runs `pi -p` against `scripts/pi-mock-model.mjs`, a scripted OpenAI-compatible server on localhost registered in `models.json`, so the tmux children reach it too. The parent's one `bash` call spawns `comment-sicko` with `--tools read,grep,find,ls` and `poteto-agent` with `--worktree HEAD`, waits for both, and stops both. Each child answers with the agent prompt, the tools and the cwd it got, and the check requires both answers exactly. After `stop`, no run folder, tmux session or extra worktree may remain, and the worktree branch must exist. No login or billing.

Set `PI_BIN` to choose the binary. Needs `tmux`.

## Billed run

2026-10-22, `/skill:how` on a scratch project, `openai-codex/gpt-6.1-sol` at medium effort, `pi -p --approve`, pstack installed with `pi install -l`. 240 seconds, $0.42 for the parent and four subagents. Evidence in `.verify-runs/20261022T163900Z-pi-how-billed/` (gitignored).

- The model read `docs/harness/pi.md` first, then the skill's reference files, and ran `pi --list-models` and `pstack-subagent --help`.
- It took the complex path. It spawned three explorers in one call with `--tools read,bash,grep,find,ls` and do-not-edit briefs, waited for all three, stopped them, then spawned, waited for and stopped one explainer. The answer has the skill's sections with file and line references. No run, tmux session or file change was left behind.
- `spawn` failed with tmux's `command too long` on the explainer's brief, which held all the explorers' findings. The model condensed the findings by hand and spawned again. Fixed: the brief now goes through `@task.md`, and the check's poteto-agent brief is 40 KB.
- With no `~/.pi/agent/pstack-models.md`, every role ran on the session model. The model did not say so, as the adapter asks.

## Skill cells

`evals/` runs pstack skills in real Pi sessions, loaded with `pi install -l`, and grades the child metadata the extension writes. Results on `openai-codex/gpt-6.1-sol` at medium effort, 2026-10-23:

- `help-models`, `how-simple`, `how-complex`, `interrogate-staged`, `no-comments-agent` and `setup-gate` pass. `how-*` passed in 2 trials each after the adapter fix below.
- The `ablate` arm, without `.pi/extensions/pstack.ts`, made no spawn in any trial, so `spawns` and `parallel` are real controls on Pi, not only the adapter read.
- Before the fix, 4 of 4 `how` trials never said the subagents ran on the session model. The Spawning section of `docs/harness/pi.md` now states the rule with an example, and spawn prints the inherited model. After it, 4 of 4 said so.
- `swarm-worktree` first hung: worktree children of a project-local install lost the bridge and met a trust prompt. Fixed as above. The mock swarm cell in `check-eval.sh` guards it.

## Not verified

- Explicit model flags chosen by a real model. No cell had a pstack-models.md role line that names a Pi model, so every billed spawn inherited the session model.
- Results on other Pi models. Every billed cell used `openai-codex/gpt-6.1-sol` at medium effort, with the user's global Pi packages loaded.
- `send`, `--follow-up`, `/pstack-subagent` attach, and suspend and resume on parent quit. No run exercised them.
- Install from a git URL. Only local paths were tested. Git must keep the executable bit on `.pi/bin/pstack-subagent` and `subagent.ts`.
- Pi's mutable `systemPromptOptions`. The extension returns `systemPrompt`, as Pi's bundled `claude-rules.ts` example does, which replaces the prompt for that run with the old prompt plus one line.

## Gotchas

- An interactive child cannot answer a project trust prompt. With pstack installed by `pi install -l`, the parent's `--approve` does not reach the children, so the project needs a saved trust decision (`/trust`) or a global install. The billed run added and then removed one `trust.json` entry.

- `pi -p` reads piped stdin. Run it with `</dev/null` in scripts, or it waits forever.
- A `-e` extension runs before an installed package's extension, so a `before_agent_start` handler passed with `-e` does not see pstack's line. Read the prompt at `before_provider_request`.
- `--no-skills` also drops the skills of a package loaded with `-e`.
- Pi also auto-loads `.pi/extensions/` from the project it runs in, but not the project's `package.json` `pi` key. Inside this repo with pstack installed from another path, both extensions load. The second copy of `pstack.ts` stands down, so commands and the adapter line appear once. Installed from the repo's own path, Pi loads the file once. With nothing installed, only the extensions load, which is why the skills come from `resources_discover` too.
- Pi sends a slash command it does not know, such as `/how`, to the model as plain text, and no error tells the user. `/pstack:how` and `/skill:how` load the skill.
- A child's model must be reachable from a new process. A provider registered only by a `-e` extension in the parent is unknown to the child, so the check registers its mock in `models.json`.
