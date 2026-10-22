# Cursor and Grok Bot catalog

A Cursor user adds this repo as a marketplace and installs `pstack`. Cursor reads `.cursor-plugin/marketplace.json`, whose one entry points at `pstack/`, so it loads upstream's own `pstack/.cursor-plugin/plugin.json`. Grok Bot lists plugins from the same catalog.

## Sub-features

- `cursor-catalog` passes upstream's `validate-plugins.mjs`.
- `cursor-local` loads `pstack/` in a local Cursor session.
- `grokbot-visible` keeps the entry free of a `minClientVersions` gate.

## How to get to it (user POV)

- `cursor-agent plugin marketplace add <git URL of this repo>`, then install `pstack`.
- `cursor-agent --plugin-dir pstack` for a local session.

## Driving it with scripts/check.sh

Preconditions:

- None beyond the baseline. This feature has no `launch.sh` harness.

- **Catalog.** Run `PSTACK_UPSTREAM_DIR=<cursor/plugins clone> scripts/check-catalog.sh`. Its output has `catalog: PASS upstream validate-plugins.mjs` and `catalog: PASS one pstack entry and no minClientVersions`.
- **Marketplace install.** Not drivable. Cursor indexes marketplaces server-side. Report it as skipped.
- **Grok Bot.** Not drivable. No local tool adds a marketplace to Grok Bot. Report it as skipped.

## Gotchas

- The catalog validator passing is not an install. Never report `cursor-local` or a marketplace install as verified from the catalog check.
- `check-catalog.sh` installs `ajv` from npm on its first run, so that run needs network access.
