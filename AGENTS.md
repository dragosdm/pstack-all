# Agent instructions

pstack-all packages upstream pstack, the `pstack/` folder of `cursor/plugins`, for Cursor, Grok Bot, Grok CLI, Claude Code, Pi and opencode without changing it. `pstack/` is a byte-for-byte copy pinned by `base/pstack.lock`. This repo owns only the install and adapter layer around it: the entry files, the generator that writes them, the Claude `SessionStart` hook, the Pi extensions, the opencode plugin, the Pi and opencode adapter docs, the checks, the eval cells and the unit tests.

This repo does not author skills. It cannot change what a skill says. A fix to skill prose belongs upstream in `cursor/plugins`, and reaches this repo through a base update.

`AGENTS.md` is the canonical instruction file. The root `CLAUDE.md` is a symlink to it. Keep the symlink and never replace it with a regular file. The repo root is also the Claude plugin root. For a regular-file `CLAUDE.md` there, `claude plugin validate` warns that it is not loaded as project context, and `--strict` turns that warning into a failure. The symlink passes. Both results were checked with `claude 2.1.308` on 2026-10-24. As that warning says, Claude Code does not load a plugin-root `CLAUDE.md` for the people who install the plugin, so this file reaches only agents working in this checkout.

## Quick start

```
bun run test                                                 # unit tests, no harness binary, also runs in CI
scripts/check.sh                                             # all nine layers, needs every harness binary
PSTACK_UPSTREAM_DIR=<cursor/plugins clone> scripts/check.sh  # also proves base/pstack.lock against upstream
scripts/selftest-check.sh                                    # breaks a copy of the repo and expects each break to fail its layer
node evals/cells.mjs check                                   # scenario table and golden transcripts, no model call
```

`README.md` lists what `scripts/check.sh` needs on `PATH`.

## What this repo owns

