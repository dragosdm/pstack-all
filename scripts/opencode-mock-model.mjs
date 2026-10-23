#!/usr/bin/env node
// A scripted OpenAI-compatible model for scripts/check-opencode.sh. No network, no billing.
// The parent turn "spawn" calls the subagent tool for comment-sicko, then for poteto-agent. Each child answers at once.
// A /pstack:<name> command turn calls the skill tool for that skill. Every request is logged for the check to grade.
import { appendFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"

const [portFile, logFile] = process.argv.slice(2)

const text = (content) => (typeof content === "string" ? content : (content ?? []).map((part) => part.text ?? "").join(""))
const call = (name, args) => ({ toolCall: { id: `call_${name}_${args.agent ?? args.id ?? ""}`, name, arguments: JSON.stringify(args) } })

function reply(body) {
  const messages = body.messages ?? []
  if (!(body.tools ?? []).length) return { content: "Title" }
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
    const delta = out.toolCall
      ? { role: "assistant", tool_calls: [{ index: 0, id: out.toolCall.id, type: "function", function: { name: out.toolCall.name, arguments: out.toolCall.arguments } }] }
      : { role: "assistant", content: out.content }
    res.end(chunk(delta, null) + chunk({}, out.toolCall ? "tool_calls" : "stop") + "data: [DONE]\n\n")
  })
})
server.listen(0, "127.0.0.1", () => writeFileSync(portFile, String(server.address().port)))
