import { spawnSync } from "node:child_process"
import {
  appendFileSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import pstackPiExtension from "../.pi/extensions/pstack.ts"

setDefaultTimeout(30_000)

const root = resolve(import.meta.dir, "..")
const skillsDir = join(root, "pstack/skills")
const owner = Symbol.for("pstack.pi.extension")

const skillNames = readdirSync(skillsDir)
  .filter((name) => existsSync(join(skillsDir, name, "SKILL.md")))
  .sort()

function yamlDescription(name: string): string {
  const yaml = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(join(skillsDir, name, "SKILL.md"), "utf8"))![1]
  return (Bun.YAML.parse(yaml) as { description: string }).description
}

type Ctx = { mode: string; isIdle(): boolean }
type Command = { description: string; handler: (args: string, ctx: Ctx) => Promise<void> }
type Handler = (event?: any) => any

function mockPi() {
  const handlers = new Map<string, Set<Handler>>()
  const commands = new Map<string, Command>()
  const sent: Array<[string, Record<string, unknown>]> = []
  const pi = {
    on(event: string, handler: Handler) {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(handler)
      return () => handlers.get(event)!.delete(handler)
    },
    registerCommand: (name: string, command: Command) => commands.set(name, command),
    sendUserMessage: (text: string, options: Record<string, unknown>) => sent.push([text, options]),
    getCommands: () => [...commands.keys()],
  }
  const emit = async (event: string, payload?: unknown) => {
    const results = []
    for (const handler of [...(handlers.get(event) ?? [])]) results.push(await handler(payload))
    return results
  }
  const count = (event: string) => handlers.get(event)?.size ?? 0
  return { pi, commands, sent, emit, count }
}

function load() {
  const mock = mockPi()
  pstackPiExtension(mock.pi)
  return mock
}

const pending = (promise: Promise<void>) => Promise.race([promise.then(() => "returned"), Bun.sleep(0).then(() => "pending")])

beforeEach(() => {
  delete (globalThis as any)[owner]
})

describe("pi extension", () => {
  test("resources_discover brings the pstack skills directory", async () => {
    const { emit } = load()
    expect(await emit("resources_discover")).toEqual([{ skillPaths: [skillsDir] }])
  })

  test("registers a pstack:<name> command per skill folder with the frontmatter description", () => {
    const { commands } = load()
    expect([...commands.keys()].sort()).toEqual(skillNames.map((name) => `pstack:${name}`))
    for (const name of skillNames) expect(commands.get(`pstack:${name}`)!.description).toBe(yamlDescription(name))
  })

  test("a command forwards /skill:<name> with its arguments and expands it", async () => {
    const { commands, sent } = load()
    await commands.get("pstack:how")!.handler("is this cache safe?", { mode: "interactive", isIdle: () => true })
    await commands.get("pstack:why")!.handler("", { mode: "interactive", isIdle: () => true })
    expect(sent).toEqual([
      ["/skill:how is this cache safe?", { expandPromptTemplates: true }],
      ["/skill:why", { expandPromptTemplates: true }],
    ])
  })

  test("a command sent while the agent runs is delivered as a follow-up", async () => {
    const { commands, sent } = load()
    await commands.get("pstack:how")!.handler("later", { mode: "interactive", isIdle: () => false })
    expect(sent).toEqual([["/skill:how later", { expandPromptTemplates: true, deliverAs: "followUp" }]])
  })

  test.each(["print", "json"])("in %s mode a command returns only after the agent settles", async (mode) => {
    const { commands, emit } = load()
    const run = commands.get("pstack:how")!.handler("go", { mode, isIdle: () => true })
    expect(await pending(run)).toBe("pending")
    await emit("agent_settled")
    expect(await pending(run)).toBe("returned")
  })

  test("in interactive mode a command returns without waiting for the agent", async () => {
    const { commands } = load()
    expect(await pending(commands.get("pstack:how")!.handler("go", { mode: "interactive", isIdle: () => true }))).toBe("returned")
  })

  test("a second load in the same process stays quiet until the first session shuts down", async () => {
    const first = load()
    expect(first.commands.size).toBe(skillNames.length)
    expect(first.count("before_agent_start")).toBe(1)

    const second = load()
    expect(second.commands.size).toBe(0)
    expect(second.count("before_agent_start")).toBe(0)

    await first.emit("session_shutdown")
    const third = load()
    expect(third.commands.size).toBe(skillNames.length)
    expect(third.count("before_agent_start")).toBe(1)
  })

  test("before_agent_start appends one line naming docs/harness/pi.md", async () => {
    const { emit } = load()
    const [{ systemPrompt }] = await emit("before_agent_start", { systemPrompt: "base prompt" })
    expect(systemPrompt.startsWith("base prompt")).toBe(true)
    const added = systemPrompt.slice("base prompt".length).trim().split("\n")
    expect(added).toHaveLength(1)
    expect(added[0]).toContain(join(root, "docs/harness/pi.md"))
  })
})

