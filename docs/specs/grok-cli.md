# Grok CLI

Last verified 2026-10-22 against `grok 1.0.67 (2fe064390d07)`.

## Entry file

Grok CLI loads the root `plugin.json`. `scripts/sync-manifests.mjs` writes it as `pstack/plugin.json` plus two keys:

```json
"skills": "./pstack/skills/",
"agents": "./pstack/agents/"
```

## Install

```
grok plugin install <git URL or local path of this repo> --trust
```

`grok plugin details pstack` lists `pstack v<version>`. If the line ends in `(subdir: pstack)`, Grok did not read the root `plugin.json`.

## Manifest precedence

Grok reads the first of these that exists at the plugin root:

1. `plugin.json`
2. `.grok-plugin/plugin.json`
3. `.claude-plugin/plugin.json`

Grok never reads `.cursor-plugin/plugin.json`. A root with only that file loads 0 skills.

With none of the three at the root, Grok scans subdirectories and installs `pstack/` as a subdir plugin. That gives the same inventory today. The root `plugin.json` exists so that a later root `.claude-plugin/plugin.json` can't take over Grok.

## Inventory

Both installs, the repo root and `pstack/` on its own, give 57 skills and 2 agents (`pstack:comment-sicko`, `pstack:poteto-agent`). Names, descriptions, and `userInvocable` are identical.

## Marketplace

`grok plugin marketplace add <local path>` registers the directory as one plugin source. It does not read a `marketplace.json` catalog from a local directory. This repo ships no Grok catalog.

## Check

`scripts/check-grok.sh` installs `pstack/` and the repo root into throwaway `HOME` directories, compares `grok inspect --json`, and confirms that the root install loaded the root `plugin.json`. Set `GROK_BIN` to choose the binary. The default resolves through `mise which grok`, because the `mise` shim fails under a foreign `HOME`.

## Not verified

- A model run inside Grok. The check covers discovery, not behavior.
- Install from a git URL. Only local paths were tested.
