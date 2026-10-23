import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const adapterPath = join(root, "docs/harness/opencode.md")
const adapterLine = `pstack skills use Cursor names. Before you follow a pstack skill, read ${adapterPath} once per session.`
// The same two denies opencode gives its built-in general agent: pstack delegates never ask the user or spawn.
const delegateDenies = [
  { action: "question", resource: "*", effect: "deny" },
  { action: "subagent", resource: "*", effect: "deny" },
]

// Bun.YAML, because pstack frontmatter has escaped double quotes and folded blocks that a line parser mangles.
function parse(path) {
  const text = readFileSync(path, "utf8")
  const block = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)
  return { meta: Bun.YAML.parse(block[1]), body: text.slice(block[0].length) }
}

const skillsDir = join(root, "pstack/skills")
const skills = readdirSync(skillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const path = join(skillsDir, entry.name, "SKILL.md")
    const { meta, body } = parse(path)
    return {
      id: entry.name,
      name: meta.name,
      description: meta.description,
      path,
      content: body,
      // opencode's own skill loader maps disable-model-invocation: true the same way.
      autoinvoke: meta["disable-model-invocation"] !== true,
      command: meta["user-invocable"] !== false,
    }
  })

const agentsDir = join(root, "pstack/agents")
const agents = readdirSync(agentsDir)
  .filter((name) => name.endsWith(".md"))
  .map((name) => {
    const { meta, body } = parse(join(agentsDir, name))
    return { id: meta.name, description: meta.description, body }
  })

async function setup(ctx) {
  await ctx.skill.transform((editor) => {
    for (const { command, ...skill } of skills) editor.add(skill)
  })
  await ctx.command.transform((editor) => {
    for (const skill of skills.filter((s) => s.command)) {
      editor.add({
        name: `pstack:${skill.id}`,
        description: skill.description,
        execute: async ({ sessionID, prompt, delivery }) => {
          await ctx.session.prompt({ ...prompt, sessionID, text: `Load and execute the \`${skill.id}\` skill.\n\n${prompt.text}`, delivery })
        },
      })
    }
  })
  // Setting system would replace opencode's base prompt, so the context hook appends the agent body instead.
  await ctx.agent.transform((editor) => {
    for (const agent of agents) {
      editor.update(agent.id, (draft) => {
        draft.description = agent.description
        draft.mode = "subagent"
        draft.permissions.push(...delegateDenies)
      })
    }
  })
  // opencode's counterpart of the Claude Code SessionStart hook: pstack/ stays upstream bytes, so the adapter pointer
  // goes in the system prompt.
  ctx.session.hook("context", (event) => {
    const agent = agents.find((a) => a.id === event.agent)
    if (agent) event.system.push({ type: "text", text: agent.body })
    event.system.push({ type: "text", text: adapterLine })
  })
}

export default { id: "pstack", setup }
