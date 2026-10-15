import "./mcp-avvio.js"; // per primo: log su stderr e cartella di lavoro nella radice del progetto
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { creaServerMcp, NUMERO_STRUMENTI } from "../server/mcp.js";
import { chiudi } from "../db/db.js";

// Il server MCP su stdio (il server vero e proprio, con i tool, è in src/server/mcp.ts).
// Il client avvia questo processo e gli parla con JSON-RPC su stdin/stdout: per questo i log vanno su stderr.
//
// Uso:  npx tsx src/comandi/mcp.ts                         (database locale, Ollama per cerca_momenti)
//       DB_PROVIDER=rds LLM_PROVIDER=bedrock … npx tsx …   (il diario su AWS)
// Non con "npm run": npm stampa l'intestazione dello script su stdout e rompe il protocollo.

await creaServerMcp().connect(new StdioServerTransport());
console.error(`cippi-cam MCP: ${NUMERO_STRUMENTI} tool su stdio`);

// Il client chiude stdin quando ha finito: si chiude anche il pool del database.
process.stdin.on("close", () => void chiudi().finally(() => process.exit(0))); // void: l'evento non aspetta la Promise
