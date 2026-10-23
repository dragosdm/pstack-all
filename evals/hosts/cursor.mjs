import { join } from "node:path";
import { jsonl, workspaceFacts } from "./common.mjs";

// Cursor runs pstack natively, with no adapter, so its cells are a reference column rather than a gate.
export const cursor = {
  name: "cursor",
  reference: true,
  command: (skill) => `/${skill}`,
  arms: ["post", "ref"],
  adapter: () => null,

  // Cursor cells are read-only how scenarios: commands are not auto-approved, and any that run stay in Cursor's sandbox.
  launch(cell, opts) {
    return {
      argv: [
        "cursor-agent", "-p", "--trust", "--sandbox", "enabled", "--output-format", "stream-json",
        "--plugin-dir", join(cell.pluginRoot, "pstack"), ...(opts.cursorModel ? ["--model", opts.cursorModel] : []), cell.prompt,
      ],
      stdin: null,
      env: {},
    };
  },

  normalize(dir, cell) {
    const events = jsonl(join(dir, "transcript.jsonl"));
    const init = events.find((e) => e.type === "system" && e.subtype === "init") ?? {};
    const result = events.find((e) => e.type === "result") ?? {};
    const starts = events.filter((e) => e.type === "tool_call" && e.subtype === "started");
    const turns = [...new Set(starts.map((e) => e.model_call_id))];
    const spawns = starts
      .filter((e) => e.tool_call.taskToolCall)
      .map((e) => {
        const args = e.tool_call.taskToolCall.args ?? {};
        const type = Object.keys(args.subagentType ?? {})[0];
        return {
          turn: turns.indexOf(e.model_call_id),
          agent: type === "custom" ? args.subagentType.custom.name : type === "unspecified" || !type ? "generalPurpose" : type,
          readonly: args.readonly === true || /READ_?ONLY/i.test(args.mode ?? ""),
          worktree: /CLOUD/i.test(args.environment ?? ""),
          model: args.model ?? null,
          effort: null,
        };
      });
    return {
      host: "cursor",
      loaded: starts.some((e) => JSON.stringify(e.tool_call).includes(`${join(cell.pluginRoot, "pstack")}/`)),
      adapterRead: null,
      spawns,
      final: result.result ?? "",
      cost: null,
      modelObserved: init.model ?? null,
      leftover: null,
      ...workspaceFacts(dir),
    };
  },
};
