# Cursor and Grok Bot catalog

A Cursor user adds this repo as a marketplace and installs `pstack`. Cursor reads `.cursor-plugin/marketplace.json`, whose one entry points at `pstack/`, so it loads upstream's own `pstack/.cursor-plugin/plugin.json`. Grok Bot lists plugins from the same catalog.

## Sub-features

- `cursor-catalog` passes upstream's `validate-plugins.mjs`.
- `cursor-local` loads `pstack/` in a local Cursor session.
- `grokbot-visible` keeps the entry free of a `minClientVersions` gate.

## How to get to it (user POV)

- `cursor-agent plugin marketplace add <git URL of this repo>`, then install `pstack`.
- `cursor-agent --plugin-dir pstack` for a local session.

## Driving it with check-catalog.sh and cells

Preconditions:

- None beyond the baseline. This feature has no `launch.sh` harness.

- **Catalog.** Run `scripts/check-catalog.sh`. `PSTACK_UPSTREAM_DIR=<cursor/plugins clone>` is optional and adds a comparison with upstream's validator. Its output has `catalog: PASS upstream validate-plugins.mjs` and `catalog: PASS one pstack entry and no minClientVersions`.
- **Local session.** `node evals/cells.mjs run --scenario how-simple --host cursor` runs `cursor-agent -p --trust --force --output-format stream-json --plugin-dir <tree>/pstack` ([Graded skill cells](./cells.md)). Proof is `loaded: pass` in the cell's `grade.json`: tool calls read files under `<tree>/pstack/`. It bills your Cursor login. Cursor cells are a reference column, and `readonly: fail` is expected because Cursor's `Task` call has no read-only marker.
- **Marketplace install.** Not drivable. Cursor indexes marketplaces server-side. Report it as skipped.
- **Grok Bot.** Not drivable. No local tool adds a marketplace to Grok Bot. Report it as skipped.

## Gotchas

- The catalog validator passing is not an install. Never report `cursor-local` or a marketplace install as verified from the catalog check.
- A local session loads `pstack/.cursor-plugin/plugin.json` directly and never reads the catalog. Never report the catalog or a marketplace install as verified from a cursor cell.
- `check-catalog.sh` installs `ajv` from npm into a fresh temp folder on every run, so each run needs network access or a warm npm cache.
