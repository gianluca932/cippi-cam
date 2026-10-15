import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { parseArgs } from "node:util";
import { c } from "../comune/terminale.js";

// Un client MCP minimo, per vedere il server dal lato di chi lo usa (come fanno Claude Desktop o Claude Code):
// avvia src/comandi/mcp.ts, chiede la lista dei tool (tools/list) e ne chiama uno (tools/call).
// Qui gli argomenti li scriviamo noi; in un client vero li sceglie il modello.
//
// Uso: npm run mcp:prova -- [giorno]              stdio: avvia il server (default 2026-10-14; eredita l'ambiente, es. DB_PROVIDER=rds)
//      npm run mcp:prova -- --url URL [giorno]    HTTP: l'MCP remoto (terraform output -raw mcp_url)

const { values, positionals } = parseArgs({ options: { url: { type: "string" } }, allowPositionals: true });
const giorno = positionals[0] ?? "2026-10-14";

const transport = values.url
  ? new StreamableHTTPClientTransport(new URL(values.url))
  : new StdioClientTransport({
      command: process.execPath, // lo stesso node che sta girando
      args: ["--import", "tsx", "src/comandi/mcp.ts"],
      env: process.env as Record<string, string>,
      stderr: "inherit", // i log del server (su stderr) si vedono qui
    });
const client = new Client({ name: "cippi-cam-prova", version: "1.0.0" });

try {
  await client.connect(transport); // initialize: client e server si presentano

  const { tools } = await client.listTools();
  console.log(c.grigio(`\ntools/list → ${tools.length} tool`));
  for (const t of tools) {
    const argomenti = Object.keys((t.inputSchema.properties as Record<string, unknown> | undefined) ?? {});
    console.log(`  ${c.verde(t.name)}(${argomenti.join(", ")})`);
  }

  for (const [name, args] of [
    ["conta_eventi", { giorno, uccellino: "Cippi" }],
    ["stato_gabbia", { giorno }],
  ] as const) {
    const risultato = await client.callTool({ name, arguments: args });
    console.log(c.grigio(`\ntools/call ${name} ${JSON.stringify(args)}`));
    for (const parte of risultato.content as { type: string; text?: string }[]) console.log(parte.text ?? `[${parte.type}]`);
  }
} finally {
  await client.close();
}
