import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { jsonl, workspaceFacts } from "./common.mjs";

export const claude = {
  name: "claude",
  command: (skill) => `/pstack:${skill}`,
  arms: ["post", "ablate", "ref", "upstream"],
  adapter: (pluginRoot, arm) => join(pluginRoot, arm === "upstream" ? "docs/harness/claude-code.md" : "pstack/docs/harness/claude-code.md"),

  // Without the SessionStart hook nothing tells the model about the adapter.
  ablate(tree) {
    const file = join(tree, ".claude-plugin/plugin.json");
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    delete manifest.hooks;
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  },

  // User settings stay out so an installed pstack can't answer for the cell's tree; the login still comes from ~/.claude.
  // Edits are accepted only inside the project and Bash only for git, node and reading; anything else is denied and recorded.
  launch(cell, opts) {
    return {
      argv: [
        "claude", "-p", "--output-format", "stream-json", "--verbose", "--no-session-persistence",
        "--setting-sources", "project,local", "--plugin-dir", cell.pluginRoot,
        "--model", opts.claudeModel, "--max-budget-usd", String(opts.claudeBudget), "--permission-mode", "acceptEdits",
        "--disallowedTools", "WebFetch", "WebSearch",
        "--allowedTools", "Read", "Glob", "Grep", "Agent", "Edit", "Write", "TodoWrite",
        "Bash(git:*)", "Bash(node:*)", "Bash(ls:*)", "Bash(rg:*)", "Bash(grep:*)", "Bash(find:*)", "Bash(cat:*)", "Bash(wc:*)", "Bash(head:*)",
      ],
      stdin: cell.prompt,
      env: { CLAUDECODE: undefined, CLAUDE_CODE_ENTRYPOINT: undefined },
    };
  },

  normalize(dir, cell) {
    const events = jsonl(join(dir, "transcript.jsonl"));
    const init = events.find((e) => e.type === "system" && e.subtype === "init") ?? {};
    // Headless Claude keeps going while background subagents report, with one result per turn; the last one is the answer.
    const results = events.filter((e) => e.type === "result");
    const result = results.at(-1) ?? {};
    const turns = [];
    const calls = [];
    for (const e of events) {
      if (e.type !== "assistant" || e.parent_tool_use_id) continue;
      if (!turns.includes(e.message.id)) turns.push(e.message.id);
      for (const block of e.message.content ?? []) {
        if (block.type === "tool_use") calls.push({ turn: turns.indexOf(e.message.id), name: block.name, input: block.input ?? {} });
      }
    }
    return {
      host: "claude",
      loaded: (init.plugins ?? []).some((p) => p.source === "pstack@inline" && p.path === cell.pluginRoot),
      adapterRead: calls.some((c) => c.name === "Read" && c.input.file_path === cell.adapterPath),
      spawns: calls
        .filter((c) => c.name === "Agent" || c.name === "Task")
        .map((c) => ({
          turn: c.turn,
          agent: c.input.subagent_type ?? "general-purpose",
          readonly: c.input.subagent_type === "Explore",
          worktree: c.input.isolation === "worktree",
          model: c.input.model ?? null,
          effort: c.input.effort ?? null,
        })),
      final: result.result ?? "",
      cost: result.total_cost_usd ?? null,
      denied: results.flatMap((r) => r.permission_denials ?? []).map((d) => d.tool_name),
      modelObserved: init.model ?? null,
      leftover: null,
      ...workspaceFacts(dir),
    };
  },
};
