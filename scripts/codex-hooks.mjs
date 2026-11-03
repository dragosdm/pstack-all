#!/usr/bin/env node
// Prints the app-server hooks/list result for one cwd, for scripts/check-codex.sh. The CLI has no command that shows
// hooks or their trust state.
import { spawn } from "node:child_process"

const [codex, cwd] = process.argv.slice(2)
const server = spawn(codex, ["app-server"], { stdio: ["pipe", "pipe", "ignore"] })
const send = (message) => server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`)
const quit = (code, reason) => {
  if (reason) console.error(`codex-hooks: ${reason}`)
  clearTimeout(timer)
  server.removeAllListeners("exit")
  server.kill()
  process.exit(code)
}
const timer = setTimeout(() => quit(1, "no hooks/list answer in 30 seconds"), 30_000)
server.on("exit", (code) => quit(1, `app-server exited with ${code} before answering hooks/list`))
server.stdin.on("error", () => {})

let buffer = ""
server.stdout.setEncoding("utf8")
server.stdout.on("data", (data) => {
  buffer += data
  for (let end; (end = buffer.indexOf("\n")) >= 0; ) {
    const message = JSON.parse(buffer.slice(0, end))
    buffer = buffer.slice(end + 1)
    if (message.error) quit(1, `request ${message.id} failed: ${JSON.stringify(message.error)}`)
    if (message.id === 1) {
      send({ method: "initialized" })
      send({ id: 2, method: "hooks/list", params: { cwds: [cwd] } })
    } else if (message.id === 2) {
      console.log(JSON.stringify(message.result))
      quit(0)
    }
  }
})
send({ id: 1, method: "initialize", params: { clientInfo: { name: "pstack-check", version: "0" } } })
