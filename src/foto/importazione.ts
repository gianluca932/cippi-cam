import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, parse } from "node:path";
import { fotoEsiste, salvaAnalisi, salvaControlloGabbia, salvaEmbeddingImmagine, ultimoControlloGabbia } from "../db/db.js";
import { embeddingImmagine } from "../modelli/immagini.js";
import { VISION_MODEL } from "../modelli/modelli.js";
import { analizza, analizzaGabbia, oraScatto, RispostaNonValida, stampa, stampaGabbia, type AvvisoFase } from "./pipeline.js";
import type { AnalisiFoto, AnalisiGabbia } from "../modelli/schema.js";

// Importa UNA foto nel diario: converte in JPG da 1024px (data/foto/), analizza, salva.
// Usato da `npm run importa` (tante foto) e dalla registrazione della pagina Live (una per scatto).

export const CONVERTITE = "data/foto";
const LATO_MAX = "1024"; // meno pixel = meno token per il modello di visione

export type EsitoImport =
  | { esito: "importata"; fotoId: number; ora: Date; analisi: AnalisiFoto; gabbia: AnalisiGabbia | null } // gabbia: null se non controllata
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

    // La gabbia (acqua e cibo) solo se serve: i livelli non cambiano in un minuto.
    let gabbia: AnalisiGabbia | null = null;
    if (await serveControlloGabbia(ora)) {
      try {
        gabbia = await analizzaGabbia(jpg, onFase);
        await salvaControlloGabbia(fotoId, gabbia);
        if (log) stampaGabbia(gabbia);
      } catch (err) {
        // Un controllo fuori schema non butta via la foto: si riprova alla foto successiva.
        if (!(err instanceof RispostaNonValida)) throw err;
        console.warn(`⚠️  Controllo della gabbia scartato (risposta fuori schema): si riprova alla prossima foto.`);
      }
    }
    return { esito: "importata", fotoId, ora, analisi, gabbia };
  } catch (err) {
    if (!(err instanceof RispostaNonValida)) throw err;
    return { esito: "scartata", motivo: err.issues };
  }
}

// --- Quando controllare la gabbia ---
// Ogni GABBIA_OGNI_MIN minuti (default 20). Se l'ultimo controllo diceva "da_rifornire", si ricontrolla
// dopo GABBIA_RICONTROLLO_MIN (default 5): così un avviso parte solo se il problema è confermato.
// Il tempo è quello dello SCATTO, non dell'import: funziona anche importando foto vecchie, in ordine.
const OGNI_MIN = Number(process.env.GABBIA_OGNI_MIN ?? 20);
const RICONTROLLO_MIN = Number(process.env.GABBIA_RICONTROLLO_MIN ?? 5);

async function serveControlloGabbia(ora: Date): Promise<boolean> {
  const ultimo = await ultimoControlloGabbia(ora);
  if (!ultimo) return true; // mai controllata: si controlla subito
  const minuti = (ora.getTime() - ultimo.ora.getTime()) / 60_000;
  const daConfermare = ultimo.acqua === "da_rifornire" || ultimo.cibo === "da_rifornire";
  return minuti >= (daConfermare ? RICONTROLLO_MIN : OGNI_MIN);
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
