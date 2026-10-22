# Claude Code

Last verified 2026-10-22 against `claude 2.1.308`.

## Entry files

Claude Code reads `.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json` at the repo root. This is compound-engineering's shape: the catalog entry has `source: "./"`, and the plugin root is the repo root. `scripts/sync-manifests.mjs` writes both files. `plugin.json` is `pstack/plugin.json` plus three keys:

```json
"skills": "./pstack/skills/",
"agents": ["./pstack/agents/comment-sicko.md", "./pstack/agents/poteto-agent.md"],
"hooks": { "SessionStart": [{ "hooks": [{ "type": "command", "command": "echo \"... read ${CLAUDE_PLUGIN_ROOT}/pstack/docs/harness/claude-code.md once per session.\"" }] }] }
```

`agents` lists files because `claude plugin validate` rejects a directory there. The sync script reads the list from `pstack/agents/`, so a new upstream agent shows up as manifest drift.

The plugin name stays `pstack`, so skills are `/pstack:<name>` and agents are `pstack:poteto-agent` and `pstack:comment-sicko`, as the adapter expects.

## Install

```
claude plugin marketplace add dragosdm/pstack-all
claude plugin install pstack@pstack-all
```

For a local session, run `claude --plugin-dir <this repo>`.

Upstream's `pstack@cursor-plugins` uses the same plugin name. Uninstall it first, or both register `pstack:*` names.

## How this replaces upstream's Claude tree

Upstream `cursor/plugins` does not install `pstack/` in Claude Code. `scripts/generate-pstack-harness-trees.mjs` renders a copy at `harness/pstack/claude-code/`, and its catalog points there. The copy differs from `pstack/` in three ways:

1. It inserts one line after the H1 of each `SKILL.md` that uses Cursor names (23 at `eb4db2b`): read the Claude Code adapter once per session before you follow this skill.
2. It rewrites relative links to files it leaves out, such as `automations/` and `assets/`, so they point at GitHub.
3. It drops `automations/`, `assets/`, `.cursor-plugin/`, and `.gitignore`.

Here Claude loads `pstack/` in place, so nothing needs to be dropped or relinked. The adapter line moves into the `SessionStart` hook, which adds it to the model's context in every session. All 57 skills are covered by one line, instead of 23 skills each carrying it. No `SKILL.md` changes.

## Manifest precedence

Grok CLI reads `.claude-plugin/plugin.json` third, after root `plugin.json` and `.grok-plugin/plugin.json`. The root `plugin.json` keeps Grok on its own manifest. `scripts/check-grok.sh` confirms this on every run. Cursor reads only `.cursor-plugin/`.

## Inventory

`claude plugin details pstack@pstack-all` lists 57 skills and 1 `SessionStart` hook. It lists **0 agents**, because `details` counts only a default `agents/` folder. A model run sees both agents. A minimal plugin with custom agent paths showed the same split, so this is how `details` reports, not a pstack issue.

Upstream's generated tree at `eb4db2b`, installed the same way, lists the same 57 skills and the same 2 agents.

## Check

`scripts/check-claude.sh`:

- runs `claude plugin validate --strict` on both manifests
- installs the repo root into a throwaway `CLAUDE_CONFIG_DIR`, then checks:
  - the skill names match `pstack/skills/`
  - the installed `pstack/` equals the repo's
  - every listed agent file exists
  - the hook, run with the installed `CLAUDE_PLUGIN_ROOT`, names a file identical to the adapter
- with `PSTACK_UPSTREAM_DIR`, installs upstream's catalog from `git archive` of the locked commit and compares skills and agents
- with `PSTACK_CLAUDE_RUNTIME=1`, asks Haiku for the `pstack:` agent types and the hook's adapter path, once with `--plugin-dir <repo>` and once without as a control. User settings are skipped, so an installed `pstack@cursor-plugins` cannot answer for this repo. This bills a small model call.

Set `CLAUDE_BIN` to choose the binary.

## Not verified

- Install from the GitHub marketplace URL. Only local paths were tested, and nothing is pushed.
- A pstack skill run end to end in Claude Code. The runtime probe covers registration and the hook, not skill behavior.
- Whether the session-wide hook line changes behavior compared with upstream's per-skill line. Both tell the model to read the same adapter before it follows a pstack skill.
- Windows. The hook is a POSIX `echo` command.
