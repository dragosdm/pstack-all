# my take on runing pstack on multiple harnesses

Goal: run pstack unchanged on Cursor, Claude Code, Grok, pi and opencode.

The layout follows compound-engineering. Every harness loads one skill tree in place, each harness gets its own entry file at the repo root, and a script renders those files from one metadata source. Here the skill tree is upstream pstack, kept byte for byte.

## Layout

- `pstack/` is a verbatim copy of upstream pstack. See `base/pstack.lock` for the repo, commit, and tree hash.
- `plugin.json` is the Grok CLI entry file. It points at `./pstack/skills/` and `./pstack/agents/`.
- `.cursor-plugin/marketplace.json` is the catalog for Cursor and Grok Bot. Its one entry has `source: "pstack"`, the shape upstream ships.
- `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` are the Claude Code entry files, laid out like compound-engineering: `source: "./"`, skills and agents in `pstack/`, and a `SessionStart` hook that points the model at `pstack/docs/harness/claude-code.md`. That hook replaces upstream's generated `harness/pstack/claude-code/` copy, so no `SKILL.md` changes.
- `package.json` is the Pi entry file, laid out like compound-engineering: a `pi` key loads `pstack/skills/` and two extensions. `.pi/extensions/pstack.ts` adds a line to the system prompt that points the model at `docs/harness/pi.md`, the Pi adapter. The adapter lives outside `pstack/` because upstream ships none. `.pi/extensions/subagent/` gives the model a `pstack-subagent` command: each subagent is a Pi in tmux, with `--agent` for `pstack/agents/` and `--worktree` for isolation.
- `index.js` and `.opencode/` are the opencode entry, laid out like compound-engineering. opencode loads the repo root as a plugin folder through `main` in `package.json`, and `index.js` re-exports `.opencode/plugins/pstack.js`. The plugin registers every skill, a `/pstack:<name>` command per skill and both agents, and adds a line to the system prompt that points the model at `docs/harness/opencode.md`, the opencode adapter. `.opencode/INSTALL.md` is the install guide.
- `scripts/sync-manifests.mjs` writes all five entry files, `package.json` for both Pi and opencode, from `pstack/plugin.json`. Edit the table in that script, never the files.
- `docs/specs/<harness>.md` records what was verified for each harness, how, and what was not.
- `base/` records the base: the upstream lock, the upstream file listing, the test baseline, and upstream's catalog validator and schemas in `base/upstream/`.
- `decisions.tsv` is the decision log.
- `evals/` holds the skill cells: scenarios that run a pstack skill in a real Claude Code, Pi, Cursor, Grok CLI or opencode session, loaded natively from a copy of this repo, and grade what the harness recorded (spawns, read-only flags, worktrees, models, git state, refused remote writes, the answer). `evals/README.md` explains them. Their evidence goes to `.verify-runs/`.
- `AGENTS.md` holds the rules for changing this repo, and `CLAUDE.md` is a symlink to it. `CODING_STANDARDS.md` and `tests/CODING_STANDARDS.md` are the review criteria.
- `.claude/skills/verify-pstack-all/` is the verification skill: it installs pstack into throwaway Claude Code and Grok configs, drives `/pstack:` skills in real Claude sessions, and keeps evidence in `.verify-runs/` (gitignored). `scripts/check.sh` proves the files; this proves the user path.

## Harnesses

| Harness | Reads | Install | Verified |
| --- | --- | --- | --- |
| Cursor | `.cursor-plugin/marketplace.json`, then `pstack/.cursor-plugin/plugin.json` | `cursor-agent plugin marketplace add <repo>` | catalog passes upstream's validator |
| Grok Bot | the Cursor catalog | through the Cursor catalog | no `minClientVersions` gate |
| Grok CLI | `plugin.json` | `grok plugin install <repo> --trust` | same 58 skills and 2 agents as `pstack/` |
| Claude Code | `.claude-plugin/marketplace.json`, then `.claude-plugin/plugin.json` | `claude plugin marketplace add dragosdm/pstack-all`, then `claude plugin install pstack@pstack-all` | same 57 skills and 2 agents as upstream's Claude tree; adapter hook fires |
| Pi | `package.json` | `pi install git:github.com/dragosdm/pstack-all`; spawns need tmux | same 58 skills, also inside this checkout with nothing installed; `/pstack:<name>` loads the skill; adapter line reaches the model; a scripted run spawns both agents through `pstack-subagent` |
| opencode | `package.json` `main`, then `index.js` | `"plugins": ["pstack@git+https://github.com/dragosdm/pstack-all.git"]` in `opencode.json` | same 58 skills, 58 `pstack:` commands and 2 agents; adapter line reaches the model; a scripted run spawns both agents through the `subagent` tool |

