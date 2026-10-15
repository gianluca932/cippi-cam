import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, parse } from "node:path";
import { parseArgs } from "node:util";
import { convertiInJpg, percorsoJpg } from "../foto/importazione.js";
import { oraScatto } from "../foto/pipeline.js";
import { caricaFoto, fotoSuS3 } from "../foto/s3.js";
import { c } from "../comune/terminale.js";

// Carica su S3 gli scatti di photos/: su AWS l'analisi parte da sola (S3 → SQS → Lambda).
// Sul Mac restano solo la webcam e la conversione in JPG da 1024px (sips esiste solo su macOS);
// la chiave su S3 è lo stesso percorso del diario (data/foto/X.jpg) e l'ora dello scatto viaggia come metadato.
// Le foto già su S3 si saltano, quindi si può rilanciare quando si vuole.
//
// Uso: npm run carica                          → tutta la cartella photos/
//      npm run carica -- photos/IMG_0723.HEIC  → solo i file indicati
//      npm run carica -- --segui               → resta acceso e carica gli scatti nuovi (con npm run scatta)
// Serve FOTO_BUCKET nel .env e le credenziali AWS (aws login --profile cippi, poi AWS_PROFILE=cippi).

const ORIGINALI = "photos";
const ESTENSIONI = [".heic", ".jpg", ".jpeg", ".png"];
const OGNI_MS = 10_000; // con --segui: ogni quanto ricontrollare la cartella

const { values, positionals } = parseArgs({ options: { segui: { type: "boolean", default: false } }, allowPositionals: true });

// Una foto per nome: se esistono IMG_1.HEIC e IMG_1.jpg, vince l'originale HEIC (come in importa).
function scatti(): string[] {
  const candidati = positionals.length ? positionals : readdirSync(ORIGINALI).sort().map((f) => join(ORIGINALI, f));
  const perNome = new Map<string, string>();
  for (const file of candidati) {
    const ext = extname(file).toLowerCase();
    if (!ESTENSIONI.includes(ext)) continue;
    const { name } = parse(file);
    if (!perNome.has(name) || ext === ".heic") perNome.set(name, file);
  }
  return [...perNome.values()];
}

const giaCaricate = new Set<string>(); // per non richiedere a S3 a ogni giro le foto già viste
let caricate = 0;

async function caricaNuove() {
  const nuove: { originale: string; chiave: string; ora: Date }[] = [];
  for (const originale of scatti()) {
    const chiave = percorsoJpg(originale);
    if (giaCaricate.has(chiave)) continue;
    if (await fotoSuS3(chiave)) {
      giaCaricate.add(chiave);
      continue;
    }
    nuove.push({ originale, chiave, ora: await oraScatto(originale) });
  }
  // In ordine di scatto: il controllo della gabbia ogni 20 minuti conta sull'ordine.
  nuove.sort((a, b) => a.ora.getTime() - b.ora.getTime());

  for (const { originale, chiave, ora } of nuove) {
    const jpg = convertiInJpg(originale);
    await caricaFoto(chiave, await readFile(jpg), ora);
    giaCaricate.add(chiave);
    caricate++;
    console.log(`${c.verde("↑")} ${parse(originale).name} ${c.grigio(ora.toLocaleString("it-IT"))}`);
  }
  return nuove.length;
}

const nuove = await caricaNuove();
console.log(c.grigio(`\n${nuove} caricate, ${giaCaricate.size - nuove} già su S3.`));

if (values.segui) {
  console.log(c.grigio(`Resto in ascolto su ${ORIGINALI}/ (Ctrl+C per uscire)…`));
  let stop = false;
  process.on("SIGINT", () => {
    stop = true;
    console.log(c.grigio(`\n⏹️  ${caricate} foto caricate in questa sessione.`));
    process.exit(0);
  });
  while (!stop) {
    await new Promise((fine) => setTimeout(fine, OGNI_MS));
    await caricaNuove().catch((err: Error) => console.error(`⚠️  ${err.message}: riprovo al prossimo giro`));
  }
}
