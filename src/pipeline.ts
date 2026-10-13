import { readFileSync, statSync } from "node:fs";
import exifr from "exifr";
import { classifyImage, embed, textForEmbedding } from "./ollama.js";
import { AnalisiFoto, LIVELLI_ALLARME, MIN_CONFIDENCE } from "./schema.js";
import { nomeDaColore } from "./uccellini.js";

// Il cuore condiviso da classify e importa: foto → visione → Zod → embedding.

const sec = (ns: number) => (ns / 1e9).toFixed(1) + "s";

export class RispostaNonValida extends Error {
  constructor(public raw: string, public issues: unknown) {
    super("Risposta del modello non valida per lo schema");
  }
}

export async function analizza(jpgPath: string) {
  // 1. Gli occhi: il modello di visione guarda la foto.
  const start = performance.now();
  const { raw, timing } = await classifyImage(readFileSync(jpgPath).toString("base64"));
  console.log(`⏱️ Visione: ${((performance.now() - start) / 1000).toFixed(1)}s`
    + ` (foto ${sec(timing.prompt_eval_duration)}, risposta ${sec(timing.eval_duration)}, ${timing.eval_count} token)`);

  // Primo guardrail: lo schema Zod.
  const parsed = AnalisiFoto.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new RispostaNonValida(raw, parsed.error.issues);
  const analisi = parsed.data;

  // 2. Un embedding per uccellino, per la ricerca semantica.
  const embeddings = await embed(analisi.uccellini.map((u) => textForEmbedding(u, analisi.scena)), "documento");
  return { analisi, embeddings };
}

export function stampa(analisi: AnalisiFoto) {
  console.log(`📷 ${analisi.scena}`);
  const { acqua, cibo, note } = analisi.gabbia;
  console.log(`🏠 acqua: ${acqua} · cibo: ${cibo} — ${note}`);
  if (LIVELLI_ALLARME.includes(acqua)) console.warn(`🚨 Acqua ${acqua}: va controllata!`);
  if (LIVELLI_ALLARME.includes(cibo)) console.warn(`🚨 Cibo ${cibo}: va controllato!`);

  for (const u of analisi.uccellini) {
    // Secondo guardrail: la soglia di confidenza. L'evento si salva comunque,
    // ma chi legge il diario (galleria, agente) ignora quelli incerti.
    const flag = u.confidenza < MIN_CONFIDENCE ? "⚠️ incerto" : "✅";
    console.log(`${flag} ${nomeDaColore(u.colore)} (${u.colore}): ${u.azione} (${u.confidenza}) — ${u.descrizione}`);
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
