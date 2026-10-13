import { readFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";
import type { ChatApi } from "./api-types.js";
import { chiediAllAgente } from "./agente.js";
import { elencoGiorni, elencoUccellini, fotoDelGiorno, percorsoFoto } from "./db.js";

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

  const { risposta, passi } = await chiediAllAgente(body.data.domanda, body.data.storia);
  return c.json<ChatApi>({ risposta, strumenti: passi });
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ errore: err.message }, 500);
});

serve({ fetch: app.fetch, port: PORT }, () => console.log(`🐦 API su http://localhost:${PORT}/api`));
