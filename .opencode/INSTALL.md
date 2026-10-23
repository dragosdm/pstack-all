# Installing pstack for opencode

Add pstack to the `plugins` array in your global `~/.config/opencode/opencode.json` or in a project's `opencode.json`:

```json
{
  "plugins": ["pstack@git+https://github.com/dragosdm/pstack-all.git"]
}
```

opencode reloads its plugins when the config is saved, so no restart is needed. The plugin registers every pstack skill, a `/pstack:<name>` command for each one, such as `/pstack:how`, and the `poteto-agent` and `comment-sicko` subagents. It also adds one line to the system prompt that points the model at `docs/harness/opencode.md`, the opencode adapter. No installer or generated skill copy is needed.

The plugin exports only the opencode 2.x `setup` entry. It has no 1.x `server()` entry and was not tested on opencode 1.x.

## Local development

From this checkout, point opencode at the repo root. The entry is `index.js`, named by `main` in `package.json`:

```json
{
  "plugins": ["/path/to/pstack-all"]
}
```

A local path must be the folder, not `index.js`. After changing the plugin source, run `/reload`. Opening this checkout as an opencode project also loads the plugin without a config entry, because opencode auto-discovers `.opencode/plugins/pstack.js`. With a `plugins` entry as well, opencode keeps the project copy and marks the second one failed with `Duplicate plugin ID: pstack`.

## Uninstall

Remove the entry from `plugins` and save the config.