const scratch = mkdtempSync(join(tmpdir(), "pstack-subagent-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

function assistantEntry(id: string, parentId: string | null, text: string): string {
  return `${JSON.stringify({ type: "message", id, parentId, message: { role: "assistant", content: [{ type: "text", text }] } })}\n`
}

describe("pstack-subagent wait", () => {
  test("a poll between wait's reads does not make wait print the previous reply", async () => {
    const agentDir = join(scratch, "agent")
    const runDir = join(agentDir, "pstack-subagents", "abc123")
    const bin = join(scratch, "bin")
    mkdirSync(join(runDir, "inbox"), { recursive: true })
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, "tmux"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
    const sessionFile = join(runDir, "session.jsonl")
    writeFileSync(sessionFile, assistantEntry("a1", null, "reply to the task"))
    const inboxFile = join(runDir, "inbox", "1-send.json")
    writeFileSync(inboxFile, `${JSON.stringify({ message: "second", delivery: "auto" })}\n`)
    const metadataFile = join(runDir, "metadata.json")
    expect(spawnSync("mkfifo", [metadataFile]).status).toBe(0)
    const metadata = (state: string) =>
      JSON.stringify({
        version: 1, handle: "abc123", tmuxSession: "pstack-subagent-abc123", runDir, sessionFile, cwd: scratch,
        provider: "p", model: "m", thinking: "medium", state, hasStarted: true, createdAt: "", updatedAt: "",
      })

    const wait = Bun.spawn(["node", join(root, ".pi/extensions/subagent/subagent.ts"), "wait", "abc123", "--timeout", "20"], {
      env: { PATH: `${bin}:${process.env.PATH}`, PI_CODING_AGENT_DIR: agentDir },
      stdout: "pipe",
      stderr: "pipe",
    })
    // Each read of metadata.json opens the FIFO. The first read returns the state from before the child's poll, and
    // the poll runs while that read is in flight. Later reads see the child busy, then idle with the new reply.
    let reads = 0
    while (wait.exitCode === null) {
      let fd: number
      try {
        fd = openSync(metadataFile, constants.O_WRONLY | constants.O_NONBLOCK)
      } catch {
        await Bun.sleep(5)
        continue
      }
      reads++
      if (reads === 1) unlinkSync(inboxFile)
      if (reads === 2) appendFileSync(sessionFile, assistantEntry("a2", "a1", "reply to second"))
      writeSync(fd, metadata(reads === 2 ? "busy" : "idle"))
      closeSync(fd)
      // wait polls every 500 ms. Pausing lets this read reach EOF before the FIFO is opened for the next one.
      await Bun.sleep(100)
    }
    await wait.exited
    expect(await new Response(wait.stdout).text()).toBe("abc123 finished\n\nreply to second\n")
  })
})
