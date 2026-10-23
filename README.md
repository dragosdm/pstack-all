# my take on runing pstack on multiple harnesses

Goal: run pstack unchanged on Cursor, Claude Code, Grok, pi and opencode.

The layout follows compound-engineering. Every harness loads one skill tree in place, each harness gets its own entry file at the repo root, and a script renders those files from one metadata source. Here the skill tree is upstream pstack, kept byte for byte.

## Layout

- `pstack/` is a verbatim copy of upstream pstack. See `base/pstack.lock` for the repo, commit, and tree hash.
- `plugin.json` is the Grok CLI entry file. It points at `./pstack/skills/` and `./pstack/agents/`.
- `.cursor-plugin/marketplace.json` is the catalog for Cursor and Grok Bot. Its one entry has `source: "pstack"`, the shape upstream ships.
- `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` are the Claude Code entry files, laid out like compound-engineering: `source: "./"`, skills and agents in `pstack/`, and a `SessionStart` hook that points the model at `pstack/docs/harness/claude-code.md`. That hook replaces upstream's generated `harness/pstack/claude-code/` copy, so no `SKILL.md` changes.
- `package.json` is the Pi entry file, laid out like compound-engineering: a `pi` key loads `pstack/skills/` and two extensions. `.pi/extensions/pstack.ts` adds a line to the system prompt that points the model at `docs/harness/pi.md`, the Pi adapter. The adapter lives outside `pstack/` because upstream ships none. `.pi/extensions/subagent/` gives the model a `pstack-subagent` command: each subagent is a Pi in tmux, with `--agent` for `pstack/agents/` and `--worktree` for isolation.
- `scripts/sync-manifests.mjs` writes all five entry files from `pstack/plugin.json`. Edit the table in that script, never the files.
- `docs/specs/<harness>.md` records what was verified for each harness, how, and what was not.
- `base/` records the base: the upstream lock, the upstream file listing, the test baseline, and upstream's catalog validator and schemas in `base/upstream/`.
- `decisions.tsv` is the decision log.
- `evals/` holds the skill cells: scenarios that run a pstack skill in a real Claude Code, Pi or Cursor session, loaded natively from a copy of this repo, and grade what the harness recorded (spawns, read-only flags, worktrees, models, git state, the answer). `evals/README.md` explains them. Their evidence goes to `.verify-runs/`.
- `.claude/skills/verify-pstack-all/` is the verification skill: it installs pstack into throwaway Claude Code and Grok configs, drives `/pstack:` skills in real Claude sessions, and keeps evidence in `.verify-runs/` (gitignored). `scripts/check.sh` proves the files; this proves the user path.

## Harnesses

| Harness | Reads | Install | Verified |
| --- | --- | --- | --- |
| Cursor | `.cursor-plugin/marketplace.json`, then `pstack/.cursor-plugin/plugin.json` | `cursor-agent plugin marketplace add <repo>` | catalog passes upstream's validator |
| Grok Bot | the Cursor catalog | through the Cursor catalog | no `minClientVersions` gate |
| Grok CLI | `plugin.json` | `grok plugin install <repo> --trust` | same 57 skills and 2 agents as `pstack/` |
| Claude Code | `.claude-plugin/marketplace.json`, then `.claude-plugin/plugin.json` | `claude plugin marketplace add dragosdm/pstack-all`, then `claude plugin install pstack@pstack-all` | same 57 skills and 2 agents as upstream's Claude tree; adapter hook fires |
| Pi | `package.json` | `pi install git:github.com/dragosdm/pstack-all`; spawns need tmux | same 57 skills; adapter line reaches the model; a scripted run spawns both agents through `pstack-subagent` |
| opencode | not yet | | |

## What must stay unchanged

- Every file under `pstack/`, byte for byte and mode for mode, equals upstream `eb4db2b:pstack` (tree `d08bf3a`).
- Skill behavior. pstack's own suites keep the counts in `base/test-baseline.tsv`.
- What each harness discovers. Grok CLI lists the same skills and agents from the repo root as from `pstack/`.
- Upstream's Cursor and Grok Bot shape, a catalog entry whose source is `pstack/`.
- Grok CLI loads the root `plugin.json`, never `.claude-plugin/plugin.json`.
- Claude Code names: the plugin is `pstack`, so the adapter's `pstack:poteto-agent` and `/pstack:<name>` hold.
- Pi agent names: `poteto-agent` and `comment-sicko`, as upstream names the files, passed as `pstack-subagent --agent <name>`.
- Repo-relative paths. Playbooks reference `pstack/skills/...` from the repo root, so `pstack/` stays at the root.

Updating the base is a deliberate step. Copy the new upstream tree, rewrite `base/pstack.lock` and `base/pstack.ls-tree`, run `scripts/check-base.sh --record`, then `node scripts/sync-manifests.mjs`.

## Check

```
PSTACK_UPSTREAM_DIR=<cursor/plugins clone> scripts/check.sh
```

`scripts/check.sh` runs seven layers and fails if any layer fails:

- `base` runs `scripts/check-base.sh`. `pstack/` must equal the lock, and its tests must keep their counts.
- `manifests` runs `node scripts/sync-manifests.mjs --check`. The entry files must equal what the script renders.
- `catalog` runs `scripts/check-catalog.sh`. Upstream's validator must pass on the Cursor catalog, and nothing may hide pstack from Grok Bot.
- `grok` runs `scripts/check-grok.sh`. The repo root must install through the root `plugin.json` with the same inventory as `pstack/`.
- `claude` runs `scripts/check-claude.sh`. Both Claude manifests must pass `validate --strict`. The repo root must install with every skill, agent file and the adapter hook, and the installed `pstack/` must equal the repo's. `PSTACK_UPSTREAM_DIR` adds a comparison with upstream's Claude tree. `PSTACK_CLAUDE_RUNTIME=1` adds a billed model probe.
- `pi` runs `scripts/check-pi.sh`. The repo root must install as a Pi package that lists every skill under `pstack/skills/`, and the extension must name the Pi adapter. A `pi -p` run against a dummy provider must give the model the adapter line and the model-invocable pstack skills, with no model call. A `pi -p` run against a scripted local model must spawn `comment-sicko` read-only and `poteto-agent` in a worktree through `pstack-subagent`, get both answers back, and clean up.
- `eval` runs `scripts/check-eval.sh`. The scenario table must be consistent, and the transcripts in `evals/golden/` must grade as recorded. A Pi cell must pass through the whole driver against a scripted correct run, and a scripted wrong run must fail exactly the six criteria it breaks. No model call. Billed cells are `node evals/cells.mjs run`, never part of the check.

Without `PSTACK_UPSTREAM_DIR` the locks are trusted as written. Needs `git`, `bun`, `node`, `npm`, `jq`, `column`, `grok`, `claude`, `pi`, and `tmux`. Billed cells also need `cursor-agent` for the Cursor reference column. The baseline was recorded with bun 1.3.10 and node v26.8.2. The 31 statechart tests that need TLC are skipped without Java and `TLA2TOOLS`.

`scripts/selftest-check.sh` breaks a throwaway copy twenty-three ways and requires each break to fail its own layer. Its last output is in `.audit/check-selftest.txt`. `.audit/base-selftest.txt` shows the base check failing on four deliberate breaks.
