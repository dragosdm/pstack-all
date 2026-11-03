#!/usr/bin/env node
// A Responses API model for scripts/check-codex.sh. No network, no billing. Every request is logged for the check to
// grade, and every turn ends with one assistant message.
import { appendFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"

const [portFile, logFile] = process.argv.slice(2)
const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
const item = { type: "message", role: "assistant", id: "msg_mock", content: [{ type: "output_text", text: "MOCK done" }] }
const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }

const server = createServer((req, res) => {
  let raw = ""
  req.on("data", (data) => (raw += data))
  req.on("end", () => {
    appendFileSync(logFile, `${JSON.stringify({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null })}\n`)
    if (req.method !== "POST") {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, { "content-type": "text/event-stream" })
    res.end(
      event("response.created", { response: { id: "resp_mock" } }) +
        event("response.output_item.done", { item }) +
        event("response.completed", { response: { id: "resp_mock", usage } }),
    )
  })
})
server.listen(0, "127.0.0.1", () => writeFileSync(portFile, String(server.address().port)))
