import { parseArgs } from "node:util";
import { scattaFoto, trovaFotocamera } from "../foto/webcam.js";

// Scatta una foto dalla webcam ogni N secondi e la mette in photos/.
// Poi npm run importa le classifica.
// Uso: npm run scatta -- [--ogni 20] [--durata 60] [--camera iPhone]
// Richiede imagesnap (brew install imagesnap). Fotocamere disponibili: imagesnap -l
// Lo stesso si può fare dalla pagina Live, con l'analisi subito dopo ogni scatto.

const { values } = parseArgs({
  options: {
    ogni: { type: "string", default: "20" }, // secondi tra una foto e l'altra
    durata: { type: "string", default: "60" }, // minuti
    camera: { type: "string", default: "MacBook" }, // basta una parte del nome
  },
});

const camera = await trovaFotocamera(values.camera!).catch((err: Error) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
const ogniMs = Number(values.ogni) * 1000;
const fine = Date.now() + Number(values.durata) * 60_000;

let scattate = 0;
let errori = 0;
let stop = false;
process.on("SIGINT", () => {
  stop = true;
  console.log("\n⏹️  Fermo dopo questa foto…");
});

console.log(`📸 ${camera} · una foto ogni ${values.ogni}s per ${values.durata} minuti · Ctrl+C per fermare`);

while (!stop && Date.now() < fine) {
  const inizio = Date.now();
  try {
    const file = await scattaFoto(camera);
    scattate++;
    console.log(`  ${scattate}. ${file}`);
  } catch (err) {
    errori++;
    console.error(`  ⚠️ scatto fallito: ${(err as Error).message.split("\n")[0]}`);
    if (errori >= 5 && scattate === 0) {
      console.error("❌ La fotocamera non risponde. Controlla il nome (imagesnap -l) e i permessi in Impostazioni › Privacy › Fotocamera.");
      process.exit(1);
    }
  }
  // Aspetta il resto dell'intervallo (lo scatto stesso dura ~1-2s).
  const attesa = Math.max(0, ogniMs - (Date.now() - inizio));
  await new Promise((r) => setTimeout(r, Math.min(attesa, Math.max(0, fine - Date.now()))));
}

console.log(`\n✅ ${scattate} foto in photos/ (${errori} errori). Ora: npm run importa`);
