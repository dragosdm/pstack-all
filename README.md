# my take on runing pstack on multiple harnesses

Goal: run pstack unchanged on Cursor, Claude Code, Grok, pi and opencode.

The layout follows compound-engineering. Every harness loads one skill tree in place, each harness gets its own entry file at the repo root, and a script renders those files from one metadata source. Here the skill tree is upstream pstack, kept byte for byte.

## Layout

- `pstack/` is a verbatim copy of upstream pstack. See `base/pstack.lock` for the repo, commit, and tree hash.
- `plugin.json` is the Grok CLI entry file. It points at `./pstack/skills/` and `./pstack/agents/`.
- `.cursor-plugin/marketplace.json` is the catalog for Cursor and Grok Bot. Its one entry has `source: "pstack"`, the shape upstream ships.
- `scripts/sync-manifests.mjs` writes both entry files from `pstack/plugin.json`. Edit the table in that script, never the files.
- `docs/specs/<harness>.md` records what was verified for each harness, how, and what was not.
- `base/` records the base: the upstream lock, the upstream file listing, the test baseline, and upstream's catalog validator and schemas in `base/upstream/`.
- `decisions.tsv` is the decision log.

## Harnesses

| Harness | Reads | Install | Verified |
| --- | --- | --- | --- |
| Cursor | `.cursor-plugin/marketplace.json`, then `pstack/.cursor-plugin/plugin.json` | `cursor-agent plugin marketplace add <repo>` | catalog passes upstream's validator |
| Grok Bot | the Cursor catalog | through the Cursor catalog | no `minClientVersions` gate |
| Grok CLI | `plugin.json` | `grok plugin install <repo> --trust` | same 57 skills and 2 agents as `pstack/` |
| Claude Code, pi, opencode | not yet | | |

## What must stay unchanged

- Every file under `pstack/`, byte for byte and mode for mode, equals upstream `eb4db2b:pstack` (tree `d08bf3a`).
- Skill behavior. pstack's own suites keep the counts in `base/test-baseline.tsv`.
- What each harness discovers. Grok CLI lists the same skills and agents from the repo root as from `pstack/`.
- Upstream's Cursor and Grok Bot shape, a catalog entry whose source is `pstack/`.
- Repo-relative paths. Playbooks reference `pstack/skills/...` from the repo root, so `pstack/` stays at the root.

Updating the base is a deliberate step. Copy the new upstream tree, rewrite `base/pstack.lock` and `base/pstack.ls-tree`, run `scripts/check-base.sh --record`, then `node scripts/sync-manifests.mjs`.

## Check

```
PSTACK_UPSTREAM_DIR=<cursor/plugins clone> scripts/check.sh
```

`scripts/check.sh` runs four layers and fails if any layer fails:

- `base` runs `scripts/check-base.sh`. `pstack/` must equal the lock, and its tests must keep their counts.
- `manifests` runs `node scripts/sync-manifests.mjs --check`. The entry files must equal what the script renders.
- `catalog` runs `scripts/check-catalog.sh`. Upstream's validator must pass on the Cursor catalog, and nothing may hide pstack from Grok Bot.
- `grok` runs `scripts/check-grok.sh`. The repo root must install through the root `plugin.json` with the same inventory as `pstack/`.

Without `PSTACK_UPSTREAM_DIR` the locks are trusted as written. Needs `git`, `bun`, `node`, `npm`, `jq`, `column`, and `grok`. The baseline was recorded with bun 1.3.10 and node v26.8.2. The 31 statechart tests that need TLC are skipped without Java and `TLA2TOOLS`.

`scripts/selftest-check.sh` breaks a throwaway copy six ways and requires each break to fail its own layer. Its last output is in `.audit/check-selftest.txt`. `.audit/base-selftest.txt` shows the base check failing on four deliberate breaks.
