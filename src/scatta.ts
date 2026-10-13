import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, promisify } from "node:util";

// Scatta una foto dalla webcam ogni N secondi e la mette in photos/.
// Poi npm run importa le classifica.
// Uso: npm run scatta -- [--ogni 20] [--durata 60] [--camera iPhone]
// Richiede imagesnap (brew install imagesnap). Fotocamere disponibili: imagesnap -l

const run = promisify(execFile);

const { values } = parseArgs({
  options: {
    ogni: { type: "string", default: "20" }, // secondi tra una foto e l'altra
    durata: { type: "string", default: "60" }, // minuti
    camera: { type: "string", default: "MacBook" }, // basta una parte del nome
  },
});

// I nomi delle fotocamere possono contenere spazi speciali (es. "MacBook Air"):
// li normalizziamo e cerchiamo per sottostringa.
const normalizza = (s: string) => s.replace(/\s+/g, " ").toLowerCase();
const { stdout } = await run("imagesnap", ["-l"]);
const fotocamere = stdout.split("\n").filter((r) => r.startsWith("=> ")).map((r) => r.slice(3).trim());
const camera = fotocamere.find((f) => normalizza(f).includes(normalizza(values.camera!)));
if (!camera) {
  console.error(`❌ Nessuna fotocamera contiene "${values.camera}". Disponibili:\n  ${fotocamere.join("\n  ")}`);
  process.exit(1);
}
const ogniMs = Number(values.ogni) * 1000;
const fine = Date.now() + Number(values.durata) * 60_000;
const CARTELLA = "photos";
mkdirSync(CARTELLA, { recursive: true });

// "2026-10-13_15-04-20" nell'ora locale: ordinabile e leggibile.
const timestamp = () => new Date().toLocaleString("sv-SE").replace(" ", "_").replaceAll(":", "-");

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
  const file = join(CARTELLA, `cam_${timestamp()}.jpg`);
  try {
    // -w 1: un secondo di "riscaldamento" perché la webcam regoli luce e messa a fuoco.
    await run("imagesnap", ["-q", "-w", "1", "-d", camera, file]);
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

console.log(`\n✅ ${scattate} foto in ${CARTELLA}/ (${errori} errori). Ora: npm run importa`);
