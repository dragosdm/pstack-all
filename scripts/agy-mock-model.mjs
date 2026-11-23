#!/usr/bin/env node
// A scripted Gemini endpoint for scripts/check-agy.sh. No network, no billing.
// With a type name, the parent's first turn spawns that agent through invoke_subagent; each child answers at once.
// agy renders an agent's H1 as a tag in the child's systemInstruction, so children are found by the heading text.
import { appendFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const [portFile, logFile, spawnType] = process.argv.slice(2);
let spawned = false;

function reply(body) {
  const system = JSON.stringify(body.systemInstruction ?? "");
  if (system.includes("Poteto subagent") || system.includes("Comment Sicko")) return { text: "CHILD-DONE" };
  if (spawnType && !spawned) {
    spawned = true;
    return { functionCall: { name: "invoke_subagent", args: { TypeName: spawnType, Role: "Check Delegate", Prompt: "Reply CHILD-DONE." } } };
  }
  return { text: "MOCK-OK" };
}

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (data) => (raw += data));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    const part = reply(body);
    if (logFile) appendFileSync(logFile, `${JSON.stringify({ url: req.url, request: body, reply: part })}\n`);
    const chunk = {
      candidates: [{ content: { role: "model", parts: [part] }, finishReason: "STOP", index: 0 }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    };
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`data: ${JSON.stringify(chunk)}\n\n`);
  });
});
server.listen(0, "127.0.0.1", () => writeFileSync(portFile, String(server.address().port)));
