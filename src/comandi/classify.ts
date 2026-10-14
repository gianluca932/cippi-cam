import { parse } from "node:path";
import { chiudi, salvaAnalisi, salvaControlloGabbia, sincronizzaUccellini } from "../db/db.js";
import { VISION_MODEL } from "../modelli/modelli.js";
import { configLlm } from "../modelli/llm.js";
import { analizza, analizzaGabbia, NOMI_FASI, oraScatto, riassunto, RispostaNonValida, type AvvisoFase } from "../foto/pipeline.js";
import { c, Spinner } from "../comune/terminale.js";
import { nomeDaColore } from "../comune/uccellini.js";

// Classifica una singola foto (già in JPG). Per importare tutta la cartella photos/ usa npm run importa.
// Stessa grafica di importa: una riga per fase, poi il riassunto e i dettagli.
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run"); // analizza senza salvare nel database
const imagePath = args.find((a) => !a.startsWith("--"));
if (!imagePath) {
  console.error("Uso: npm run classify -- data/foto/IMG_0719.jpg [--dry-run]");
  process.exit(1);
}

const spinner = new Spinner();
const onFase: AvvisoFase = (fase, stato, dettaglio) =>
  stato === "inizio" ? spinner.avvia(NOMI_FASI[fase]) : spinner.ferma(true, dettaglio);

try {
  console.log(
    `\n🔍 ${c.grassetto("Classify")} · ${parse(imagePath).name}` +
      c.grigio(` · ${configLlm.provider}: visione ${configLlm.visione}${dryRun ? " · --dry-run, niente salvataggio" : ""}\n`),
  );

  const { analisi, embeddings } = await analizza(imagePath, onFase);
  // Una foto sola: la gabbia si controlla sempre (il timer vale solo per importa e per il Live).
  const gabbia = await analizzaGabbia(imagePath, onFase);

  console.log(riassunto(analisi, gabbia));
  console.log(c.grigio(`   📷 ${analisi.scena}`));
  for (const u of analisi.uccellini) {
    const conCosa = u.con_cosa !== "niente" ? ` [con: ${u.con_cosa}]` : "";
    console.log(c.grigio(`   ${nomeDaColore(u.colore)}: ${u.descrizione}${conCosa} — ${u.postura}`));
  }
  console.log(c.grigio(`   🏠 ${gabbia.note}`));

  if (!dryRun) {
    await sincronizzaUccellini();
    const fotoId = await salvaAnalisi(analisi, imagePath, await oraScatto(imagePath), VISION_MODEL, embeddings);
    await salvaControlloGabbia(fotoId, gabbia);
    console.log(c.grigio(`   💾 foto #${fotoId} salvata con ${analisi.uccellini.length} eventi e il controllo della gabbia`));
  }
  console.log();
} catch (err) {
  if (!(err instanceof RispostaNonValida)) throw err;
  spinner.ferma(false, "risposta fuori schema");
  console.error("Risposta grezza:", err.raw);
  console.error("❌ Risposta scartata (schema non valido):", err.issues);
  process.exitCode = 1;
} finally {
  await chiudi();
}
