# pstack-all verification map

This directory is the maintained source for verifying how users install and run pstack from this repo in each harness. Read the index before driving, then use the matching feature file as the recipe.

## Baseline preconditions

- Run from the repo root. The helpers are in `.claude/skills/verify-pstack-all/scripts/`.
- `scripts/check.sh` passes on the working tree. Driving a tree whose `pstack/` differs from the lock proves nothing about upstream pstack.
- `launch.sh` printed `READY run=<id>`, and `doctor.sh <id>` prints only `OK` lines.
- The helpers never drive your real `~/.claude` or `~/.grok`. Every install goes into the run's instance. Grok cells are the exception and say so.

## Driving conventions

- Prompts are literal. Type the slash command as the user would, such as `/pstack:poteto-help ...`.
- One `drive-claude.sh` call is one billed session. Name each one after the feature and sub-feature, such as `poteto-help-models`.
- Install and inventory proof comes from `launch.sh` output files. Do not rerun installs by hand.

## Proof and skip reporting

- Session proof is `init.json` (what loaded), `hooks.txt` (what the hook said), `tools.txt` (what the model read), and `answer.md` (what the user saw), all from the same `drive-<name>/`.
- Install proof is the `*-details.txt` and `grok-inventory.json` of the run.
- Name the run id and feature ID with every claim.
- Report a harness that can't be driven here, such as a Cursor install, as skipped, with the reason. Never report it verified through another harness.

## Feature entry contract

Each feature file has an H1 title and one paragraph, then four H2s in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with <harness>`, and `Gotchas`.

## Features

- [Claude Code install](./claude-install.md) covers marketplace add, install, and the inventory Claude reports.
- [Run a pstack skill in Claude Code](./claude-skill-run.md) covers the adapter hook and a user-typed `/pstack:` skill answering in Claude Code terms.
- [pstack agents in Claude Code](./claude-agents.md) covers `pstack:poteto-agent` and `pstack:comment-sicko` being registered and spawnable.
- [Grok CLI install](./grok-install.md) covers installing from the repo root and Grok loading the root `plugin.json`.
- [pstack in Pi](./pi.md) covers the Pi package install, the adapter line, and `pstack-subagent` spawning, waiting and stopping.
- [Cursor and Grok Bot catalog](./cursor-catalog.md) covers the catalog users add in Cursor. The marketplace install and Grok Bot can't be driven locally. A local `--plugin-dir` session runs through cells.
- [Graded skill cells](./cells.md) covers skill behavior across Claude Code, Pi, Cursor and Grok: scenarios run by `evals/cells.mjs`, graded from what each harness recorded, with an ablate control.
