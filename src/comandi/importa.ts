import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, parse } from "node:path";
import { parseArgs } from "node:util";
import { chiudi, fotoEsiste, sincronizzaUccellini } from "../db/db.js";
import { CONVERTITE, importaFoto } from "../foto/importazione.js";
import { configLlm } from "../modelli/llm.js";
import { controllaEmbedding } from "../modelli/modelli.js";
import type { Fase } from "../foto/pipeline.js";
import { LIVELLI_ALLARME, MIN_CONFIDENCE, type AnalisiFoto } from "../modelli/schema.js";
import { barra, c, durata, Spinner } from "../comune/terminale.js";
import { nomeDaColore } from "../comune/uccellini.js";

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

// --- Grafica ---------------------------------------------------------------------------------

const NOMI_FASI: Record<Fase, string> = {
  conversione: "conversione",
  visione: "modello di visione",
  embedding: "embedding del testo",
  salvataggio: "salvataggio nel diario",
  impronta: "impronta CLIP",
};

const percentuale = (x: number) => `${Math.round(x * 100)}%`;
const livello = (l?: string | null) => (l ?? "?").replaceAll("_", " ");

// Il riassunto di una foto analizzata, in una riga.
function riassunto(analisi: AnalisiFoto): string {
  const uccellini = analisi.uccellini
    .map((u) => {
      const testo = `${nomeDaColore(u.colore)}: ${u.azione.replace("_", " ")} ${percentuale(u.confidenza)}`;
      return u.confidenza < MIN_CONFIDENCE ? c.giallo(`${testo} (incerto)`) : testo;
    })
    .join(" · ");
  const { acqua, cibo } = analisi.gabbia;
  const allarme = (l: string) => (LIVELLI_ALLARME.includes(l as never) ? c.rosso(livello(l)) : livello(l));
  return `   🐦 ${uccellini}   ${c.grigio("💧")} ${allarme(acqua)} ${c.grigio("· 🌾")} ${allarme(cibo)}`;
}

let importate = 0, saltate = 0, scartate = 0;
const tempiFoto: number[] = []; // secondi per foto, per stimare quanto manca

try {
  await sincronizzaUccellini();
  await controllaEmbedding(); // si ferma subito se il modello di embedding non è compatibile con il database

  // Prima contiamo le foto davvero nuove: servono per la barra e per la stima del tempo.
  const nuove: string[] = [];
  for (const originale of perNome.values()) {
    if (await fotoEsiste(join(CONVERTITE, `${parse(originale).name}.jpg`))) saltate++;
    else nuove.push(originale);
  }

  console.log(
    `\n📥 ${c.grassetto("Import")} · ${nuove.length} foto nuove` +
      (saltate ? c.grigio(` (${saltate} già nel diario)`) : "") +
      c.grigio(` · ${configLlm.provider}: visione ${configLlm.visione} · embedding ${configLlm.embedding} · CLIP\n`),
  );

  for (const [i, originale] of nuove.entries()) {
    // Intestazione della foto: numero, nome, barra, stima del tempo che manca.
    const fatte = i / nuove.length;
    const media = tempiFoto.length ? tempiFoto.reduce((a, b) => a + b, 0) / tempiFoto.length : undefined;
    const stima = media ? c.grigio(`~${durata(media * (nuove.length - i))} rimasti`) : c.grigio("stima dopo la prima foto…");
    const numero = `[${String(i + 1).padStart(String(nuove.length).length)}/${nuove.length}]`;
    console.log(`${c.grassetto(numero)} ${parse(originale).name}   ${barra(fatte)} ${percentuale(fatte).padStart(4)}   ${stima}`);

    // Una riga per fase: gira mentre lavora, poi diventa ✓ con il tempo.
    const spinner = new Spinner();
    const inizioFoto = performance.now();
    const risultato = await importaFoto(originale, {
      log: false,
      onFase: (fase, stato, dettaglio) =>
        stato === "inizio" ? spinner.avvia(NOMI_FASI[fase]) : spinner.ferma(true, dettaglio),
    });

    if (risultato.esito === "importata") {
      importate++;
      tempiFoto.push((performance.now() - inizioFoto) / 1000);
      console.log(riassunto(risultato.analisi));
      console.log(c.grigio(`   💾 foto #${risultato.fotoId} · scattata alle ${risultato.ora.toLocaleTimeString("it-IT")}\n`));
    } else if (risultato.esito === "scartata") {
      // Una risposta non valida non ferma l'import: la foto resta da riprovare al prossimo giro.
      spinner.ferma(false, "risposta fuori schema");
      console.log(c.rosso(`   ✗ scartata: ${JSON.stringify(risultato.motivo).slice(0, 160)}\n`));
      scartate++;
    }
  }

  const media = tempiFoto.length ? durata(tempiFoto.reduce((a, b) => a + b, 0) / tempiFoto.length) : "-";
  console.log(
    `${c.grassetto("Fatto")}: ${c.verde(`${importate} importate`)}, ${saltate} già presenti, ` +
      `${scartate ? c.rosso(`${scartate} scartate`) : "0 scartate"} · ${c.grigio(`in media ${media} a foto`)}`,
  );
} finally {
  await chiudi();
}
