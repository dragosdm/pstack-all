# Claude Code install

A Claude Code user adds this repo as a marketplace, installs `pstack`, and gets 57 `/pstack:` skills, 2 `pstack:` agents, and a SessionStart hook.

## Sub-features

- `install-add` registers the `pstack-all` marketplace from the repo.
- `install-plugin` installs `pstack@pstack-all`.
- `install-inventory` lists 57 skills and 1 SessionStart hook.

## How to get to it (user POV)

- `claude plugin marketplace add dragosdm/pstack-all`, then `claude plugin install pstack@pstack-all`.
- `/plugin` inside a session, then add the marketplace and install from the menu.

## Driving it with launch.sh

Preconditions:

- `doctor.sh <id>` is all `OK` for a run launched with `claude` or `all`. Doctor also requires the Claude login, which only a drive needs. A logged-out machine fails doctor even when the install is fine.

- **Add and install.** Run `launch.sh claude`. `claude-install.log` contains `Successfully installed plugin: pstack@pstack-all (scope: user)`.
- **Inventory.** Read `claude-details.txt`. It shows `pstack <version>`, `Skills (57)`, and a line starting `Hooks (1)  SessionStart`.
- **Installed bytes.** `doctor.sh` reports `claude install matches the working tree`.

## Gotchas

- `claude-details.txt` shows `Agents (0)`. That is expected: `details` counts only a default `agents/` folder, and this manifest lists agent files. Prove agents with [claude-agents.md](./claude-agents.md).
- The marketplace and the plugin are added from a local path. Install from GitHub (`dragosdm/pstack-all`) is unverified, although the repo is pushed.
- A user who also has `pstack@cursor-plugins` gets the same `pstack:` names twice. `launch.sh` avoids it with a throwaway `CLAUDE_CONFIG_DIR`, and sessions with `--setting-sources project,local`. Real users must uninstall one.
