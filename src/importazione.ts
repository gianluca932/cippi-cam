import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, parse } from "node:path";
import { fotoEsiste, salvaAnalisi } from "./db.js";
import { VISION_MODEL } from "./ollama.js";
import { analizza, oraScatto, RispostaNonValida, stampa } from "./pipeline.js";

// Importa UNA foto nel diario: converte in JPG da 1024px (data/foto/), analizza, salva.
// Usato da `npm run importa` (tante foto) e dalla registrazione della pagina Live (una per scatto).

export const CONVERTITE = "data/foto";
const LATO_MAX = "1024"; // meno pixel = meno token per il modello di visione

export type EsitoImport =
  | { esito: "importata"; fotoId: number; ora: Date }
  | { esito: "presente" } // già nel diario
  | { esito: "scartata"; motivo: unknown }; // il modello ha risposto fuori schema: si riprova al prossimo giro

export async function importaFoto(originale: string, { log = true } = {}): Promise<EsitoImport> {
  const jpg = join(CONVERTITE, `${parse(originale).name}.jpg`);
  if (await fotoEsiste(jpg)) return { esito: "presente" };

  if (log) console.log(`\n===== ${originale}`);
  mkdirSync(CONVERTITE, { recursive: true });
  if (!existsSync(jpg)) {
    // sips è incluso in macOS: converte HEIC e ridimensiona.
    execFileSync("sips", ["-s", "format", "jpeg", "-Z", LATO_MAX, originale, "--out", jpg], { stdio: "ignore" });
  }

  try {
    const { analisi, embeddings } = await analizza(jpg);
    if (log) stampa(analisi);
    const ora = await oraScatto(originale);
    const fotoId = await salvaAnalisi(analisi, jpg, ora, VISION_MODEL, embeddings);
    return { esito: "importata", fotoId, ora };
  } catch (err) {
    if (!(err instanceof RispostaNonValida)) throw err;
    return { esito: "scartata", motivo: err.issues };
  }
}
