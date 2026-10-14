import "../comune/env.js"; // per primo: carica .env prima che gli altri moduli leggano process.env
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";
import { streamSSE } from "hono/streaming";
import type { ChatApi, EventoChat } from "../comune/api-types.js";
import { chiediAllAgente } from "../agente/index.js";
import {
  correggiEvento,
  correggiGabbia,
  elencoGiorni,
  elencoUccellini,
  eventiPerEmbedding,
  fotoDelGiorno,
  percorsoFoto,
  salvaEmbedding,
} from "../db/db.js";
import { configLlm } from "../modelli/llm.js";
import { controllaEmbedding, embed, textForEmbedding } from "../modelli/modelli.js";
import { avviaRegistrazione, fermaRegistrazione, statoRegistrazione } from "./registrazione.js";
import { CARTELLA_SCATTI, nomeValido, ultimiScatti } from "./scatti.js";
import { AZIONI, LIVELLI, type Azione } from "../modelli/schema.js";

const PORT = Number(process.env.PORT ?? 3001);
const app = new Hono().basePath("/api");

app.get("/uccellini", async (c) => c.json(await elencoUccellini()));

app.get("/giorni", async (c) => c.json(await elencoGiorni()));

app.get("/foto", async (c) => {
  const giorno = c.req.query("giorno") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(giorno)) return c.json({ errore: "giorno deve essere YYYY-MM-DD" }, 400);
  return c.json(await fotoDelGiorno(giorno));
});

app.get("/foto/:id/immagine", async (c) => {
  const percorso = await percorsoFoto(Number(c.req.param("id")));
  if (!percorso) return c.notFound();
  c.header("Content-Type", "image/jpeg");
  c.header("Cache-Control", "public, max-age=86400");
  return c.body(await readFile(percorso));
});

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

// Correzioni dalla galleria. La previsione del modello resta: la correzione si salva accanto,
// e l'embedding si ricalcola perché il suo testo contiene l'azione.
async function aggiornaEvento(id: number, azione: Azione | null) {
  if (!(await correggiEvento(id, azione))) return false;
  const [evento] = await eventiPerEmbedding(id);
  const [embedding] = await embed([textForEmbedding(evento, evento.scena)], "documento");
  await salvaEmbedding(id, embedding);
  return true;
}

const Correzione = z.object({ azione: z.enum(AZIONI) });

// Corregge o conferma acqua e cibo di una foto. Solo i campi passati; null = annulla la correzione.
const CorrezioneGabbia = z
  .object({
    acqua: z.enum(LIVELLI).nullable().optional(),
    cibo: z.enum(LIVELLI).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Serve almeno uno tra acqua e cibo" });

app.patch("/foto/:id/gabbia", async (c) => {
  const id = Number(c.req.param("id"));
  const body = CorrezioneGabbia.safeParse(await c.req.json().catch(() => null));
  if (!Number.isInteger(id) || !body.success) {
    return c.json({ errore: `Serve { acqua?, cibo?: ${LIVELLI.join(" | ")} | null }` }, 400);
  }
  if (!(await correggiGabbia(id, body.data))) return c.notFound();
  return c.json({ ok: true });
});

// Corregge o conferma (stessa azione del modello) l'azione di un evento.
app.patch("/eventi/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = Correzione.safeParse(await c.req.json().catch(() => null));
  if (!Number.isInteger(id) || !body.success) return c.json({ errore: `Serve { azione: ${AZIONI.join(" | ")} }` }, 400);
  if (!(await aggiornaEvento(id, body.data.azione))) return c.notFound();
  return c.json({ ok: true });
});

// Annulla la correzione: torna valida la previsione del modello.
app.delete("/eventi/:id/correzione", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || !(await aggiornaEvento(id, null))) return c.notFound();
  return c.json({ ok: true });
});

// La chat: l'agente sceglie i tool (SQL o ricerca semantica) e risponde.
const ChatRequest = z.object({
  domanda: z.string().trim().min(1).max(500),
  // Gli ultimi scambi, così l'agente capisce domande di seguito come "e Sky?".
  storia: z
    .array(z.object({ ruolo: z.enum(["utente", "assistente"]), testo: z.string().max(4000) }))
    .max(10)
    .default([]),
});

app.post("/chat", async (c) => {
  const body = ChatRequest.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ errore: "Serve { domanda: string, storia?: [...] }" }, 400);

  return c.json<ChatApi>(await chiediAllAgente(body.data.domanda, body.data.storia));
});

// La stessa chat in streaming (Server-Sent Events): ogni passo dell'agente arriva appena succede.
app.post("/chat/stream", async (c) => {
  const body = ChatRequest.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ errore: "Serve { domanda: string, storia?: [...] }" }, 400);

  return streamSSE(c, async (stream) => {
    // Gli eventi si accodano: ogni writeSSE parte quando il precedente è stato scritto.
    let coda = Promise.resolve();
    const invia = (e: EventoChat) => {
      coda = coda.then(() => stream.writeSSE({ data: JSON.stringify(e) }));
    };
    try {
      await chiediAllAgente(body.data.domanda, body.data.storia, invia);
    } catch (err) {
      console.error(err);
      invia({ tipo: "errore", messaggio: (err as Error).message });
    }
    await coda;
  });
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ errore: err.message }, 500);
});

// All'avvio: quale provider stiamo usando, e se gli embedding sono compatibili con il database.
console.log(`🧠 Modelli: ${configLlm.provider} · visione ${configLlm.visione} · agente ${configLlm.agente} · embedding ${configLlm.embedding}`);
controllaEmbedding().catch((err: Error) => console.error(`⚠️  ${err.message}`));

serve({ fetch: app.fetch, port: PORT }, () => console.log(`🐦 API su http://localhost:${PORT}/api`));
