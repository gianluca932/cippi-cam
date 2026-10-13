import { readFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";
import type { ChatApi } from "./api-types.js";
import { cercaSimili, elencoGiorni, elencoUccellini, fotoDelGiorno, percorsoFoto } from "./db.js";
import { embed } from "./ollama.js";
import { MIN_CONFIDENCE } from "./schema.js";

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

// Per ora la chat è una ricerca semantica sul diario; diventerà l'agente con i tool.
const ChatRequest = z.object({ domanda: z.string().trim().min(1).max(500) });

const formatOra = (d: Date) =>
  d.toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

app.post("/chat", async (c) => {
  const body = ChatRequest.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ errore: "Serve { domanda: string }" }, 400);

  const [vettore] = await embed([body.data.domanda], "domanda");
  const risultati = await cercaSimili(vettore, 3);

  const righe = risultati.map((r) => {
    const incerto = r.confidenza < MIN_CONFIDENCE ? " (incerto)" : "";
    return `• ${formatOra(r.ora)} · ${r.uccellino}, ${r.azione.replace("_", " ")}${incerto}: ${r.descrizione}`;
  });
  const risposta: ChatApi = {
    risposta: risultati.length
      ? `Ecco i momenti del diario più vicini alla tua domanda:\n${righe.join("\n")}`
      : "Il diario è ancora vuoto.",
    fonti: risultati.map((r) => ({
      foto_id: r.foto_id,
      ora: r.ora.toISOString(),
      uccellino: r.uccellino,
      similarita: Number(r.similarita.toFixed(3)),
    })),
  };
  return c.json(risposta);
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ errore: err.message }, 500);
});

serve({ fetch: app.fetch, port: PORT }, () => console.log(`🐦 API su http://localhost:${PORT}/api`));
