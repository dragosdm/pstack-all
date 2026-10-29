# Cursor

Last verified 2026-10-22 against `cursor-agent 2026.10.19-6bbf2c4`.

## Entry file

Cursor reads the root `.cursor-plugin/marketplace.json`. `scripts/sync-manifests.mjs` writes it with one entry:

```json
{ "name": "pstack", "source": "pstack", "description": "<from pstack/plugin.json>" }
```

The entry points at `pstack/`, so Cursor loads upstream's own `pstack/.cursor-plugin/plugin.json` and copies only `pstack/`. This is the same shape as the `pstack` entry in `cursor/plugins`.

## Install

Add this repo as a marketplace, then install `pstack` from it:

```
cursor-agent plugin marketplace add <git URL of this repo>
```

For a local session, load the plugin folder directly:

```
cursor-agent --plugin-dir pstack
```

## Manifest precedence

From the `cursor-agent` bundle (`dist-package/index.js`):

- Plugin manifest, first found. `.cursor-plugin/plugin.json`, `.claude-plugin/plugin.json`, `plugin.json`.
- Marketplace catalog, first found. `.cursor-plugin/marketplace.json`, `.claude-plugin/marketplace.json`.

Cursor's servers index a marketplace repository. The CLI registers the repository and shows `Failed to parse repository` when indexing fails.

## Check

`scripts/check-catalog.sh` runs upstream's `scripts/validate-plugins.mjs` and schemas, vendored in `base/upstream/`, on `.cursor-plugin/marketplace.json` and `pstack/`. The validator checks the catalog schema, each plugin's `.cursor-plugin/plugin.json` schema, name matching, and version agreement across the manifests in `pstack/`.

## Not verified

- Marketplace install from this repository. Cursor indexes it server-side, so no local test reaches it.
- Root manifests read through `--plugin-dir <repo root>`. Probes that asked the model to list its skills could not tell variants apart. Of the 58 pstack skills, 57 set `disable-model-invocation: true`, so the model sees only `setup-pstack`, and a globally installed pstack has a skill with the same name.
