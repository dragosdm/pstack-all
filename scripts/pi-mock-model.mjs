#!/usr/bin/env node
// A scripted OpenAI-compatible model for scripts/check-pi.sh. No network, no billing.
// The parent run gets one bash call that spawns two pstack subagents and waits for them; each child answers with
// what it was given, so the parent's final text carries proof of the agent prompt, the tool set, and the worktree.
// poteto-agent's 40 KB brief is longer than tmux accepts on a command line.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

// An optional script replaces the default parent turn: a JSON list of {read: "adapter"}, {bash: "<command>"} or
// {text: "<answer>"}, played one per parent turn.
const [portFile, logFile, scriptFile] = process.argv.slice(2);
const script = scriptFile ? JSON.parse(readFileSync(scriptFile, "utf8")) : null;

const SPAWN = `set -e
a=$(pstack-subagent spawn --name sicko --agent comment-sicko --tools read,grep,find,ls --prompt probe | sed -nE 's/^Spawned sicko \\(([a-z0-9]+)\\)$/\\1/p')
b=$(pstack-subagent spawn --name poteto --agent poteto-agent --worktree HEAD --prompt "probe $(head -c 40000 /dev/zero | tr '\\0' x)" | sed -nE 's/^Spawned poteto \\(([a-z0-9]+)\\)$/\\1/p')
pstack-subagent list
pstack-subagent wait "$a" --timeout 90
pstack-subagent wait "$b" --timeout 90
pstack-subagent stop "$a"
pstack-subagent stop "$b"`;

const text = (content) =>
  typeof content === "string" ? content : (content ?? []).map((part) => part.text ?? "").join("");

function reply(body) {
  const system = body.messages.filter((m) => m.role === "system" || m.role === "developer").map((m) => text(m.content)).join("\n");
  const all = body.messages.map((m) => text(m.content)).join("\n");
  const last = body.messages.at(-1);
  if (all.includes(script ? "Task:\n" : "Task:\nprobe")) {
    // A child whose task holds "RUN: <command>" runs it with bash first, so a script can show what children inherit.
    const run = /RUN: (.+)/.exec(all)?.[1];
    if (run && last.role !== "tool") return { toolCall: { id: "call_child_run", name: "bash", arguments: JSON.stringify({ command: run, timeout: 60 }) } };
    const agent = system.includes("# Comment Sicko") ? "comment-sicko" : system.includes("# Poteto subagent") ? "poteto-agent" : "none";
    const tools = (body.tools ?? []).map((t) => t.function?.name).sort().join(",");
    const worktree = /\/pstack-worktrees\/[a-z0-9]+/.test(all) ? "yes" : "no";
    return { content: `CHILD agent=${agent} tools=${tools} worktree=${worktree}` };
  }
  if (script) {
    const turn = body.messages.filter((m) => m.role === "assistant").length;
    const step = script[turn] ?? { text: "done" };
    if (step.text !== undefined) return { content: step.text };
    if (step.read) {
      const path = /read (\/\S+\.md) once per session/.exec(system)?.[1] ?? "missing-adapter-line";
      return { toolCall: { id: `call_${turn}`, name: "read", arguments: JSON.stringify({ path }) } };
    }
    return { toolCall: { id: `call_${turn}`, name: "bash", arguments: JSON.stringify({ command: step.bash, timeout: 240 }) } };
  }
  if (last.role === "tool") return { content: `PARENT\n${text(last.content)}` };
  return { toolCall: { id: "call_spawn", name: "bash", arguments: JSON.stringify({ command: SPAWN, timeout: 240 }) } };
}

function chunk(delta, finish) {
  return `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 0, model: "mock", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (data) => (raw += data));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    const out = reply(body);
    if (logFile) appendFileSync(logFile, `${JSON.stringify({ request: body, reply: out })}\n`);
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (out.toolCall) {
      const { id, name, arguments: args } = out.toolCall;
      res.write(chunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: args } }] }, null));
      res.write(chunk({}, "tool_calls"));
    } else {
      res.write(chunk({ role: "assistant", content: out.content }, null));
      res.write(chunk({}, "stop"));
    }
    res.end("data: [DONE]\n\n");
  });
});
server.listen(0, "127.0.0.1", () => writeFileSync(portFile, String(server.address().port)));
