import { readFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";
import { streamSSE } from "hono/streaming";
import type { ChatApi, EventoChat } from "./api-types.js";
import { chiediAllAgente } from "./agente.js";
import {
  correggiEvento,
  elencoGiorni,
  elencoUccellini,
  eventiPerEmbedding,
  fotoDelGiorno,
  percorsoFoto,
  salvaEmbedding,
} from "./db.js";
import { embed, textForEmbedding } from "./ollama.js";
import { AZIONI, type Azione } from "./schema.js";

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

serve({ fetch: app.fetch, port: PORT }, () => console.log(`🐦 API su http://localhost:${PORT}/api`));
