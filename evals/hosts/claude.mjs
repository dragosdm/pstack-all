import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
  // acceptEdits accepts edits only inside the project and any --add-dir. A bare Edit or Write rule would allow every path.
  // Bash runs only git and reading commands; anything else is denied and recorded.
  launch(cell, opts) {
    // statechart writes its spec outside the project and runs its checker on it, so the cell gets a scratch folder
    // next to the project. Its view module is model-written JavaScript that the checker imports.
    const scratch = cell.scenarioSnapshot.skill === "statechart" ? join(dirname(cell.project), "scratch") : null;
    if (scratch) mkdirSync(scratch, { recursive: true });
    return {
      argv: [
        "claude", "-p", "--output-format", "stream-json", "--verbose", "--no-session-persistence",
        "--setting-sources", "project,local", "--plugin-dir", cell.pluginRoot,
        "--model", opts.claudeModel, "--max-budget-usd", String(opts.claudeBudget), "--permission-mode", "acceptEdits",
        ...(scratch ? ["--add-dir", scratch] : []),
        "--disallowedTools", "WebFetch", "WebSearch",
        "--allowedTools", "Read", "Glob", "Grep", "Agent", "TodoWrite",
        ...["status", "diff", "log", "show", "ls-files", "rev-parse", "branch", "add", "commit", "switch", "checkout", "worktree", "merge"].map((sub) => `Bash(git ${sub}:*)`),
        "Bash(ls:*)", "Bash(rg:*)", "Bash(grep:*)", "Bash(cat:*)", "Bash(wc:*)", "Bash(head:*)",
        ...(scratch ? [`Bash(${join(cell.skillsDir, "statechart/scripts/statechart")}:*)`] : []),
      ],
      stdin: cell.prompt,
      env: { CLAUDECODE: undefined, CLAUDE_CODE_ENTRYPOINT: undefined, ...(scratch ? { TMPDIR: scratch } : {}) },
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
