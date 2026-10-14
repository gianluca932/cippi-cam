// Carica le variabili d'ambiente da .env (se c'è) prima che gli altri moduli le leggano.
// Va importato per primo da chi legge process.env all'avvio (llm.ts, db.ts, server.ts):
// con gli ES module, un modulo importato viene eseguito prima di chi lo importa.
//
// Le variabili già impostate nella shell vincono su quelle del file (es. LLM_PROVIDER=bedrock npm run valuta).
// Il file .env non va in git: si parte da .env.example.

try {
  process.loadEnvFile(".env"); // disponibile in Node ≥ 20.12, senza librerie
} catch {
  // Niente .env: si usano i valori di default (tutto in locale con Ollama).
}
