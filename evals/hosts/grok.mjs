import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { jsonl, workspaceFacts } from "./common.mjs";

const grok = (args) => spawnSync("grok", args, { encoding: "utf8" });

// pstack-all ships no Grok adapter, and spawn_subagent takes no model or read-only field, so Grok is a reference column.
export const grokHost = {
  name: "grok",
  reference: true,
  command: (skill) => `/${skill}`,
  arms: ["post", "ref"],
  adapter: () => null,

  // Grok has no per-project or per-session plugin flag: the run installs into ~/.grok and uninstalls when it ends.
  install(tree) {
    if (/\bpstack\b/.test(grok(["plugin", "list"]).stdout)) throw new Error("a pstack plugin is already installed in grok; uninstall it first");
    const out = grok(["plugin", "install", tree, "--trust"]);
    if (out.status !== 0) throw new Error(`grok plugin install failed: ${out.stderr || out.stdout}`);
    const id = /^\s*(\S+): pstack \[/m.exec(grok(["plugin", "list"]).stdout)?.[1];
    if (!id) throw new Error("grok did not list the installed pstack plugin");
    return { installedRoot: join(homedir(), ".grok/installed-plugins", id), uninstall: () => grok(["plugin", "uninstall", "pstack"]) };
  },

  // Grok cells are read-only how scenarios: approval is automatic, but every tool that writes or executes is denied.
  launch(cell, opts) {
    const denied = ["run_terminal_command", "write", "search_replace", "image_gen", "image_edit", "image_to_video", "reference_to_video", "scheduler_create", "workflow"];
    return {
      argv: [
        "grok", "-p", cell.prompt, "--output-format", "streaming-json", "--always-approve", "--disable-web-search",
        ...denied.flatMap((tool) => ["--deny", tool]),
        ...(opts.grokModel ? ["--model", opts.grokModel] : []),
      ],
      stdin: null,
      env: {},
    };
  },

  normalize(dir, cell) {
    const events = jsonl(join(dir, "transcript.jsonl"));
    const calls = events.filter((e) => e.type === "tool_call");
    const turnOf = (id) => id.split("-").slice(1, -1).join("-");
    const turns = [...new Set(calls.map((c) => turnOf(c.toolCallId)))];
    const end = events.find((e) => e.type === "end");
    return {
      host: "grok",
      loaded: calls.some((c) => JSON.stringify(c.rawInput ?? {}).includes(`${cell.installedRoot}/`)),
      adapterRead: null,
      spawns: calls
        .filter((c) => c.toolName === "spawn_subagent")
        .map((c) => ({
          turn: turns.indexOf(turnOf(c.toolCallId)),
          agent: c.rawInput?.subagent_type ?? "default",
          readonly: c.rawInput?.readonly === true,
          worktree: false,
          model: c.rawInput?.model ?? null,
          effort: null,
        })),
      // Parent and subagent text deltas arrive interleaved without ids, so this is only a rough answer.
      final: events.filter((e) => e.type === "text").map((e) => e.data).join(""),
      cost: end?.total_cost_usd ?? null,
      modelObserved: end ? Object.keys(end.modelUsage ?? {}).join(",") : null,
      error: events.find((e) => e.type === "error")?.message ?? null,
      leftover: null,
      ...workspaceFacts(dir),
    };
  },
};
