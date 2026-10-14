import { readFileSync, statSync } from "node:fs";
import exifr from "exifr";
import { classifyGabbia, classifyImage, embed, textForEmbedding } from "../modelli/modelli.js";
import { LIVELLI_ALLARME, MIN_CONFIDENCE, type AnalisiFoto, type AnalisiGabbia } from "../modelli/schema.js";
import { c } from "../comune/terminale.js";
import { nomeDaColore } from "../comune/uccellini.js";

// Il cuore condiviso da classify e importa: foto → visione → Zod → embedding.

export { RispostaNonValida } from "../modelli/modelli.js";

const sec = (s?: number) => (s === undefined ? "?" : `${s.toFixed(1)}s`);

/** Le fasi di lavoro su una foto, per chi vuole mostrarle (es. npm run importa). */
export type Fase = "conversione" | "visione" | "embedding" | "salvataggio" | "impronta" | "gabbia";
export type AvvisoFase = (fase: Fase, stato: "inizio" | "fine", dettaglio?: string) => void;

// --- Grafica nel terminale (importa e classify) ---

export const NOMI_FASI: Record<Fase, string> = {
  conversione: "conversione",
  visione: "modello di visione",
  embedding: "embedding del testo",
  salvataggio: "salvataggio nel diario",
  impronta: "impronta CLIP",
  gabbia: "controllo della gabbia",
};

export const percentuale = (x: number) => `${Math.round(x * 100)}%`;
const livello = (l: string) => l.replaceAll("_", " ");

/** Il riassunto di una foto analizzata, in una riga. */
export function riassunto(analisi: AnalisiFoto, gabbia: AnalisiGabbia | null): string {
  const uccellini = analisi.uccellini
    .map((u) => {
      const testo = `${nomeDaColore(u.colore)}: ${u.azione.replace("_", " ")} ${percentuale(u.confidenza)}`;
      return u.confidenza < MIN_CONFIDENCE ? c.giallo(`${testo} (incerto)`) : testo;
    })
    .join(" · ");
  // La gabbia non si controlla a ogni foto (vedi serveControlloGabbia in importazione.ts).
  if (!gabbia) return `   🐦 ${uccellini}   ${c.grigio("gabbia non controllata")}`;
  const allarme = (l: string) => (LIVELLI_ALLARME.includes(l as never) ? c.rosso(livello(l)) : livello(l));
  return `   🐦 ${uccellini}   ${c.grigio("💧")} ${allarme(gabbia.acqua)} ${c.grigio("· 🌾")} ${allarme(gabbia.cibo)}`;
}

export async function analizza(jpgPath: string, onFase?: AvvisoFase) {
  // 1. Gli occhi: il modello di visione guarda la foto. La risposta arriva già validata con Zod
  //    (se non rispetta lo schema, classifyImage lancia RispostaNonValida).
  const start = performance.now();
  onFase?.("visione", "inizio");
  const { analisi, tempi } = await classifyImage(readFileSync(jpgPath).toString("base64"));
  onFase?.("visione", "fine", `${tempi.tokenRisposta ?? "?"} token`);
  if (!onFase) {
    console.log(`⏱️ Visione: ${((performance.now() - start) / 1000).toFixed(1)}s`
      + ` (foto ${sec(tempi.secondiLettura)}, risposta ${sec(tempi.secondiRisposta)}, ${tempi.tokenRisposta ?? "?"} token)`);
  }

  // 2. Un embedding per uccellino, per la ricerca semantica.
  onFase?.("embedding", "inizio");
  const embeddings = await embed(analisi.uccellini.map((u) => textForEmbedding(u, analisi.scena)), "documento");
  onFase?.("embedding", "fine", `${embeddings.length} × ${embeddings[0]?.length ?? 0}`);
  return { analisi, embeddings };
}

/** Il controllo della gabbia (acqua e cibo): un'analisi a parte, con il suo prompt. */
export async function analizzaGabbia(jpgPath: string, onFase?: AvvisoFase): Promise<AnalisiGabbia> {
  onFase?.("gabbia", "inizio");
  const { analisi, tempi } = await classifyGabbia(readFileSync(jpgPath).toString("base64"));
  onFase?.("gabbia", "fine", `${tempi.tokenRisposta ?? "?"} token`);
  return analisi;
}

export function stampaGabbia(gabbia: AnalisiGabbia) {
  const { acqua, cibo, note } = gabbia;
  console.log(`🏠 acqua: ${acqua} · cibo: ${cibo} — ${note}`);
  if (LIVELLI_ALLARME.includes(acqua)) console.warn(`🚨 Acqua ${acqua}: va controllata!`);
  if (LIVELLI_ALLARME.includes(cibo)) console.warn(`🚨 Cibo ${cibo}: va controllato!`);
}

export function stampa(analisi: AnalisiFoto) {
  console.log(`📷 ${analisi.scena}`);

  for (const u of analisi.uccellini) {
    // Secondo guardrail: la soglia di confidenza. L'evento si salva comunque,
    // ma chi legge il diario (galleria, agente) ignora quelli incerti.
    const flag = u.confidenza < MIN_CONFIDENCE ? "⚠️ incerto" : "✅";
    const conCosa = u.con_cosa !== "niente" ? ` [con: ${u.con_cosa}]` : "";
    console.log(`${flag} ${nomeDaColore(u.colore)} (${u.colore}): ${u.azione}${conCosa} (${u.confidenza}) — ${u.descrizione}`);
  }
}

// Quando è stata scattata: dai metadati EXIF, altrimenti dalla data del file.
export async function oraScatto(path: string): Promise<Date> {
  try {
    const exif = await exifr.parse(path, ["DateTimeOriginal"]);
    if (exif?.DateTimeOriginal instanceof Date) return exif.DateTimeOriginal;
  } catch {
    // niente EXIF leggibile: si usa la data del file
  }
  return statSync(path).birthtime;
}
