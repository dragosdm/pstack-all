import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, test } from "bun:test"
// The package root, because opencode resolves the plugin through package.json main.
import plugin from "../index.js"

const root = resolve(import.meta.dir, "..")
const skillsDir = join(root, "pstack/skills")
const adapterPath = join(root, "docs/harness/opencode.md")

function frontmatter(path: string) {
  const text = readFileSync(path, "utf8")
  const [, yaml, body] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)!
  return { meta: Bun.YAML.parse(yaml) as Record<string, unknown>, body }
}

const skillIds = readdirSync(skillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

type Skill = { id: string; name: string; description: string; path: string; content: string; autoinvoke: boolean }
type Command = { name: string; description: string; execute: (input: Record<string, unknown>) => Promise<void> }
type Draft = { description?: string; mode?: string; permissions: Array<Record<string, string>> }
type ContextEvent = { agent: string; system: Array<{ type: string; text: string }> }

async function load() {
  const skills: Skill[] = []
  const commands: Command[] = []
  const agents = new Map<string, Draft>()
  const prompts: Array<Record<string, unknown>> = []
  const hooks = new Map<string, (event: ContextEvent) => void>()
  const ctx = {
    skill: { transform: async (fn: (editor: unknown) => void) => fn({ add: (s: Skill) => skills.push(s) }) },
    command: { transform: async (fn: (editor: unknown) => void) => fn({ add: (c: Command) => commands.push(c) }) },
    agent: {
      transform: async (fn: (editor: unknown) => void) =>
        fn({
          update: (id: string, edit: (draft: Draft) => void) => {
            const draft = agents.get(id) ?? { permissions: [{ action: "edit", resource: "*", effect: "allow" }] }
            edit(draft)
            agents.set(id, draft)
          },
        }),
    },
    session: {
      hook: (name: string, fn: (event: ContextEvent) => void) => hooks.set(name, fn),
      prompt: async (input: Record<string, unknown>) => {
        prompts.push(input)
      },
    },
  }
  await plugin.setup(ctx as never)
  return { skills, commands, agents, prompts, hooks }
}

describe("opencode plugin", () => {
  test("adds every pstack skill folder as a skill with its path and body", async () => {
    const { skills } = await load()
    expect(skills.map((s) => s.id).sort()).toEqual(skillIds)
    for (const skill of skills) {
      const path = join(skillsDir, skill.id, "SKILL.md")
      expect(skill.path).toBe(path)
      expect(skill.content).toBe(frontmatter(path).body)
    }
  })

  test("offers a skill to the model exactly when it lacks disable-model-invocation: true", async () => {
    const { skills } = await load()
    const autoinvoke = Object.fromEntries(skills.map((s) => [s.id, s.autoinvoke]))
    const want = Object.fromEntries(
      skillIds.map((id) => [id, frontmatter(join(skillsDir, id, "SKILL.md")).meta["disable-model-invocation"] !== true]),
    )
    expect(autoinvoke).toEqual(want)
    expect(Object.values(want)).toContain(true)
    expect(Object.values(want)).toContain(false)
  })

  test("adds a pstack:<id> command per skill that loads the skill with the user's text", async () => {
    const { commands, prompts } = await load()
    expect(commands.map((c) => c.name).sort()).toEqual(skillIds.map((id) => `pstack:${id}`))
    const how = commands.find((c) => c.name === "pstack:how")!
    await how.execute({ sessionID: "ses_1", prompt: { text: "is this cache safe?" }, delivery: "steer" })
    expect(prompts).toEqual([
      { sessionID: "ses_1", delivery: "steer", text: "Load and execute the `how` skill.\n\nis this cache safe?" },
    ])
  })

  test("makes comment-sicko and poteto-agent subagents that cannot ask or spawn", async () => {
    const { agents } = await load()
    expect([...agents.keys()].sort()).toEqual(["comment-sicko", "poteto-agent"])
    for (const [id, draft] of agents) {
      expect(draft.mode).toBe("subagent")
      expect(draft.description).toBe(frontmatter(join(root, "pstack/agents", `${id}.md`)).meta.description as string)
      expect(draft.permissions).toContainEqual({ action: "edit", resource: "*", effect: "allow" })
      expect(draft.permissions).toContainEqual({ action: "question", resource: "*", effect: "deny" })
      expect(draft.permissions).toContainEqual({ action: "subagent", resource: "*", effect: "deny" })
    }
  })

  test("the context hook adds the adapter line to every request and the agent body only for a pstack agent", async () => {
    const { hooks } = await load()
    const context = hooks.get("context")!
    const adapter = { type: "text", text: `pstack skills use Cursor names. Before you follow a pstack skill, read ${adapterPath} once per session.` }

    const build: ContextEvent = { agent: "build", system: [{ type: "text", text: "base" }] }
    context(build)
    expect(build.system).toEqual([{ type: "text", text: "base" }, adapter])

    const sicko: ContextEvent = { agent: "comment-sicko", system: [] }
    context(sicko)
    expect(sicko.system).toHaveLength(2)
    expect(sicko.system).toContainEqual(adapter)
    expect(sicko.system).toContainEqual({ type: "text", text: frontmatter(join(root, "pstack/agents/comment-sicko.md")).body })
  })
})
