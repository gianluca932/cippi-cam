// Prepara il processo del server MCP su stdio. Va importato per primo da mcp.ts:
// con gli ES module viene eseguito prima dei moduli importati dopo di lui (env.js, db.ts…).

// 1. stdout è il canale del protocollo: una sola riga di log lì romperebbe i messaggi JSON-RPC.
console.log = console.error;
console.info = console.error;
console.debug = console.error;

// 2. Il client (Claude Desktop, Claude Code…) avvia il server da una cartella qualsiasi,
//    ma .env e config/ si leggono dalla cartella di lavoro: si parte dalla radice del progetto.
process.chdir(new URL("../..", import.meta.url).pathname);
