import { readFileSync, statSync } from "node:fs";
import exifr from "exifr";
import { classifyImage, embed, textForEmbedding } from "./modelli.js";
import { LIVELLI_ALLARME, MIN_CONFIDENCE, type AnalisiFoto } from "./schema.js";
import { nomeDaColore } from "./uccellini.js";

// Il cuore condiviso da classify e importa: foto → visione → Zod → embedding.

export { RispostaNonValida } from "./modelli.js";

const sec = (s?: number) => (s === undefined ? "?" : `${s.toFixed(1)}s`);

export async function analizza(jpgPath: string) {
  // 1. Gli occhi: il modello di visione guarda la foto. La risposta arriva già validata con Zod
  //    (se non rispetta lo schema, classifyImage lancia RispostaNonValida).
  const start = performance.now();
  const { analisi, tempi } = await classifyImage(readFileSync(jpgPath).toString("base64"));
  console.log(`⏱️ Visione: ${((performance.now() - start) / 1000).toFixed(1)}s`
    + ` (foto ${sec(tempi.secondiLettura)}, risposta ${sec(tempi.secondiRisposta)}, ${tempi.tokenRisposta ?? "?"} token)`);

  // 2. Un embedding per uccellino, per la ricerca semantica.
  const embeddings = await embed(analisi.uccellini.map((u) => textForEmbedding(u, analisi.scena)), "documento");
  return { analisi, embeddings };
}

export function stampa(analisi: AnalisiFoto) {
  console.log(`📷 ${analisi.scena}`);
  const { acqua, cibo, pulizia, note } = analisi.gabbia;
  console.log(`🏠 acqua: ${acqua} · cibo: ${cibo} · pulizia: ${pulizia} — ${note}`);
  if (LIVELLI_ALLARME.includes(acqua)) console.warn(`🚨 Acqua ${acqua}: va controllata!`);
  if (LIVELLI_ALLARME.includes(cibo)) console.warn(`🚨 Cibo ${cibo}: va controllato!`);

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
