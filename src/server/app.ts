import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { basicAuth } from "hono/basic-auth";
import { HTTPException } from "hono/http-exception";
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
import { embed, textForEmbedding } from "../modelli/modelli.js";
import { AZIONI, LIVELLI, type Azione } from "../modelli/schema.js";
import { creaServerMcp } from "./mcp.js";

// Le route comuni al server locale (index.ts) e alla Lambda su AWS (src/aws/api.ts):
// diario, correzioni e chat. Cambiano solo da dove arrivano le foto e se serve una password.

export type OpzioniApp = {
  /** I byte di una foto del diario dal suo percorso (data/foto/X.jpg): dal disco in locale, da S3 su AWS. */
  leggiFoto: (percorso: string) => Promise<Uint8Array | null>;
  /** Se c'è, tutta l'API chiede utente e password (Basic Auth): online ogni domanda costa chiamate a Bedrock. */
  password?: string;
  /** Se c'è, il server MCP risponde su /api/mcp/<token> (MCP remoto, per i connettori di claude.ai). */
  mcpToken?: string;
};

export function creaApp({ leggiFoto, password, mcpToken }: OpzioniApp) {
  const app = new Hono().basePath("/api");
  // Il middleware va registrato prima delle route. Basic Auth la gestisce il browser da solo
  // (finestra di login, poi l'header su ogni richiesta, anche quelle in streaming).
  // /mcp/ fa eccezione: i connettori MCP non mandano la Basic Auth, lì vale il token nell'URL.
  if (password) {
    const auth = basicAuth({ username: "cippi", password, realm: "Cippi Cam" });
    app.use("*", (c, next) => (c.req.path.startsWith("/api/mcp/") ? next() : auth(c, next)));
  }

  // MCP remoto (Streamable HTTP), con gli stessi tool del server su stdio (src/server/mcp.ts).
  // Stateless: su Lambda ogni richiesta può finire su un'istanza diversa, quindi niente sessioni,
  // e server e trasporto si creano a ogni richiesta (costa pochi millisecondi: i tool sono già caricati).
  // Il "link unico" è la protezione: chi ha l'URL può leggere il diario (i tool non scrivono).
  // Token sbagliato → 404, come se la route non esistesse; il confronto è in tempo costante.
  app.all("/mcp/:token", async (c) => {
    const token = Buffer.from(c.req.param("token"));
    const atteso = Buffer.from(mcpToken ?? "");
    if (!mcpToken || token.length !== atteso.length || !timingSafeEqual(token, atteso)) return c.notFound();
    // Stateless: niente stream SSE in GET né sessioni da chiudere con DELETE. Senza questo 405 il trasporto
    // teneva aperto il GET fino al timeout della Lambda, e i client (claude.ai) restavano ad aspettare.
    if (c.req.method !== "POST") return c.body(null, 405, { Allow: "POST" });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true, // una risposta JSON invece di uno stream SSE: i tool rispondono in un colpo solo
    });
    await creaServerMcp().connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  app.get("/uccellini", async (c) => c.json(await elencoUccellini()));

  app.get("/giorni", async (c) => c.json(await elencoGiorni()));

  app.get("/foto", async (c) => {
    const giorno = c.req.query("giorno") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(giorno)) return c.json({ errore: "giorno deve essere YYYY-MM-DD" }, 400);
    return c.json(await fotoDelGiorno(giorno));
  });

  app.get("/foto/:id/immagine", async (c) => {
    const id = Number(c.req.param("id"));
    const percorso = Number.isInteger(id) ? await percorsoFoto(id) : undefined;
    const dati = percorso ? await leggiFoto(percorso) : null;
    if (!dati) return c.notFound();
    c.header("Content-Type", "image/jpeg");
    c.header("Cache-Control", "public, max-age=86400");
    return c.body(dati as Uint8Array<ArrayBuffer>); // Buffer e i byte di S3 hanno sempre un ArrayBuffer sotto
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

  // Gli errori "attesi" di Hono (401 della Basic Auth, …) hanno già la loro risposta: si restituisce quella.
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    return c.json({ errore: err.message }, 500);
  });

  return app;
}