## What must stay unchanged

`AGENTS.md` lists the invariants, the skill command per harness, and how to update the upstream base.

## Check

```
bun run test
PSTACK_UPSTREAM_DIR=<cursor/plugins clone> scripts/check.sh
```

`bun run test` is the fast lane. It runs the unit tests in `tests/` in one bun process in well under a second, with no harness binary, login or network. Each test drives the opencode plugin, the Pi extension, the manifest generator or the eval grader and shims through the interface its harness uses, with a mock in place of the harness.

CI (`.github/workflows/ci.yml`) runs the deterministic lane on every push to `main` and every pull request: the manifest check, the base check, the catalog check, `claude plugin validate --strict` on both Claude manifests, and `bun run test`. The layers that drive grok, pi and opencode run only locally. Before you change this repo, read `AGENTS.md`. It says where a new check belongs.

`scripts/check.sh` is the full local lane. It runs nine layers and fails if any layer fails:

- `base` runs `scripts/check-base.sh`. `pstack/` must equal the lock, and its tests must keep their counts.
- `manifests` runs `node scripts/sync-manifests.mjs --check`. The entry files must equal what the script renders.
- `unit` runs `scripts/check-unit.sh`, which runs `bun run test`. Every unit test must pass.
- `catalog` runs `scripts/check-catalog.sh`. Upstream's validator must pass on the Cursor catalog, and nothing may hide pstack from Grok Bot.
- `grok` runs `scripts/check-grok.sh`. The repo root must install through the root `plugin.json` with the same inventory as `pstack/`.
- `claude` runs `scripts/check-claude.sh`. Both Claude manifests must pass `validate --strict`. The repo root must install with every skill, agent file and the adapter hook, and the installed `pstack/` must equal the repo's. `PSTACK_UPSTREAM_DIR` adds a comparison with upstream's Claude tree. `PSTACK_CLAUDE_RUNTIME=1` adds a billed model probe.
- `pi` runs `scripts/check-pi.sh`. The repo root must install as a Pi package that lists every skill under `pstack/skills/`, and the extension must name the Pi adapter. Pi run inside this checkout with nothing installed must list the same skills, because it auto-loads `.pi/extensions/` there without `package.json`. A `pi -p` run against a dummy provider must give the model the adapter line and the model-invocable pstack skills, with no model call, and `/pstack:how` must reach the model as the `how` skill. A `pi -p` run against a scripted local model must spawn `comment-sicko` read-only and `poteto-agent` in a worktree through `pstack-subagent`, get both answers back, and clean up.
- `opencode` runs `scripts/check-opencode.sh`. `opencode serve` with throwaway XDG dirs must load the repo root as a local plugin, list every pstack skill with `autoinvoke` false exactly for `disable-model-invocation: true`, a `pstack:<name>` command per skill, and both agents with the question and subagent denies. A scripted local model must get the adapter line and the model-invocable pstack skills, spawn `comment-sicko` and `poteto-agent` through the `subagent` tool, each with its agent body and no `subagent` tool, and load `how` through `/pstack:how`. No login, network or billing.
- `eval` runs `scripts/check-eval.sh`. The scenario table must be consistent, and the transcripts in `evals/golden/` must grade as recorded. Pi cells run through the whole driver against a scripted model. A correct run must pass, and a wrong run must fail exactly the seven criteria it breaks. Its parent's `gh pr create` and a subagent's `git push` must reach the cell's git and gh shims, which log and refuse them. A scripted swarm run must start two worktree workers together and stop them. opencode cells run the same driver against `opencode serve` and a scripted model. A correct run must pass, and a wrong run that pushes from the shell tool must fail exactly four criteria. No model call. Billed cells are `node evals/cells.mjs run`, never part of the check.

Without `PSTACK_UPSTREAM_DIR` the locks are trusted as written. Needs `git`, `bun`, `node`, `npm`, `jq`, `column`, `grok`, `claude`, `pi`, `opencode`, `curl`, and `tmux`. Billed cells also need `cursor-agent` for the Cursor reference column. The baseline was recorded with bun 1.3.10 and node v26.12.1, the version CI pins. The 67 statechart tests that need TLC are skipped without `TLA2TOOLS`.

`scripts/selftest-check.sh` breaks a throwaway copy 41 ways and requires each break to fail its own layer. `.audit/check-selftest.txt` holds a recorded run of the first 35 breaks. `.audit/base-selftest.txt` shows the base check failing on four deliberate breaks.
