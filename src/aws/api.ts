import "../comune/env.js"; // per primo: carica .env prima che gli altri moduli leggano process.env
import { streamHandle } from "hono/aws-lambda";
import { z } from "zod";
import { creaApp } from "../server/app.js";
import { scaricaFoto } from "../foto/s3.js";

// L'API su AWS: le stesse route del server locale (app.ts), dentro una Lambda con Function URL.
// streamHandle usa il "response streaming" di Lambda: la chat in SSE arriva parola per parola
// anche online, invece di aspettare la risposta intera.
// La pagina Live qui non c'è: la webcam è attaccata al Mac.

const env = z
  .object({
    API_PASSWORD: z.string().min(12, "API_PASSWORD deve avere almeno 12 caratteri"),
    MCP_TOKEN: z.string().min(32, "MCP_TOKEN deve avere almeno 32 caratteri").optional(),
  })
  .parse(process.env);

const app = creaApp({
  leggiFoto: async (percorso) => (await scaricaFoto(percorso))?.dati ?? null,
  password: env.API_PASSWORD,
  mcpToken: env.MCP_TOKEN,
});

export const handler = streamHandle(app);
