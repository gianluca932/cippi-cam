import { chiudi, salvaAnalisi, sincronizzaUccellini } from "../db/db.js";
import { VISION_MODEL } from "../modelli/modelli.js";
import { analizza, oraScatto, RispostaNonValida, stampa } from "../foto/pipeline.js";

// Classifica una singola foto (già in JPG). Per importare tutta la cartella photos/ usa npm run importa.
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run"); // analizza senza salvare nel database
const imagePath = args.find((a) => !a.startsWith("--"));
if (!imagePath) {
  console.error("Uso: npm run classify -- data/foto/IMG_0719.jpg [--dry-run]");
  process.exit(1);
}

try {
  const { analisi, embeddings } = await analizza(imagePath);
  stampa(analisi);

  if (dryRun) {
    console.log("🧪 --dry-run: niente salvataggio.");
  } else {
    await sincronizzaUccellini();
    const fotoId = await salvaAnalisi(analisi, imagePath, await oraScatto(imagePath), VISION_MODEL, embeddings);
    console.log(`💾 Foto #${fotoId} salvata con ${analisi.uccellini.length} eventi.`);
  }
} catch (err) {
  if (!(err instanceof RispostaNonValida)) throw err;
  console.error("Risposta grezza:", err.raw);
  console.error("❌ Risposta scartata (schema non valido):", err.issues);
  process.exitCode = 1;
} finally {
  await chiudi();
}
