import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
export const adapterPath = resolve(packageRoot, "docs/harness/pi.md")

// Pi's counterpart of the Claude Code SessionStart hook: pstack/ stays upstream bytes, so the adapter pointer rides in the system prompt.
export default function pstackPiExtension(pi: any) {
  pi.on("before_agent_start", async (event: { systemPrompt: string }) => ({
    systemPrompt: `${event.systemPrompt}\n\npstack skills use Cursor names. Before you follow a pstack skill, read ${adapterPath} once per session.\n`,
  }))
}
