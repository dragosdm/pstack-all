# Grok CLI install

A Grok CLI user installs this repo and gets the same 58 pstack skills and 2 agents as upstream `pstack/`. Grok loads them through the root `plugin.json`, not through `.claude-plugin/plugin.json`.

## Sub-features

- `grok-install` installs from the repo root with `--trust`.
- `grok-root-manifest` makes Grok load the root `plugin.json`.
- `grok-inventory` lists 58 skills and 2 agents from `plugin_name` `pstack`.

## How to get to it (user POV)

- `grok plugin install <git URL or path of this repo> --trust`.

## Driving it with launch.sh

Preconditions:

- A run launched with `grok` or `all`, and `doctor.sh <id>` all `OK`.

- **Install.** Run `launch.sh grok`. `grok-install.log` shows the install succeeded.
- **Root manifest.** `doctor.sh` prints `grok loaded the root plugin.json (pstack v<version>)`. `grok-details.txt` has that line with no `(subdir: pstack)`.
- **Inventory.** `grok-inventory.json` lists 58 skill names and the agents `pstack:comment-sicko` and `pstack:poteto-agent`.

## Gotchas

- Grok reads `plugin.json`, then `.grok-plugin/plugin.json`, then `.claude-plugin/plugin.json`. Without the root file it silently loads the Claude manifest, and the version line still says `pstack v<version>`. Compare `grok-details.txt` against the root `plugin.json`, not against "any pstack".
- The `mise` shim for `grok` fails under a foreign `HOME`. The helpers resolve the real binary with `mise which grok`, or `GROK_BIN` when set.
- The install is a copy, at `<HOME>/.grok/installed-plugins/<id>/`. `doctor.sh` checks only the version line for Grok, so it does not catch a stale copy. Relaunch after editing the repo.
- Users type bare names in Grok, such as `/how` and `/poteto-help`, not `/pstack:<name>`.
- This skill drives no Grok session. The `grok` cells host does, as a reference column ([Graded skill cells](./cells.md)). It installs into your real `~/.grok` for the run, uninstalls afterwards, and refuses to start if a `pstack` plugin is already installed. The free Grok Build tier stops runs once its usage limit is reached.
