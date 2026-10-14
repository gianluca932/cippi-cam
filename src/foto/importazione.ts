import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, parse } from "node:path";
import { fotoEsiste, salvaAnalisi, salvaEmbeddingImmagine } from "../db/db.js";
import { embeddingImmagine } from "../modelli/immagini.js";
import { VISION_MODEL } from "../modelli/modelli.js";
import { analizza, oraScatto, RispostaNonValida, stampa, type AvvisoFase } from "./pipeline.js";
import type { AnalisiFoto } from "../modelli/schema.js";

// Importa UNA foto nel diario: converte in JPG da 1024px (data/foto/), analizza, salva.
// Usato da `npm run importa` (tante foto) e dalla registrazione della pagina Live (una per scatto).

export const CONVERTITE = "data/foto";
const LATO_MAX = "1024"; // meno pixel = meno token per il modello di visione

export type EsitoImport =
  | { esito: "importata"; fotoId: number; ora: Date; analisi: AnalisiFoto }
  | { esito: "presente" } // già nel diario
  | { esito: "scartata"; motivo: unknown }; // il modello ha risposto fuori schema: si riprova al prossimo giro

/**
 * log: stampa titolo e analisi in modo semplice (la usa chi non ha una sua grafica).
 * onFase: riceve inizio e fine di ogni fase, per chi vuole mostrare l'avanzamento (npm run importa).
 */
export async function importaFoto(
  originale: string,
  { log = true, onFase }: { log?: boolean; onFase?: AvvisoFase } = {},
): Promise<EsitoImport> {
  const jpg = join(CONVERTITE, `${parse(originale).name}.jpg`);
  if (await fotoEsiste(jpg)) return { esito: "presente" };

  if (log) console.log(`\n===== ${originale}`);
  mkdirSync(CONVERTITE, { recursive: true });
  onFase?.("conversione", "inizio");
  if (!existsSync(jpg)) {
    // sips è incluso in macOS: converte HEIC e ridimensiona.
    execFileSync("sips", ["-s", "format", "jpeg", "-Z", LATO_MAX, originale, "--out", jpg], { stdio: "ignore" });
  }
  onFase?.("conversione", "fine", `JPG ${LATO_MAX}px`);

  try {
    const { analisi, embeddings } = await analizza(jpg, onFase);
    if (log) stampa(analisi);
    const ora = await oraScatto(originale);
    onFase?.("salvataggio", "inizio");
    const fotoId = await salvaAnalisi(analisi, jpg, ora, VISION_MODEL, embeddings);
    onFase?.("salvataggio", "fine", `foto #${fotoId}`);
    onFase?.("impronta", "inizio");
    const ok = await salvaImpronta(fotoId, jpg);
    onFase?.("impronta", "fine", ok ? "512 numeri" : "non calcolata");
    return { esito: "importata", fotoId, ora, analisi };
  } catch (err) {
    if (!(err instanceof RispostaNonValida)) throw err;
    return { esito: "scartata", motivo: err.issues };
  }
}

// L'impronta CLIP della foto (ricerca per immagini). ~30 ms: non rallenta l'import.
// Se fallisce (es. provider senza CLIP) la foto resta comunque nel diario: l'impronta si può
// calcolare dopo con `npm run embedding-immagini`.
async function salvaImpronta(fotoId: number, jpg: string): Promise<boolean> {
  try {
    await salvaEmbeddingImmagine(fotoId, await embeddingImmagine(jpg));
    return true;
  } catch (err) {
    console.warn(`⚠️  Impronta CLIP non calcolata per ${jpg}: ${(err as Error).message}`);
    return false;
  }
}
