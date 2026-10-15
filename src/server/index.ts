import "../comune/env.js"; // per primo: carica .env prima che gli altri moduli leggano process.env
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { z } from "zod";
import { streamSSE } from "hono/streaming";
import { configLlm } from "../modelli/llm.js";
import { controllaEmbedding } from "../modelli/modelli.js";
import { creaApp } from "./app.js";
import { avviaRegistrazione, fermaRegistrazione, statoRegistrazione } from "./registrazione.js";
import { CARTELLA_SCATTI, nomeValido, ultimiScatti } from "./scatti.js";

// Il server locale: le route comuni (app.ts) più la pagina Live, che esiste solo qui
// perché la webcam è attaccata al Mac.

const PORT = Number(process.env.PORT ?? 3001);
const app = creaApp({ leggiFoto: (percorso) => readFile(percorso).catch(() => null) });

// --- Live: gli scatti della webcam nella cartella photos/ ---

app.get("/scatti", async (c) => c.json(await ultimiScatti()));

app.get("/scatti/:nome/immagine", async (c) => {
  const nome = c.req.param("nome");
  if (!nomeValido(nome)) return c.notFound();
  const dati = await readFile(join(CARTELLA_SCATTI, nome)).catch(() => null);
  if (!dati) return c.notFound();
  c.header("Content-Type", nome.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");
  c.header("Cache-Control", "public, max-age=3600"); // uno scatto non cambia più
  return c.body(dati);
});

// Registrazione dalla pagina Live: il server scatta e (se richiesto) analizza ogni foto.
const OpzioniRegistrazione = z.object({
  ogniSec: z.number().int().min(10).max(3600).default(60),
  durataMin: z.number().int().min(1).max(24 * 60).default(60),
  analizza: z.boolean().default(true),
  camera: z.string().min(1).max(50).default("MacBook"), // basta una parte del nome
});

app.get("/registrazione", (c) => c.json(statoRegistrazione()));

app.post("/registrazione/avvia", async (c) => {
  const body = OpzioniRegistrazione.safeParse((await c.req.json().catch(() => ({}))) ?? {});
  if (!body.success) return c.json({ errore: "Opzioni non valide", dettagli: body.error.issues }, 400);
  try {
    return c.json(await avviaRegistrazione(body.data));
  } catch (err) {
    return c.json({ errore: (err as Error).message }, 409); // es. fotocamera non trovata
  }
});

app.post("/registrazione/ferma", (c) => c.json(fermaRegistrazione()));

// Stream SSE: ogni 2 secondi ricontrolla cartella e registrazione, e manda solo quello che è cambiato
// (nuovo scatto, uno scatto appena analizzato, la coda che avanza).
app.get("/scatti/stream", (c) =>
  streamSSE(c, async (stream) => {
    let ultimo = "";
    let ultimaRegistrazione = "";
    let silenzio = 0;
    while (!stream.aborted) {
      const registrazione = JSON.stringify(statoRegistrazione());
      if (registrazione !== ultimaRegistrazione) {
        await stream.writeSSE({ event: "registrazione", data: registrazione });
        ultimaRegistrazione = registrazione;
      }
      const elenco = JSON.stringify(await ultimiScatti());
      if (elenco !== ultimo) {
        await stream.writeSSE({ event: "scatti", data: elenco });
        ultimo = elenco;
        silenzio = 0;
      } else if (++silenzio >= 10) {
        // Ogni ~20s senza novità un "ping", così proxy e browser non chiudono la connessione.
        await stream.writeSSE({ event: "ping", data: "" });
        silenzio = 0;
      }
      await stream.sleep(2000);
    }
  }),
);

// All'avvio: quale provider stiamo usando, e se gli embedding sono compatibili con il database.
console.log(`🧠 Modelli: ${configLlm.provider} · visione ${configLlm.visione} · agente ${configLlm.agente} · embedding ${configLlm.embedding}`);
controllaEmbedding().catch((err: Error) => console.error(`⚠️  ${err.message}`));

serve({ fetch: app.fetch, port: PORT }, () => console.log(`🐦 API su http://localhost:${PORT}/api`));
