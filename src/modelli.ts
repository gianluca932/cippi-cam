import { HumanMessage } from "@langchain/core/messages";
import { dimensioniEmbeddingDb } from "./db.js";
import { configLlm, modelloEmbedding, modelloVisione, unaVolta } from "./llm.js";
import { z } from "zod";
import { AnalisiFoto, type EventoUccellino } from "./schema.js";
import { COLORI, nomeDaColore } from "./uccellini.js";

// Le due chiamate ai modelli della pipeline delle foto: visione (foto → JSON) ed embedding (testo → vettore).
// Quale modello e quale provider (Ollama, Bedrock) lo decide src/llm.ts in base all'ambiente.

/** Il modello di visione salvato nel database accanto a ogni foto, per sapere chi l'ha classificata. */
export const VISION_MODEL = `${configLlm.provider}:${configLlm.visione}`;

// Il prompt della visione: invariato, così le misure restano confrontabili.
const prompt = `Nella gabbia vivono ${COLORI.length} pappagallini (budgerigar), uno per colore: ${COLORI.join(", ")}.
Guarda con attenzione tutta la gabbia, anche dietro posatoi, sbarre e giocattoli. Rispondi SOLO con JSON.
Scrivi in italiano, frasi brevi e CONCRETE: nomina oggetti, colori e parti della gabbia, niente aggettivi generici.
- scena: max 15 parole sulla scena generale
- gabbia: lo stato della gabbia
  - note: max 12 parole su abbeveratoio, mangiatoia e fondo (es. "abbeveratoio a destra mezzo pieno, fondo con semi sparsi")
  - acqua: "ok" se ce n'è abbastanza, "da_rifornire" se sta finendo o è finita, "non_visibile"
  - cibo: "ok" se ce n'è abbastanza, "da_rifornire" se sta finendo o è finito, "non_visibile"
  Se non riesci a capire un livello (contenitore coperto o opaco), usa non_visibile: non tirare a indovinare.
- uccellini: SEMPRE ${COLORI.length} elementi, uno per colore (${COLORI.join(", ")}). Per ognuno, in quest'ordine:
  - colore: il colore del pappagallino che stai descrivendo
  - posizione: max 6 parole (es. "posatoio alto, lato destro")
  - postura: max 8 parole, soprattutto dove sono testa e becco (es. "testa girata, becco tra le piume dell'ala")
  - con_cosa: l'oggetto che tocca con becco o zampe (es. "campanellino", "pallina gialla", "mangiatoia", "abbeveratoio", "specchio", "posatoio"); "niente" se non tocca nulla
  - oggetti_vicini: fino a 3 oggetti vicini a lui
  - descrizione: max 15 parole, cosa fa e con cosa (es. "becca il campanellino giallo appeso al soffitto")
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

export type TempiVisione = {
  secondiLettura?: number; // il modello "legge" foto e prompt (solo Ollama lo riporta)
  secondiRisposta?: number; // il modello genera la risposta (solo Ollama lo riporta)
  tokenRisposta?: number; // token generati: il dato che conta di più per la velocità
};

/** Risposta che non rispetta lo schema: chi chiama decide cosa farne (saltare la foto, riprovare…). */
export class RispostaNonValida extends Error {
  constructor(public raw: string, public issues: unknown) {
    super("Risposta del modello non valida per lo schema");
  }
}

/** Foto → analisi validata con Zod. Su Ollama chiamata nativa, sugli altri provider LangChain (vedi sotto il perché). */
export async function classifyImage(imageBase64: string): Promise<{ analisi: AnalisiFoto; tempi: TempiVisione }> {
  return configLlm.provider === "ollama" ? classificaConOllama(imageBase64) : classificaConLangChain(imageBase64);
}

// ⚠️ Perché su Ollama NON usiamo LangChain per la visione (misurato il 2026-10-14)
// @langchain/ollama (1.3.0) trasforma un messaggio "testo + immagine" in DUE messaggi Ollama separati
// (convertHumanGenericMessagesToOllama). Per il modello è un input diverso, e il risultato peggiora:
// sulle stesse 32 etichette, 15 giuste con un messaggio solo contro 8 con due messaggi.
// Quindi su Ollama mandiamo noi la richiesta, con testo e immagine nello stesso messaggio.
async function classificaConOllama(imageBase64: string) {
  const res = await fetch(`${configLlm.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: configLlm.visione,
      stream: false,
      think: false, // niente ragionamento: per classificare è solo più lento
      format: z.toJSONSchema(AnalisiFoto), // la grammatica: il modello può scrivere solo JSON valido per lo schema
      messages: [{ role: "user", content: prompt, images: [imageBase64] }], // UN messaggio: testo + immagine
      options: { temperature: 0, num_ctx: 8192 },
    }),
  });
  if (!res.ok) throw new Error(`Ollama ha risposto ${res.status}: ${await res.text()}`);
  const dati = (await res.json()) as {
    message: { content: string };
    prompt_eval_duration?: number; // nanosecondi
    eval_duration?: number;
    eval_count?: number;
  };

  const controllo = AnalisiFoto.safeParse(JSON.parse(dati.message.content));
  if (!controllo.success) throw new RispostaNonValida(dati.message.content, controllo.error.issues);
  const secondi = (ns?: number) => (ns ? ns / 1e9 : undefined);
  return {
    analisi: controllo.data,
    tempi: {
      secondiLettura: secondi(dati.prompt_eval_duration),
      secondiRisposta: secondi(dati.eval_duration),
      tokenRisposta: dati.eval_count,
    },
  };
}

