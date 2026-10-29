import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jsonl, readJson, workspaceFacts } from "./common.mjs";

const ADAPTER_PUSH = "event.system.push({ type: \"text\", text: adapterLine })";
const textOf = (content) => (content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("\n");

// Under a moved XDG_DATA_HOME the mise shim installs opencode afresh, so the binary is found before the move.
function opencodeBinary() {
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN;
  const mise = spawnSync("mise", ["which", "opencode"], { encoding: "utf8" });
  if (mise.status === 0 && mise.stdout.trim()) return mise.stdout.trim();
  return spawnSync("sh", ["-c", "command -v opencode"], { encoding: "utf8" }).stdout.trim() || "opencode";
}

// opencode cells have had only scripted-model runs, so the column is a reference rather than a gate.
export const opencode = {
  name: "opencode",
  reference: true,
  command: (skill) => `/pstack:${skill}`,
  arms: ["post", "ablate", "ref"],
  adapter: (pluginRoot) => join(pluginRoot, "docs/harness/opencode.md"),

  // The context hook is the only thing that points the model at docs/harness/opencode.md.
  ablate(tree) {
    const file = join(tree, ".opencode/plugins/pstack.js");
    const source = readFileSync(file, "utf8");
    if (!source.includes(ADAPTER_PUSH)) throw new Error(`${file} no longer pushes the adapter line`);
    writeFileSync(file, source.replace(ADAPTER_PUSH, "void adapterLine"));
  },

  // The plugin loads from the cell's tree through a throwaway opencode.json, as a user's `plugins` entry loads it.
  launch(cell, opts) {
    const [skill, ...words] = cell.prompt.split(" ");
    const config = { ...(opts.opencodeConfig ? readJson(opts.opencodeConfig) : {}), ...(opts.opencodeModel ? { model: opts.opencodeModel } : {}) };
    const spec = {
      opencode: opencodeBinary(), project: cell.project, home: join(dirname(cell.project), "opencode-home"), tree: cell.pluginRoot,
      command: skill.slice(1), text: words.join(" "), config, timeout: Math.max(30, opts.timeout - 15),
    };
    return {
      argv: [process.execPath, join(dirname(fileURLToPath(import.meta.url)), "opencode-run.mjs"), JSON.stringify(spec)],
      stdin: null,
      // HOME moves with the XDG dirs, so commits in the session need the fixture's identity.
      env: { GIT_AUTHOR_NAME: "dev", GIT_AUTHOR_EMAIL: "dev@example.invalid", GIT_COMMITTER_NAME: "dev", GIT_COMMITTER_EMAIL: "dev@example.invalid" },
    };
  },

  normalize(dir, cell) {
    const events = jsonl(join(dir, "transcript.jsonl"));
    const plugin = events.find((e) => e.type === "plugin")?.plugin;
    const sessions = events.filter((e) => e.type === "session");
    const root = sessions.find((s) => s.parentID === null);
    const messages = root?.export.messages ?? [];
    const assistant = messages.filter((m) => m.type === "assistant");
    const calls = assistant.flatMap((m, turn) => (m.content ?? []).filter((part) => part.type === "tool").map((part) => ({ turn, name: part.name, input: part.state?.input ?? {}, metadata: part.state?.metadata ?? {} })));
    const first = assistant[0]?.model;
    return {
      host: "opencode",
      loaded:
        // opencode 2.1.4 reports the resolved package.json main, 2.2.0 the package path the config lists.
        plugin?.state?.status === "active" && [cell.pluginRoot, join(cell.pluginRoot, "index.js")].includes(plugin.source?.path)
        && calls.some((c) => c.name === "skill" && c.metadata.directory?.startsWith(`${cell.skillsDir}/`)),
      adapterRead: calls.some((c) => c.name === "read" && c.input.path === cell.adapterPath),
      spawns: calls
        .filter((c) => c.name === "subagent")
        .map((c) => {
          const [model, effort] = (c.input.model ?? "").split("#");
          return {
            turn: c.turn,
            agent: c.input.agent ?? null,
            readonly: c.input.agent === "explore",
            // The subagent tool has no worktree option; the adapter has the parent make one under pstack-worktrees/.
            worktree: /\/pstack-worktrees\//.test(c.input.prompt ?? ""),
            model: model || null,
            effort: effort || null,
          };
        }),
      final: textOf([...assistant].reverse().find((m) => textOf(m.content).trim())?.content),
      cost: sessions.reduce((sum, s) => sum + (s.export.info?.cost ?? 0), 0),
      modelObserved: first ? `${first.providerID}/${first.id}` : null,
      denied: events.filter((e) => e.type === "permission").map((e) => e.request.action),
      error: events.find((e) => e.type === "error")?.message ?? (events.some((e) => e.type === "timeout") ? "timeout" : null),
      leftover: null,
      ...workspaceFacts(dir),
    };
  },
};
