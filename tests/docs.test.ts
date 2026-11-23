import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, test } from "bun:test"

const root = resolve(import.meta.dir, "..")
const skillsDir = join(root, "pstack/skills")
const agentsDir = join(root, "pstack/agents")

function frontmatter(file: string): Record<string, unknown> {
  const yaml = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(file, "utf8"))![1]
  return Bun.YAML.parse(yaml) as Record<string, unknown>
}

const skillFiles = readdirSync(skillsDir)
  .map((name) => join(skillsDir, name, "SKILL.md"))
  .filter((file) => existsSync(file))

const measured = {
  skills: skillFiles.length,
  hidden: skillFiles.filter((file) => frontmatter(file)["disable-model-invocation"] === true).length,
  agents: readdirSync(agentsDir).filter((name) => name.endsWith(".md")).length,
}

type Expect = "skip" | "skills" | "hidden" | "agents"
type Mention = { file: string; line: number; count: number; noun: string; text: string; clause: string; tail: string }
type Rule = { name: string; test: (mention: Mention) => boolean; expect: Expect; why: string }

const rules: Rule[] = [
  {
    name: "scoped-to-commit",
    test: (m) => /\b[Aa]t `[0-9a-f]{7,40}`/.test(m.clause),
    expect: "skip",
    why: "a count at a named upstream commit is history that pstack/ cannot measure",
  },
  {
    name: "hidden",
    // A digit before the flag means it belongs to a later count, as in "Of the 58 pstack skills, 57 set `disable-model-invocation: true`".
    test: (m) => m.noun !== "agents" && /^[^\d]*disable-model-invocation/.test(m.tail),
    expect: "hidden",
    why: "the skills whose frontmatter sets disable-model-invocation: true",
  },
  {
    name: "zero-agents display",
    test: (m) => m.text === "0 agents",
    expect: "skip",
    why: "`claude plugin details` displays Agents (0) for this plugin (docs/specs/claude-code.md)",
  },
  { name: "agents", test: (m) => m.noun === "agents", expect: "agents", why: "pstack/agents/*.md" },
  { name: "skills", test: (m) => m.noun !== "agents", expect: "skills", why: "pstack/skills/*/SKILL.md" },
]

// A zero counts only before "agents": "loads 0 skills" in docs/specs/grok-cli.md is a failure case, not a pstack count.
const mentionPattern =
  /(?<![\w.])([1-9]\d{0,2}|0(?= agents\b))(?![\d.]\d)(?: of ([1-9]\d{0,2})(?![\d.]\d))?(?:\s+[^\s\d.,;|]+){0,2}?\s+(skills|commands|agents)\b/g

function scannedFiles(): string[] {
  const paths = ["README.md", "AGENTS.md", "docs", "evals/README.md", ".claude/skills/verify-pstack-all"]
  const run = spawnSync("git", ["ls-files", "-z", "--", ...paths], { cwd: root, encoding: "utf8" })
  return run.stdout
    .split("\0")
    .filter((file) => file.endsWith(".md") && !file.startsWith("pstack/"))
}

function mentions(file: string): Mention[] {
  const found: Mention[] = []
  readFileSync(join(root, file), "utf8")
    .split("\n")
    .forEach((text, index) => {
      for (const match of text.matchAll(mentionPattern)) {
        const start = match.index!
        const end = start + match[0].length
        const before = text.slice(0, start).split(/\. |;|\|/).at(-1)!
        const after = text.slice(end).split(/\. |;|\|/)[0]
        found.push({
          file,
          line: index + 1,
          count: Number(match[2] ?? match[1]),
          noun: match[3],
          text: match[0],
          clause: before + match[0] + after,
          tail: after,
        })
      }
    })
  return found
}

const classified = scannedFiles()
  .flatMap(mentions)
  .map((mention) => ({ mention, rule: rules.find((rule) => rule.test(mention)) }))

describe("docs counts", () => {
  test("pstack/ has skills, hidden skills and agents to count", () => {
    expect(measured.skills).toBeGreaterThan(0)
    expect(measured.hidden).toBeGreaterThan(0)
    expect(measured.agents).toBeGreaterThan(0)
  })

  test("the docs state skill, hidden-skill and agent counts", () => {
    const kinds = new Set(classified.map(({ rule }) => rule?.expect))
    expect([...kinds].filter((kind) => kind !== "skip" && kind).sort()).toEqual(["agents", "hidden", "skills"])
  })

  test("every skill, command and agent count in the docs matches pstack/", () => {
    const bad = classified.flatMap(({ mention: m, rule }) => {
      const where = `${m.file}:${m.line} says ${m.count} ${m.noun}`
      if (!rule) return [`${where}, matches no rule`]
      if (rule.expect === "skip" || measured[rule.expect] === m.count) return []
      return [`${where}, pstack/ has ${measured[rule.expect]} (${rule.name})`]
    })
    expect(bad.join("\n")).toBe("")
  })
})
