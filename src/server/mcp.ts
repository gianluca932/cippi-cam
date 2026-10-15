import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import { STRUMENTI } from "../agente/strumenti.js";
import pkg from "../../package.json" with { type: "json" };

// Il diario come server MCP (Model Context Protocol): gli stessi cinque tool della chat.
// Qui si crea il server; il trasporto lo sceglie chi lo usa:
//   - stdio (src/comandi/mcp.ts): Claude Desktop o Claude Code lo avviano come processo sul Mac;
//   - HTTP (route /api/mcp/:token in app.ts): un MCP remoto, per i connettori di claude.ai.
//
// 📘 MCP in breve
//   Il server non ragiona: dichiara i tool (tools/list) e li esegue quando il client li chiama (tools/call).
//   Quale tool usare lo decide il modello del client, leggendo nome e descrizione.
//
// I tool sono quelli di LangChain in strumenti.ts: hanno già name, description e schema Zod,
// quindi si registrano in un ciclo. Una modifica a un tool vale per la chat e per MCP.

// Ogni tool di LangChain ha un tipo diverso (i suoi argomenti): per registrarli in un ciclo basta
// quello che hanno in comune. Gli argomenti li valida comunque lo schema, sia qui (SDK) sia in invoke.
type Strumento = { name: string; description: string; schema: z.ZodObject; invoke(argomenti: unknown): Promise<unknown> };
const testo = (text: string) => ({ content: [{ type: "text" as const, text }] });

export function creaServerMcp() {
  const server = new McpServer({ name: "cippi-cam", version: pkg.version });
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
  return server;
}

export const NUMERO_STRUMENTI = STRUMENTI.length;
