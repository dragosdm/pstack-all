---
name: verify-pstack-all
description: Drive pstack-all the way a user does, by installing it into Claude Code, Grok CLI or Pi from this repo and running pstack skills in real sessions (helper drives for Claude, graded cells for Claude, Pi, Cursor and Grok), and capture proof. Use when a change to the harness entry files (.claude-plugin/, plugin.json, .cursor-plugin/, package.json), the adapter hook, .pi/extensions/, docs/harness/pi.md, or scripts/sync-manifests.mjs needs evidence that pstack still installs, registers, and behaves in a harness.
---

# Verify pstack-all

pstack-all has no server. Its users touch a harness CLI: they add this repo as a marketplace or package, install `pstack`, and type a skill command (`/pstack:<skill>` in Claude Code and opencode, `/pstack:<skill>` or `/skill:<skill>` in Pi, `/<skill>` in Cursor and Grok). This skill drives that path in throwaway config dirs and in real model sessions, and keeps the evidence. Graded skill cells (`evals/cells.mjs`) drive the same path across harnesses. See the features map.

`scripts/check.sh` proves the files: unchanged `pstack/`, manifest drift, validators, and install inventory. This skill proves the user path. Run both. A green check does not prove a session works.

Helpers live in `.claude/skills/verify-pstack-all/scripts/`. Run them from the repo root. Each one takes the run id that `launch.sh` prints.

## Launch

```
.claude/skills/verify-pstack-all/scripts/launch.sh [claude|grok|all]
```

Launch creates `${TMPDIR:-/tmp}/verify-pstack-all.XXXXXX`, the instance. It then does the user's install from the working tree:

- **claude.** `claude plugin marketplace add <repo>` and `claude plugin install pstack@pstack-all`, under `CLAUDE_CONFIG_DIR=<instance>/claude-config`.
- **grok.** `grok plugin install <repo> --trust`, under `HOME=<instance>/grok-home`.

It is ready when the last line reads `READY run=<id> evidence=<dir>`. Any `launch: FAIL` line names the log to read. A launch takes about 20 seconds and needs no network.

Each run has its own config dir and HOME, so runs can go in parallel. These helpers never write your real `~/.claude` or `~/.grok`. Grok cells are the exception: they install into `~/.grok` for the run and uninstall afterwards.

## Doctor

```
.claude/skills/verify-pstack-all/scripts/doctor.sh <run-id>
```

Read-only. Every line must be `OK`, otherwise exit 1. It checks:

- the instance exists
- Claude lists `pstack <version>` from `.claude-plugin/plugin.json`
- the installed copy still equals the working tree's `pstack/` and `.claude-plugin/plugin.json`
- `claude auth status` is logged in
- Grok loaded the root `plugin.json` (`pstack v<version>`, with no `(subdir: pstack)`)

A stale install means you edited the repo after launch. Doctor detects it for Claude only. For Grok it checks only the version line, so relaunch after any edit. Clean up and relaunch. Never reinstall into an old instance.

## Drive

Install and inventory are driven by `launch.sh` itself. Its evidence is `claude-details.txt`, `grok-details.txt`, and `grok-inventory.json`.

A session is driven by:

```
.claude/skills/verify-pstack-all/scripts/drive-claude.sh <run-id> <name> '<prompt as the user types it>'
```

It runs one `claude -p` session from the instance dir with:

- `--plugin-dir <repo>`, so it loads the working tree
- `--setting-sources project,local`, so your installed plugins, including `pstack@cursor-plugins`, do not load and can't answer for this repo
- `--no-session-persistence`
- `--allowedTools Read Glob Grep`
- `--model ${VERIFY_MODEL:-sonnet}` and `--max-budget-usd ${VERIFY_BUDGET_USD:-1}`

Each session bills your Claude account, about $0.10 for a help question on Sonnet. Write the prompt exactly as a user would, starting with `/pstack:<skill>`. The feature files give the prompts and what proves each one.

A session can't run in the throwaway config dir, because that dir has no login. Do not copy credentials into it. So sessions load the repo with `--plugin-dir` instead of the marketplace install. The install path is proven by `launch.sh`, and session behavior by `drive-claude.sh`.

## Evidence

Everything lands in `.verify-runs/<run-id>/`, which is gitignored:

- `repo-state.txt`: HEAD and `git status`
- `*-install.log` and `*-details.txt`
- `grok-inventory.json`
- one `drive-<name>/` per session: `prompt.txt`, `transcript.jsonl` (the full stream-json), `init.json` (loaded plugins, pstack agents, pstack command count), `hooks.txt` (SessionStart output), `tools.txt` (every tool call), `denied.txt` (permission denials), `answer.md` (the last result), `stderr.txt`

Proof standards:

- Drive the user's words, the `/pstack:<skill>` slash command. Do not paste skill text into the prompt or name files for the model to read.
- Prove the loaded plugin and the outcome together. `init.json` must show `pstack@inline` from this repo with the pstack agents, and `answer.md` must show behavior that only the adapter explains, such as Claude Code paths and `/pstack:` names.
- Report the tool calls that matter from `tools.txt`, such as the `Read` of `pstack/docs/harness/claude-code.md`. A good answer without that read can come from training data.
- A model answer varies from run to run. Treat one session as evidence for that run, not as a guarantee. When a claim matters, run it twice.

## Cleanup

```
.claude/skills/verify-pstack-all/scripts/cleanup.sh <run-id>
```

Cleanup removes only the instance path recorded in `run.env`, and refuses any path that `launch.sh` did not create. No helper starts a long-lived process, so nothing needs killing. `.verify-runs/<run-id>/` survives and gets a `cleanup.txt` line. Run cleanup after a failed attempt too.

## Features

[`features/README.md`](features/README.md) is the map. Read it before driving, then use the matching feature file.

## Maintenance

When a harness, entry file, or feature changes, run `/pstack:maintain-verification-skill` to keep this skill and the map honest.
