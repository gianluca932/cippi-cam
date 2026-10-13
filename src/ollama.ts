import { z } from "zod";
import { AnalisiFoto, type EventoUccellino } from "./schema.js";
import { COLORI, nomeDaColore } from "./uccellini.js";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
export const VISION_MODEL = process.env.VISION_MODEL ?? "qwen3.5:9b";
export const EMBED_MODEL = process.env.EMBED_MODEL ?? "nomic-embed-text";
// Lo stesso modello della visione: con 16 GB di RAM evita di caricarne due a turno.
// (qwen3:4b ha il ragionamento sempre acceso: ~600 token per scegliere un tool.)
export const AGENT_MODEL = process.env.AGENT_MODEL ?? "qwen3.5:9b";

const prompt = `Nella gabbia vivono ${COLORI.length} pappagallini (budgerigar), uno per colore: ${COLORI.join(", ")}.
Guarda con attenzione tutta la gabbia, anche dietro posatoi, sbarre e giocattoli. Rispondi SOLO con JSON.
- scena: una frase breve in italiano sulla scena generale
- gabbia: lo stato della gabbia
  - note: cosa vedi di abbeveratoio e mangiatoia (dove sono, quanto sono pieni)
  - acqua: livello dell'acqua, uno tra abbondante, sufficiente, scarso, vuoto, non_visibile
  - cibo: livello del cibo, uno tra abbondante, sufficiente, scarso, vuoto, non_visibile
  Se non riesci a capire il livello (contenitore coperto o opaco), usa non_visibile: non tirare a indovinare.
- uccellini: SEMPRE ${COLORI.length} elementi, uno per colore (${COLORI.join(", ")}). Per ognuno, in quest'ordine:
  - colore: il colore del pappagallino che stai descrivendo
  - posizione: dove si trova nella gabbia (es. "sul posatoio in alto a destra")
  - postura: com'è il corpo, e soprattutto dove sono testa e becco (piume, ali, occhi)
  - oggetti_vicini: lista degli oggetti visibili vicino a lui (es. ["mangiatoia", "pallina"])
  - descrizione: una frase breve in italiano su cosa sta facendo
  - azione: una tra mangia, beve, dorme, si_pulisce, gioca, vola, riposa, non_visibile
  - confidenza: numero tra 0 e 1 (quanto sei sicuro dell'azione; abbassala se è coperto o sfocato)
Come riconoscere le azioni in una foto ferma (guarda soprattutto DOVE è la testa e il becco):
  - mangia: testa abbassata dentro o sopra la mangiatoia, o becco su semi, miglio, verdura
  - beve: becco sull'abbeveratoio o sulla ciotola dell'acqua
  - si_pulisce: testa girata verso la schiena, il petto o un'ala, becco tra le piume; spesso piume un po' sollevate
  - dorme: occhi chiusi, testa affondata nelle piume o girata all'indietro, corpo gonfio e immobile
  - gioca: becco o zampe su un giocattolo (palline, campanelli, specchio, corde)
  - vola: ali aperte e nessun appoggio
  - riposa: fermo su un posatoio, testa dritta, occhi aperti, becco libero. Usalo SOLO se nessun'altra azione è plausibile.
Prima di scegliere, controlla se la testa è vicino a mangiatoia, abbeveratoio, piume o giocattoli.
Usa "non_visibile" solo se non riesci a vederne nessuna parte; se è parzialmente coperto, descrivi cosa fa e abbassa la confidenza.`;

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${OLLAMA_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Ollama ha risposto ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

type ChatResponse = {
  message: { content: string };
  // Tempi restituiti da Ollama, in nanosecondi.
  load_duration: number;
  prompt_eval_duration: number;
  prompt_eval_count: number;
  eval_duration: number;
  eval_count: number;
};

export async function classifyImage(imageBase64: string) {
  const data = await post<ChatResponse>("/api/chat", {
    model: VISION_MODEL,
    stream: false,
    think: false, // niente ragionamento: per classificare è solo più lento
    format: z.toJSONSchema(AnalisiFoto), // Ollama forza l'output a questo schema
    messages: [{ role: "user", content: prompt, images: [imageBase64] }],
    options: { temperature: 0, num_ctx: 8192 }, // la foto da sola occupa ~4000 token
  });
  return { raw: data.message.content, timing: data };
}

// --- Chat con tool (l'agente) ---

export type ToolCall = { function: { name: string; arguments: Record<string, unknown> } };

export type Messaggio =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_name: string; content: string };

export type DefinizioneTool = {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
};

// pensa = ragionamento acceso: il modello sceglie i tool in modo più affidabile, ma è 2-3 volte più lento.
export async function chatConTool(messages: Messaggio[], tools: DefinizioneTool[], pensa = false) {
  const data = await post<{ message: { content: string; tool_calls?: ToolCall[] } } & ChatResponse>("/api/chat", {
    model: AGENT_MODEL,
    stream: false,
    think: pensa,
    messages,
    tools,
    options: { temperature: 0, num_ctx: 8192 },
  });
  if (process.env.DEBUG_AGENTE) {
    console.log(`   [${AGENT_MODEL}${pensa ? " +ragionamento" : ""}] prompt ${data.prompt_eval_count} token in ${(data.prompt_eval_duration / 1e9).toFixed(1)}s,`
      + ` risposta ${data.eval_count} token in ${(data.eval_duration / 1e9).toFixed(1)}s`);
  }
  return data.message;
}

// Ogni modello di embedding vuole i suoi prefissi per i documenti e per le domande.
const PREFISSI: Record<string, { documento: string; domanda: string }> = {
  "nomic-embed-text": { documento: "search_document: ", domanda: "search_query: " },
  "qwen3-embedding:0.6b": {
    documento: "",
    domanda: "Instruct: Given a question about two pet budgies, retrieve the diary entries that answer it\nQuery: ",
  },
  "bge-m3": { documento: "", domanda: "" },
};

export async function embed(
  texts: string[],
  kind: "documento" | "domanda",
  model = EMBED_MODEL,
): Promise<number[][]> {
  const prefix = PREFISSI[model]?.[kind] ?? "";
  const data = await post<{ embeddings: number[][] }>("/api/embed", {
    model,
    input: texts.map((t) => prefix + t),
  });
  return data.embeddings;
}

// Il testo che finisce nell'embedding: tutto quello che il modello ha visto di quell'uccellino.
export function textForEmbedding(e: EventoUccellino, scena: string): string {
  return [
    `${nomeDaColore(e.colore)}, pappagallino ${e.colore}. Azione: ${e.azione.replace("_", " ")}.`,
    e.descrizione,
    `Posizione: ${e.posizione}.`,
    e.oggetti_vicini.length ? `Oggetti vicini: ${e.oggetti_vicini.join(", ")}.` : "",
    `Postura: ${e.postura}.`,
    `Scena: ${scena}`,
  ].filter(Boolean).join(" ");
}
