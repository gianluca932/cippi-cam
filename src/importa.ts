import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, parse } from "node:path";
import { parseArgs } from "node:util";
import { chiudi, sincronizzaUccellini } from "./db.js";
import { importaFoto } from "./importazione.js";
import { controllaEmbedding } from "./modelli.js";

// Importa le foto nuove: converte in JPG da 1024px (data/foto/), legge l'ora di scatto, classifica e salva.
// Le foto già nel database vengono saltate, quindi si può rilanciare quando si vuole.
// Uso: npm run importa                           → tutta la cartella photos/
//      npm run importa -- photos/IMG_0723.HEIC   → solo i file indicati
//      npm run importa -- --lista lista.txt      → i file elencati, uno per riga (# = commento)

const ORIGINALI = "photos";
const ESTENSIONI = [".heic", ".jpg", ".jpeg", ".png"];

// File passati a riga di comando e/o in una lista, oppure tutta la cartella.
const { values, positionals } = parseArgs({ options: { lista: { type: "string" } }, allowPositionals: true });
const dallaLista = values.lista
  ? readFileSync(values.lista, "utf8")
      .split("\n")
      .map((r) => r.trim())
      .filter((r) => r && !r.startsWith("#"))
  : [];
const richiesti = [...positionals, ...dallaLista];
for (const f of richiesti) {
  if (!existsSync(f)) {
    console.error(`❌ File non trovato: ${f}`);
    process.exit(1);
  }
}
const candidati = richiesti.length ? richiesti : readdirSync(ORIGINALI).sort().map((f) => join(ORIGINALI, f));

// Una foto per nome: se esistono IMG_1.HEIC e IMG_1.jpg, vince l'originale HEIC.
const perNome = new Map<string, string>();
for (const file of candidati) {
  const ext = extname(file).toLowerCase();
  if (!ESTENSIONI.includes(ext)) continue;
  const { name } = parse(file);
  if (!perNome.has(name) || ext === ".heic") perNome.set(name, file);
}

let importate = 0, saltate = 0, scartate = 0;
try {
  await sincronizzaUccellini();
  await controllaEmbedding(); // si ferma subito se il modello di embedding non è compatibile con il database

  for (const originale of perNome.values()) {
    const risultato = await importaFoto(originale);
    if (risultato.esito === "presente") saltate++;
    else if (risultato.esito === "importata") {
      console.log(`💾 Foto #${risultato.fotoId} (${risultato.ora.toLocaleString("it-IT")})`);
      importate++;
    } else {
      // Una risposta non valida non ferma l'import: la foto resta da riprovare al prossimo giro.
      console.error("❌ Risposta scartata (schema non valido):", risultato.motivo);
      scartate++;
    }
  }

  console.log(`\nFatto: ${importate} importate, ${saltate} già presenti, ${scartate} scartate.`);
} finally {
  await chiudi();
}
