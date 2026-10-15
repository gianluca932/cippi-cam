import "./mcp-avvio.js"; // per primo: log su stderr e cartella di lavoro nella radice del progetto
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { STRUMENTI } from "../agente/strumenti.js";
import { chiudi } from "../db/db.js";
import pkg from "../../package.json" with { type: "json" };
import type { z } from "zod";

// Il diario come server MCP (Model Context Protocol): gli stessi cinque tool della chat,
// usabili da qualunque client MCP (Claude Desktop, Claude Code, MCP Inspector…).
//
// 📘 MCP in breve
//   - Il server non ragiona: dichiara i tool (tools/list) e li esegue quando il client li chiama (tools/call).
//     Quale tool usare lo decide il modello del client, leggendo nome e descrizione.
//   - Trasporto stdio: il client avvia questo processo e gli parla con JSON-RPC su stdin/stdout.
//     Per questo i log vanno su stderr (vedi mcp-avvio.ts).
//
// I tool sono quelli di LangChain in strumenti.ts: hanno già name, description e schema Zod,
// quindi qui si registrano in un ciclo. Una modifica a un tool vale per la chat e per MCP.
//
// Uso:  npx tsx src/comandi/mcp.ts                         (database locale, Ollama per cerca_momenti)
//       DB_PROVIDER=rds LLM_PROVIDER=bedrock … npx tsx …   (il diario su AWS)
// Non con "npm run": npm stampa l'intestazione dello script su stdout e rompe il protocollo.

const server = new McpServer({ name: "cippi-cam", version: pkg.version });

// Ogni tool di LangChain ha un tipo diverso (i suoi argomenti): per registrarli in un ciclo basta
// quello che hanno in comune. Gli argomenti li valida comunque lo schema, sia qui (SDK) sia in invoke.
type Strumento = { name: string; description: string; schema: z.ZodObject; invoke(argomenti: unknown): Promise<unknown> };
const testo = (text: string) => ({ content: [{ type: "text" as const, text }] });

for (const strumento of STRUMENTI as unknown as Strumento[]) {
  server.registerTool(
    strumento.name,
    {
      description: strumento.description,
      inputSchema: strumento.schema,
      annotations: { readOnlyHint: true }, // nessun tool scrive: il client può chiamarli senza chiedere conferma
    },
    async (argomenti) => {
      try {
        // invoke valida di nuovo gli argomenti con lo schema e restituisce il JSON compatto del tool.
        return testo(String(await strumento.invoke(argomenti)));
      } catch (err) {
        // L'errore torna al modello come testo, perché possa correggersi (stessa regola della chat).
        const messaggio = err instanceof Error ? err.message : String(err);
        return { ...testo(JSON.stringify({ errore: messaggio })), isError: true };
      }
    },
  );
}

await server.connect(new StdioServerTransport());
console.error(`cippi-cam MCP ${pkg.version}: ${STRUMENTI.length} tool su stdio`);

// Il client chiude stdin quando ha finito: si chiude anche il pool del database.
process.stdin.on("close", () => void chiudi().finally(() => process.exit(0))); // void: l'evento non aspetta la Promise
