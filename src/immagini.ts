import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  env,
  RawImage,
} from "@huggingface/transformers";
import { configLlm } from "./llm.js";

// Le "impronte" delle immagini: ogni foto diventa un vettore di 512 numeri (CLIP).
// Foto che si somigliano hanno vettori vicini, e anche una FRASE finisce nello stesso spazio:
// così si può cercare tra le foto scrivendo cosa si cerca ("two budgies near the feeder").
//
// 📘 CLIP (OpenAI, 2021) — due encoder addestrati insieme su 400 milioni di coppie immagine/didascalia:
//   immagine ──► encoder visivo ──► vettore ─┐
//                                            ├─ vicini se la frase descrive l'immagine
//   frase    ──► encoder testuale ─► vettore ─┘
// Il modello arriva da Hugging Face e gira in Node con transformers.js (ONNX, sulla CPU): niente Ollama, niente Python.
//
// ⚠️ CLIP capisce l'inglese: le ricerche vanno scritte in inglese (dalla chat ci penserà l'agente a tradurre).
// ⚠️ È bravo a dire COSA c'è nella scena, molto meno a distinguere i gesti (si pulisce / riposa).

const MODELLO = process.env.IMAGE_EMBED_MODEL ?? "Xenova/clip-vit-base-patch32";
export const DIMENSIONI_IMMAGINE = 512; // come la colonna foto.embedding_immagine

// I file del modello (~600 MB) si scaricano la prima volta in data/modelli/ (fuori da git) e poi si riusano.
env.cacheDir = "data/modelli";

// I quattro pezzi di CLIP si caricano una volta sola, al primo uso.
let caricamento: Promise<{
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
  visione: Awaited<ReturnType<typeof CLIPVisionModelWithProjection.from_pretrained>>;
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
  testo: Awaited<ReturnType<typeof CLIPTextModelWithProjection.from_pretrained>>;
}> | undefined;

function clip() {
  if (configLlm.provider !== "ollama") {
    // Su AWS l'equivalente è Titan Multimodal Embeddings (Bedrock): non ancora collegato.
    throw new Error(`Embedding delle immagini non ancora disponibile con LLM_PROVIDER=${configLlm.provider}`);
  }
  caricamento ??= (async () => {
    const [processor, visione, tokenizer, testo] = await Promise.all([
      AutoProcessor.from_pretrained(MODELLO),
      CLIPVisionModelWithProjection.from_pretrained(MODELLO),
      AutoTokenizer.from_pretrained(MODELLO),
      CLIPTextModelWithProjection.from_pretrained(MODELLO),
    ]);
    return { processor, visione, tokenizer, testo };
  })();
  return caricamento;
}

// Vettore di lunghezza 1: così la similarità coseno è un semplice prodotto scalare, e i numeri sono confrontabili.
function normalizza(v: ArrayLike<number>): number[] {
  const arr = Array.from(v);
  const norma = Math.hypot(...arr) || 1;
  return arr.map((x) => x / norma);
}

/** L'impronta di una foto (percorso di un file JPG/PNG). ~30 ms dopo il primo caricamento. */
export async function embeddingImmagine(percorso: string): Promise<number[]> {
  const { processor, visione } = await clip();
  const { image_embeds } = await visione(await processor(await RawImage.read(percorso)));
  return normalizza(image_embeds.data as Float32Array);
}

/** L'impronta di una frase, nello stesso spazio delle foto. In inglese. */
export async function embeddingTestoPerImmagini(frase: string): Promise<number[]> {
  const { tokenizer, testo } = await clip();
  const { text_embeds } = await testo(tokenizer([frase], { padding: true, truncation: true }));
  return normalizza(text_embeds.data as Float32Array);
}
