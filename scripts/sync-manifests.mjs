#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = JSON.parse(readFileSync(join(ROOT, "pstack/plugin.json"), "utf8"));
// Codex reads a root plugin.json with an Agent Plugins $schema ahead of .codex-plugin/plugin.json, then ignores its
// skills key and finds no skills. Grok CLI loads the same inventory without it.
const { $schema, ...meta } = base;
// Claude Code rejects a directory here and wants each agent file.
const agents = readdirSync(join(ROOT, "pstack/agents"))
  .filter((name) => name.endsWith(".md"))
  .sort()
  .map((name) => `./pstack/agents/${name}`);
// Upstream writes this line into each SKILL.md of a generated Claude tree; a hook keeps pstack/ unchanged.
const ADAPTER =
  'echo "pstack skills use Cursor names. Before you follow a pstack skill, read ${CLAUDE_PLUGIN_ROOT}/pstack/docs/harness/claude-code.md once per session."';
const catalog = {
  name: "pstack-all",
  owner: { name: "Dragos Musetescu" },
  metadata: { description: "pstack, unchanged, packaged for more harnesses" },
};

// docs/specs/<harness>.md records the verified behavior behind each row.
const HARNESSES = [
  {
    harness: "grok-cli",
    file: "plugin.json",
    render: () => ({ ...meta, skills: "./pstack/skills/", agents: "./pstack/agents/" }),
  },
  {
    // Codex plugins cannot declare agents, so poteto-agent and comment-sicko are not registered.
    harness: "codex",
    file: ".codex-plugin/plugin.json",
    render: () => ({
      ...meta,
      skills: "./pstack/skills/",
      interface: {
        displayName: base.name,
        shortDescription: base.description,
        developerName: base.author.name,
        category: "Coding",
        websiteURL: base.homepage,
        logo: "./pstack/assets/logo.png",
      },
    }),
  },
  {
    harness: "codex",
    file: ".agents/plugins/marketplace.json",
    render: () => ({
      name: catalog.name,
      interface: { displayName: catalog.name },
      plugins: [
        {
          name: base.name,
          source: { source: "local", path: "./" },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Coding",
        },
      ],
    }),
  },
  {
    harness: "cursor, grok-bot",
    file: ".cursor-plugin/marketplace.json",
    render: () => ({
      ...catalog,
      plugins: [{ name: base.name, source: "pstack", description: base.description }],
    }),
  },
  {
    harness: "claude-code",
    file: ".claude-plugin/plugin.json",
    render: () => ({
      ...base,
      skills: "./pstack/skills/",
      agents,
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: ADAPTER }] }] },
    }),
  },
  {
    harness: "claude-code",
    file: ".claude-plugin/marketplace.json",
    render: () => ({
      ...catalog,
      plugins: [{ name: base.name, source: "./", description: base.description }],
    }),
  },
  {
    // A Pi package is a package.json with a pi key; the subagent extension reads pstack/agents itself. opencode loads
    // the plugin from main. The ./tests path keeps bun out of pstack/'s own suites, which check-base.sh runs.
    harness: "pi, opencode",
    file: "package.json",
    render: () => ({
      ...meta,
      private: true,
      type: "module",
      main: "index.js",
      scripts: { test: "bun test ./tests" },
      keywords: [...meta.keywords, "pi-package"],
      pi: {
        extensions: ["./.pi/extensions/pstack.ts", "./.pi/extensions/subagent/index.ts"],
        skills: ["./pstack/skills"],
      },
    }),
  },
];

const check = process.argv.includes("--check");
let drift = 0;
for (const { harness, file, render } of HARNESSES) {
  const path = join(ROOT, file);
  const want = `${JSON.stringify(render(), null, 2)}\n`;
  const have = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  if (want === have) {
    console.log(`manifests: ok ${file} (${harness})`);
  } else if (check) {
    console.log(`manifests: DRIFT ${file} (${harness}) ${have === undefined ? "is missing" : "differs from pstack/plugin.json"}`);
    drift++;
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, want);
    console.log(`manifests: wrote ${file} (${harness})`);
  }
}
if (drift > 0) {
  console.log("manifests: FAIL run `node scripts/sync-manifests.mjs` and commit the result");
  process.exit(1);
}
