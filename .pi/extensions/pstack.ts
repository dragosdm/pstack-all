import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
export const adapterPath = resolve(packageRoot, "docs/harness/pi.md")
const skillsDir = resolve(packageRoot, "pstack/skills")

// The three description shapes upstream frontmatter uses: a double-quoted string, a plain scalar, and a `>-` folded
// block. check-pi.sh compares the result with Pi's own parse of the same skill.
export function skillDescription(skillFile: string): string {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(skillFile, "utf8"))?.[1] ?? ""
  const lines = frontmatter.split(/\r?\n/)
  const at = lines.findIndex((line) => line.startsWith("description:"))
  if (at < 0) return ""
  const value = lines[at].slice("description:".length).trim()
  if (value.startsWith('"')) return JSON.parse(value)
  if (value !== ">-" && value !== ">") return value
  const block: string[] = []
  for (const line of lines.slice(at + 1)) {
    if (!/^\s/.test(line)) break
    block.push(line.trim())
  }
  return block.join(" ")
}

export const skills = readdirSync(skillsDir)
  .filter((name) => existsSync(resolve(skillsDir, name, "SKILL.md")))
  .map((name) => ({ name, description: skillDescription(resolve(skillsDir, name, "SKILL.md")) }))

// Pi's counterpart of the Claude Code SessionStart hook: pstack/ stays upstream bytes, so the adapter pointer rides in the system prompt.
export default function pstackPiExtension(pi: any) {
  // Pi auto-loads a trusted project's .pi/extensions without its package.json, so inside this checkout pi.skills never
  // applies. Bringing the skills from the extension keeps them next to the adapter line in every way Pi loads pstack.
  pi.on("resources_discover", () => ({ skillPaths: [skillsDir] }))
  // Inside this checkout with pstack also installed, the extension loads twice; Pi would suffix the duplicate commands
  // (/pstack:how:1) and repeat the adapter line. getCommands cannot run during loading, so the first copy marks the
  // process and clears the mark on session_shutdown, which /reload fires before it loads the replacement runtime.
  const owner = Symbol.for("pstack.pi.extension")
  if ((globalThis as any)[owner]) return
  ;(globalThis as any)[owner] = true
  pi.on("session_shutdown", async () => {
    ;(globalThis as any)[owner] = false
  })
  // /pstack:<name> is the name Claude Code and opencode users type. Registering it puts it in the / menu, and
  // expandPromptTemplates makes Pi expand the /skill:<name> it forwards.
  for (const { name, description } of skills) {
    pi.registerCommand(`pstack:${name}`, {
      description,
      handler: async (args: string, ctx: { mode: string; isIdle(): boolean }) => {
        // sendUserMessage only starts the run, and print and JSON modes exit when the command returns.
        const settled = new Promise<void>((done) => {
          const off = pi.on("agent_settled", () => (off(), done()))
        })
        pi.sendUserMessage(`/skill:${name} ${args}`.trimEnd(), { expandPromptTemplates: true, ...(ctx.isIdle() ? {} : { deliverAs: "followUp" }) })
        if (ctx.mode === "print" || ctx.mode === "json") await settled
      },
    })
  }
  pi.on("before_agent_start", async (event: { systemPrompt: string }) => ({
    systemPrompt: `${event.systemPrompt}\n\npstack skills use Cursor names. Before you follow a pstack skill, read ${adapterPath} once per session.\n`,
  }))
}
