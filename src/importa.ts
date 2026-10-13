import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { extname, join, parse } from "node:path";
import { chiudi, fotoEsiste, salvaAnalisi, sincronizzaUccellini } from "./db.js";
import { VISION_MODEL } from "./ollama.js";
import { analizza, oraScatto, RispostaNonValida, stampa } from "./pipeline.js";

// Importa tutte le foto nuove di photos/:
// converte in JPG da 1024px (data/foto/), legge l'ora di scatto, classifica e salva.
// Le foto già nel database vengono saltate, quindi si può rilanciare quando si vuole.

const ORIGINALI = "photos";
const CONVERTITE = "data/foto";
const ESTENSIONI = [".heic", ".jpg", ".jpeg", ".png"];
const LATO_MAX = "1024"; // meno pixel = meno token per il modello di visione

mkdirSync(CONVERTITE, { recursive: true });

// Una foto per nome: se esistono IMG_1.HEIC e IMG_1.jpg, vince l'originale HEIC.
const perNome = new Map<string, string>();
for (const file of readdirSync(ORIGINALI).sort()) {
  const ext = extname(file).toLowerCase();
  if (!ESTENSIONI.includes(ext)) continue;
  const { name } = parse(file);
  if (!perNome.has(name) || ext === ".heic") perNome.set(name, join(ORIGINALI, file));
}

let importate = 0, saltate = 0, scartate = 0;
try {
  await sincronizzaUccellini();

  for (const [nome, originale] of perNome) {
    const jpg = join(CONVERTITE, `${nome}.jpg`);
    if (await fotoEsiste(jpg)) {
      saltate++;
      continue;
    }

    console.log(`\n===== ${originale}`);
    if (!existsSync(jpg)) {
      // sips è incluso in macOS: converte HEIC e ridimensiona.
      execFileSync("sips", ["-s", "format", "jpeg", "-Z", LATO_MAX, originale, "--out", jpg], { stdio: "ignore" });
    }

    try {
      const { analisi, embeddings } = await analizza(jpg);
      stampa(analisi);
      const ora = await oraScatto(originale);
      const fotoId = await salvaAnalisi(analisi, jpg, ora, VISION_MODEL, embeddings);
      console.log(`💾 Foto #${fotoId} (${ora.toLocaleString("it-IT")})`);
      importate++;
    } catch (err) {
      // Una risposta non valida non ferma l'import: la foto resta da riprovare al prossimo giro.
      if (!(err instanceof RispostaNonValida)) throw err;
      console.error("❌ Risposta scartata (schema non valido):", err.issues);
      scartate++;
    }
  }

  console.log(`\nFatto: ${importate} importate, ${saltate} già presenti, ${scartate} scartate.`);
} finally {
  await chiudi();
}
