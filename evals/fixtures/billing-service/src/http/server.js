import { createServer } from "node:http";
import { buildInvoice } from "../invoices/build.js";
import { memoryStore } from "../store/memory.js";

const store = memoryStore();

export const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/invoices") return res.writeHead(404).end();
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    const invoice = buildInvoice(JSON.parse(body), { store });
    res.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify(invoice));
  } catch (error) {
    res.writeHead(422, { "content-type": "application/json" }).end(JSON.stringify({ error: error.message, problems: error.problems ?? [] }));
  }
});

if (process.argv[1] === new URL(import.meta.url).pathname) server.listen(process.env.PORT ?? 3000);
