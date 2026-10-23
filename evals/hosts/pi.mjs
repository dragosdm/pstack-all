import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { jsonl, readJson, workspaceFacts } from "./common.mjs";

const toolsOf = (launchArgs = []) => {
  const i = launchArgs.indexOf("--tools");
  return i === -1 ? null : launchArgs[i + 1].split(",");
};

// Children started before an earlier child finished ran together. Pi has no message-level batch to group by.
function waves(children) {
  let turn = 0;
  let earliestFinish = Infinity;
  return children.map((child) => {
    if (Date.parse(child.createdAt) >= earliestFinish) {
      turn++;
      earliestFinish = Infinity;
    }
    earliestFinish = Math.min(earliestFinish, Date.parse(child.updatedAt));
    return turn;
  });
}

const textOf = (content) =>
  typeof content === "string" ? content : (content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("\n");

export const pi = {
  name: "pi",
  command: (skill) => `/skill:${skill}`,
  arms: ["post", "ablate", "ref"],
  adapter: (pluginRoot) => join(pluginRoot, "docs/harness/pi.md"),

  // Without .pi/extensions/pstack.ts nothing points the model at docs/harness/pi.md.
  ablate(tree) {
    const file = join(tree, "package.json");
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    manifest.pi.extensions = manifest.pi.extensions.filter((path) => !path.endsWith("/pstack.ts"));
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  },

  launch(cell, opts) {
    const [model, thinking] = opts.piModel.split(":");
    return {
      argv: ["pi", "-p", "--approve", "--session", join(cell.dir, "parent.jsonl"), "--model", model, ...(thinking ? ["--thinking", thinking] : []), cell.prompt],
      stdin: null,
      env: {
        PSTACK_SUBAGENT_KEEP_DIR: join(cell.dir, "children"),
        ...(opts.piAgentDir ? { PI_CODING_AGENT_DIR: opts.piAgentDir } : {}),
      },
    };
  },

  normalize(dir, cell) {
    const entries = jsonl(join(dir, "parent.jsonl"));
    const messages = entries.filter((e) => e.type === "message").map((e) => e.message);
    const calls = messages.filter((m) => m.role === "assistant").flatMap((m) => (m.content ?? []).filter((part) => part.type === "toolCall"));
    const childDir = join(dir, "children");
    const children = (existsSync(childDir) ? readdirSync(childDir) : [])
      .map((handle) => readJson(join(childDir, handle, "metadata.json")))
      .filter(Boolean)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const turns = waves(children);
    const sessions = [join(dir, "parent.jsonl"), ...children.map((child) => join(childDir, child.handle, "session.jsonl"))];
    const cost = sessions
      .flatMap((file) => jsonl(file))
      .reduce((sum, e) => sum + (e.type === "message" && e.message.role === "assistant" ? (e.message.usage?.cost?.total ?? 0) : 0), 0);
    const modelChange = entries.find((e) => e.type === "model_change");
    return {
      host: "pi",
      loaded: messages.some((m) => m.role === "user" && textOf(m.content).includes(`location="${cell.skillsDir}/`)),
      adapterRead: calls.some((c) => JSON.stringify(c.arguments ?? {}).includes(cell.adapterPath)),
      spawns: children.map((child, i) => {
        const tools = toolsOf(child.launchArgs);
        return {
          turn: turns[i],
          agent: child.agent ?? null,
          readonly: tools !== null && !tools.includes("edit") && !tools.includes("write"),
          worktree: Boolean(child.worktree),
          model: child.requested?.model ? `${child.requested.provider ?? child.provider}/${child.requested.model}` : null,
          effort: child.requested?.thinking ?? null,
        };
      }),
      final: textOf([...messages].reverse().find((m) => m.role === "assistant" && textOf(m.content).trim())?.content),
      cost,
      modelObserved: modelChange ? `${modelChange.provider}/${modelChange.modelId}` : null,
      availableModels: cell.piModels ?? null,
      leftover: readJson(join(dir, "leftover.json"), { count: 0 }).count,
      ...workspaceFacts(dir),
    };
  },
};
