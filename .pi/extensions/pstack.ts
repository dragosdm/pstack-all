import { existsSync, readdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
export const adapterPath = resolve(packageRoot, "docs/harness/pi.md")
const skillsDir = resolve(packageRoot, "pstack/skills")
const skillNames = new Set(readdirSync(skillsDir).filter((name) => existsSync(resolve(skillsDir, name, "SKILL.md"))))

// Rewrites the names other harnesses use for a pstack skill into Pi's own /skill:<name>, keeping the arguments.
export function toSkillCommand(text: string): string | undefined {
  const match = /^\/pstack:([a-z0-9-]+)(?=\s|$)/.exec(text)
  return match && skillNames.has(match[1]) ? `/skill:${match[1]}${text.slice(match[0].length)}` : undefined
}

// Pi's counterpart of the Claude Code SessionStart hook: pstack/ stays upstream bytes, so the adapter pointer rides in the system prompt.
export default function pstackPiExtension(pi: any) {
  // Pi auto-loads a trusted project's .pi/extensions without its package.json, so inside this checkout pi.skills never
  // applies. Bringing the skills from the extension keeps them next to the adapter line in every way Pi loads pstack.
  pi.on("resources_discover", () => ({ skillPaths: [skillsDir] }))
  pi.on("input", async (event: { text: string }) => {
    const text = toSkillCommand(event.text)
    return text ? { action: "transform", text } : { action: "continue" }
  })
  pi.on("before_agent_start", async (event: { systemPrompt: string }) => ({
    systemPrompt: `${event.systemPrompt}\n\npstack skills use Cursor names. Before you follow a pstack skill, read ${adapterPath} once per session.\n`,
  }))
}