// 📘 LangChain — output strutturato (usato per Bedrock e gli altri provider)
// .withStructuredOutput(schemaZod) fa le stesse due cose della funzione sopra:
//   1. passa lo schema al modello (su Bedrock come un tool da chiamare obbligatoriamente);
//   2. legge la risposta e la valida con Zod.
// includeRaw: true restituisce anche il messaggio grezzo, per token e testo nei log.
async function classificaConLangChain(imageBase64: string) {
  const modello = await unaVolta("visione", modelloVisione);
  const strutturato = modello.withStructuredOutput(AnalisiFoto, { name: "analisi_foto", includeRaw: true });

  const { raw, parsed } = await strutturato.invoke([
    new HumanMessage({
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: `data:image/jpeg;base64,${imageBase64}` },
      ],
    }),
  ]);

  const testo = typeof raw.content === "string" ? raw.content : JSON.stringify(raw.content);
  // Ricontrollo esplicito con il nostro schema: comprende anche il .refine() (un evento per colore).
  const controllo = AnalisiFoto.safeParse(parsed);
  if (!controllo.success) throw new RispostaNonValida(testo, controllo.error.issues);

  const usage = (raw as { usage_metadata?: { output_tokens?: number } }).usage_metadata;
  return { analisi: controllo.data, tempi: { tokenRisposta: usage?.output_tokens } };
}

// --- Embedding ---

// Alcuni modelli di embedding vogliono un prefisso diverso per i documenti e per le domande.
const PREFISSI: Record<string, { documento: string; domanda: string }> = {
  "nomic-embed-text": { documento: "search_document: ", domanda: "search_query: " },
  "qwen3-embedding:0.6b": {
    documento: "",
    domanda: "Instruct: Given a question about two pet budgies, retrieve the diary entries that answer it\nQuery: ",
  },
};

// 📘 LangChain — embedding
// Tutti i modelli di embedding hanno due metodi: embedDocuments (testi da salvare) ed embedQuery (una domanda).
export async function embed(
  testi: string[],
  tipo: "documento" | "domanda",
  nomeModello = configLlm.embedding!,
): Promise<number[][]> {
  const modello = await unaVolta(`embedding:${nomeModello}`, () => modelloEmbedding(nomeModello));
  const prefisso = PREFISSI[nomeModello]?.[tipo] ?? "";
  const conPrefisso = testi.map((t) => prefisso + t);
  return tipo === "documento"
    ? modello.embedDocuments(conPrefisso)
    : Promise.all(conPrefisso.map((t) => modello.embedQuery(t)));
}

/**
 * Controlla che il modello di embedding configurato produca vettori della stessa dimensione
 * della colonna nel database. Se no, cambiare modello richiede una migrazione: meglio fermarsi
 * subito con un messaggio chiaro che salvare vettori incompatibili (o fallire a metà import).
 */
export async function controllaEmbedding() {
  const [vettore] = await embed(["prova"], "documento");
  const nelDb = await dimensioniEmbeddingDb();
  if (nelDb !== null && vettore.length !== nelDb) {
    throw new Error(
      `Il modello di embedding ${configLlm.provider}:${configLlm.embedding} produce vettori da ${vettore.length} dimensioni, ` +
        `ma la colonna eventi.embedding_testo ne ha ${nelDb}. Serve una migrazione (nuova colonna o tabella) e il ricalcolo dei vettori.`,
    );
  }
}

// Il testo che finisce nell'embedding: tutto quello che il modello ha visto di quell'uccellino.
export function textForEmbedding(e: EventoUccellino, scena: string): string {
  return [
    `${nomeDaColore(e.colore)}, pappagallino ${e.colore}. Azione: ${e.azione.replace("_", " ")}.`,
    e.descrizione,
    `Posizione: ${e.posizione}.`,
    e.con_cosa && e.con_cosa !== "niente" ? `Interagisce con: ${e.con_cosa}.` : "",
    e.oggetti_vicini.length ? `Oggetti vicini: ${e.oggetti_vicini.join(", ")}.` : "",
    `Postura: ${e.postura}.`,
    `Scena: ${scena}`,
  ].filter(Boolean).join(" ");
}
