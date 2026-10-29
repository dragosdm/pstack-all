#!/usr/bin/env node
// A scripted OpenAI-compatible model for scripts/check-opencode.sh and the opencode cells in scripts/check-eval.sh.
// No network, no billing. Every request is logged for the check to grade.
// Without a script, the parent turn "spawn" calls the subagent tool for comment-sicko, then for poteto-agent, and each
// child answers at once. A /pstack:<name> command turn calls the skill tool for that skill.
// With a script, a JSON list played one step per parent turn: {skill: "<id>"}, {read: "adapter"}, {shell: "<command>"},
// {spawn: [{agent, description, prompt}, ...]} as one message, or {text: "<answer>"}. A child whose prompt holds
// "RUN: <command>" runs it with the shell tool first.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"

const [portFile, logFile, scriptFile] = process.argv.slice(2)
const script = scriptFile ? JSON.parse(readFileSync(scriptFile, "utf8")) : null

const text = (content) => (typeof content === "string" ? content : (content ?? []).map((part) => part.text ?? "").join(""))
const call = (name, args) => ({ toolCall: { id: `call_${name}_${args.agent ?? args.id ?? ""}`, name, arguments: JSON.stringify(args) } })

function scripted(messages) {
  const users = messages.filter((m) => m.role === "user").map((m) => text(m.content)).join("\n")
  const last = messages.at(-1)
  const turn = messages.filter((m) => m.role === "assistant").length
  if (!users.includes("Load and execute the `")) {
    const run = /RUN: (.+)/.exec(users)?.[1]
    return run && last.role !== "tool" ? call("shell", { command: run }) : { content: "CHILD done" }
  }
  const step = script[turn] ?? { text: "done" }
  if (step.text !== undefined) return { content: step.text }
  if (step.skill) return call("skill", { id: step.skill })
  if (step.shell) return { toolCall: { id: `call_shell_${turn}`, name: "shell", arguments: JSON.stringify({ command: step.shell }) } }
  if (step.read) {
    const system = messages.filter((m) => m.role === "system").map((m) => text(m.content)).join("\n")
    const path = /read (\/\S+\.md) once per session/.exec(system)?.[1] ?? "missing-adapter-line"
    return { toolCall: { id: `call_read_${turn}`, name: "read", arguments: JSON.stringify({ path }) } }
  }
  return { toolCalls: step.spawn.map((args, i) => ({ id: `call_subagent_${turn}_${i}`, name: "subagent", arguments: JSON.stringify(args) })) }
}

function reply(body) {
  const messages = body.messages ?? []
  if (!(body.tools ?? []).length) return { content: "Title" }
  if (script) return scripted(messages)
  const users = messages.filter((m) => m.role === "user").map((m) => text(m.content)).join("\n")
  const last = messages.at(-1)
  if (users.includes("CHILD-PROBE")) return { content: "CHILD done" }
  const skill = /Load and execute the `([^`]+)` skill/.exec(users)?.[1]
  if (skill) return last.role === "tool" ? { content: "SKILL done" } : call("skill", { id: skill })
  const turn = messages.filter((m) => m.role === "assistant").length
  if (turn === 0) return call("subagent", { agent: "comment-sicko", description: "sicko", prompt: "CHILD-PROBE sicko" })
  if (turn === 1) return call("subagent", { agent: "poteto-agent", description: "poteto", prompt: "CHILD-PROBE poteto" })
  return { content: "PARENT done" }
}

const chunk = (delta, finish) =>
  `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 0, model: "mock", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`

const server = createServer((req, res) => {
  let raw = ""
  req.on("data", (data) => (raw += data))
  req.on("end", () => {
    const body = JSON.parse(raw || "{}")
    const out = reply(body)
    appendFileSync(logFile, `${JSON.stringify({ request: body, reply: out })}\n`)
    res.writeHead(200, { "content-type": "text/event-stream" })
    const calls = out.toolCalls ?? (out.toolCall ? [out.toolCall] : [])
    const delta = calls.length
      ? { role: "assistant", tool_calls: calls.map((c, index) => ({ index, id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) }
      : { role: "assistant", content: out.content }
    res.end(chunk(delta, null) + chunk({}, calls.length ? "tool_calls" : "stop") + "data: [DONE]\n\n")
  })
})
server.listen(0, "127.0.0.1", () => writeFileSync(portFile, String(server.address().port)))