| Path | Owner | Rule |
| --- | --- | --- |
| `pstack/` | upstream `cursor/plugins` | Never edit. Change it only through a base update. |
| `plugin.json`, `.cursor-plugin/marketplace.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `package.json` | `scripts/sync-manifests.mjs` | Generated. Edit the `HARNESSES` table, never the files. |
| `.pi/`, `.opencode/`, `index.js` | this repo | Pi extensions and the opencode plugin. |
| `docs/harness/pi.md`, `docs/harness/opencode.md` | this repo | Adapters that upstream does not ship. |
| `docs/specs/<harness>.md` | this repo | What was verified per harness, how, and what was not. |
| `scripts/`, `evals/`, `tests/` | this repo | Checks, eval cells, unit tests. |
| `base/` | this repo | The lock, the upstream file listings, the test baseline, upstream's catalog validator and schemas. |
| `.claude/skills/verify-pstack-all/` | this repo | The skill that drives the user path in real sessions. |
| `decisions.tsv` | this repo | The decision log. Append only. |

`AGENTS.md` and `CODING_STANDARDS.md` govern what this repo owns. They do not govern `pstack/skills/`. Runtime instructions reach a model in a harness only through the adapter docs and the adapter line, never through this file. The eval cell tree leaves `AGENTS.md` out (`evals/README.md`).

## What must stay unchanged

- Every file under `pstack/`, byte for byte and mode for mode, equals upstream `1ba91fc:pstack` (tree `4719e1c`).
- Skill behavior. pstack's own suites keep the counts in `base/test-baseline.tsv`.
- What each harness discovers. Grok CLI lists the same skills and agents from the repo root as from `pstack/`.
- Upstream's Cursor and Grok Bot shape, a catalog entry whose source is `pstack/`.
- Grok CLI loads the root `plugin.json`, never `.claude-plugin/plugin.json`.
- Claude Code names. The plugin is `pstack`, so the adapter's `pstack:poteto-agent` and `/pstack:<name>` hold.
- Pi agent names. They are `poteto-agent` and `comment-sicko`, as upstream names the files, passed as `pstack-subagent --agent <name>`.
- opencode names. The plugin id is `pstack`, the commands are `pstack:<name>`, and the agents are `poteto-agent` and `comment-sicko`, as the opencode adapter names them.
- Skill commands. The table in the next section is the standard.
- Repo-relative paths. Playbooks reference `pstack/skills/...` from the repo root, so `pstack/` stays at the root.

## Skill commands per harness

| Harness | A user types | Agents |
| --- | --- | --- |
| Claude Code | `/pstack:<name>` | `pstack:poteto-agent`, `pstack:comment-sicko` |
| Pi | `/pstack:<name>`, or Pi's native `/skill:<name>` | `pstack-subagent --agent poteto-agent` or `--agent comment-sicko` |
| opencode | `/pstack:<name>` | `poteto-agent`, `comment-sicko` |
| Cursor | `/<name>` | as upstream ships them |
| Grok CLI | `/<name>` | `grok inspect --json` lists `pstack:poteto-agent` and `pstack:comment-sicko` |
| Grok Bot | `/<name>` | as upstream ships them |

`/pstack:<name>` is the one standard for the harnesses this repo adapts. pstack skill names such as `how` and `why` are generic, so the namespace keeps a user's own command of the same name. Cursor and Grok name skills from the `name:` field in each `SKILL.md`, and `pstack/` must stay upstream bytes, so they keep `/<name>`. The decision and its reversal of bare names are in `decisions.tsv` at 2026-10-23T19:19:24Z and 2026-10-24T03:14:46Z.

Pi gets `/pstack:<name>` from one registered command per skill in `.pi/extensions/pstack.ts`, so the commands show in Pi's `/` menu. Each command forwards `/skill:<name>`. Pi eval cells type `/skill:<name>`, because the `ablate` arm removes `.pi/extensions/pstack.ts` and its commands with it.

## Where each check belongs

| Kind of check | Where it lives | CI |
| --- | --- | --- |
| The entry files equal what the generator renders | `node scripts/sync-manifests.mjs --check` | yes |
| `pstack/` equals the lock, and upstream's suites keep their counts | `scripts/check-base.sh` | yes |
| The Cursor catalog passes upstream's validator, and nothing hides pstack from Grok Bot | `scripts/check-catalog.sh` | yes |
| Both Claude manifests pass the schema | `claude plugin validate --strict` on `.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json` | yes |
| Deterministic behavior of code this repo owns, with no harness binary | `bun run test`, which runs `tests/*.test.ts` | yes |
| Install, load and spawn in a real harness binary, against a dummy or scripted local model | a `scripts/check.sh` layer: `grok`, `claude`, `pi`, `opencode` or `eval` | no, local |
| Skill behavior with a real model | billed cells, `node evals/cells.mjs run` | never |
| The user path in a real session | `.claude/skills/verify-pstack-all/` | never |

A deterministic check that needs no harness binary goes in `bun run test`, so CI runs it. Do not add a separate local-only deterministic suite. A check that drives a real harness goes in a `check.sh` layer. Skill behavior needs a model, so it goes in a scenario in `evals/scenarios.mjs`. Billed cells are never part of `scripts/check.sh` or CI. `evals/README.md` explains the cells.

Validate the Claude plugin with both paths, `.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json`, each with `--strict`. `scripts/check-claude.sh` and CI both do this.

## CI gates

`.github/workflows/ci.yml` runs on every push to `main` and every pull request. Its steps, in order:

1. `node scripts/sync-manifests.mjs --check`
2. `scripts/check-base.sh`
3. `scripts/check-catalog.sh`
4. `claude plugin validate --strict` on both Claude manifests, with `@anthropic-ai/claude-code` pinned at `CLAUDE_CODE_VERSION`
5. `bun run test`

The workflow pins bun and node to the toolchain the base baseline was recorded with, because `check-base.sh` compares upstream's own suite counts. It pins the claude CLI so a new validator rule cannot fail CI without a repo change. Bump a pin on purpose, in its own change.

The `grok`, `pi`, `opencode` and `eval` layers stay local, and CI runs only the validate half of the `claude` layer. Running grok, pi and opencode headless on a GitHub runner is unverified (`decisions.tsv`, 2026-10-24T06:20:33Z). Run `scripts/check.sh` locally before you hand over a change. Each final check in the decision log ran on the exact state handed over.

## New guards

1. Show each new guard failing before it lands. For a `check.sh` layer, add a `run "<name>" <layer> "<break>"` line to `scripts/selftest-check.sh`. The break must fail that layer. For a unit test, break the code it guards with a one-line change, watch the test fail, and say so in the commit or the decision row. A selftest break with layer `unit` pins a unit test the same way.
2. Prefer tightening an existing guard over adding a new script or test file.
3. Pin the smallest unit that would have failed on the regressing change: a name, a path, a flag, one fixture. Do not snapshot whole files.
4. If only a model can judge the failure, write an eval scenario, not a string test.
5. A guard must fail when its evidence is missing. Pi silently ignores a missing extension file, so the dummy-provider run in `check-pi.sh` is the step that catches it. The golden check fails on any unparseable JSONL line, because a golden that drops evidence still passed.

`scripts/selftest-check.sh` copies the repo and runs the full `scripts/check.sh` once per break. Count the breaks with `grep -c '^run ' scripts/selftest-check.sh`. `.audit/check-selftest.txt` keeps the output of a recorded run.

## Generated files

`scripts/sync-manifests.mjs` writes five entry files from `pstack/plugin.json`:

- `plugin.json` for Grok CLI
- `.cursor-plugin/marketplace.json` for Cursor and Grok Bot
- `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` for Claude Code
- `package.json` for Pi and opencode

To change an entry file, edit the `HARNESSES` table in `scripts/sync-manifests.mjs`, run `node scripts/sync-manifests.mjs`, and commit the script and its output together. `package.json` is shared. Pi reads its `pi` key and opencode reads `main`. An npm script such as `test` also lives in the table's `package.json` row. A new upstream agent under `pstack/agents/` shows up as drift in `.claude-plugin/plugin.json`, because the script lists each agent file.

## Update the upstream base

Updating the base is a deliberate step:

1. Copy the new upstream tree into `pstack/` with `git archive` of the upstream commit, which keeps the committed files and modes.
2. Rewrite `base/pstack.lock` and `base/pstack.ls-tree`.
3. Run `scripts/check-base.sh --record`. It refuses to record while `pstack/` does not match the lock.
4. Run `node scripts/sync-manifests.mjs`.
5. Run `PSTACK_UPSTREAM_DIR=<cursor/plugins clone> scripts/check.sh` to prove the lock against upstream.

Then update the counts and the base commit that `README.md`, this file and `docs/specs/` state.

## Harness specs

`docs/specs/<harness>.md` records each adapter claim, how it was verified, and against which version. Each file opens with `Last verified <date> against <binary> <version>`. What no run exercised goes under `## Not verified`. A claim that rests only on a harness's docs goes there too. Change the spec in the same commit as the behavior it describes.

## Harness config

Checks and unit tests never touch the user's harness config. The checks use a throwaway `CLAUDE_CONFIG_DIR`, `PI_CODING_AGENT_DIR`, `HOME` and XDG dirs. Billed cells have documented exceptions: Pi uses `~/.pi/agent` for its login, and Grok installs into `~/.grok` and uninstalls afterwards. `evals/README.md` "Safety and isolation" lists them, with what each cell snapshots and restores.

## Decision log

`decisions.tsv` records each decision with the columns `ts`, `phase`, `decision`, `why`, `evidence` and `result`. Append a row for each decision, finding, fix or final check. Never rewrite an earlier row. To reverse a decision, append a row that names the earlier row's `ts`, as the row at 2026-10-24T03:14:46Z does.

## Commits

Commit subjects are short imperative sentences, as `git log` shows. Run `bun run test` after a change to code this repo owns, and `scripts/check.sh` before you commit a change to an entry file, an adapter, an extension, the opencode plugin, a check or the eval cells.

## Review

Review a change against `CODING_STANDARDS.md`, and against `tests/CODING_STANDARDS.md` for `tests/**`.
