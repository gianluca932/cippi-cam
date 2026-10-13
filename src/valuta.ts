import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, parse } from "node:path";
import { chiudi, etichetteUmane, type Etichetta } from "./db.js";
import { VISION_MODEL } from "./ollama.js";
import { analizza, RispostaNonValida } from "./pipeline.js";
import { nomeDaColore } from "./uccellini.js";

// Misura l'accuratezza del classificatore sulle foto etichettate a mano.
// Le etichette vengono da eval/classificazione.json E dalle correzioni/conferme fatte in galleria.
//
// Uso: npm run valuta                 → riclassifica le foto etichettate con il modello e il prompt di ADESSO
//      npm run valuta -- --lato 1536  → idem, a un'altra risoluzione
//      npm run valuta -- --salvate    → niente modello: confronta le previsioni già nel database con le etichette
// Per provare un altro modello: VISION_MODEL=qwen2.5vl:7b npm run valuta

type Caso = { foto: string; azioni: Record<string, string> };

const args = process.argv.slice(2);
const lato = args.includes("--lato") ? args[args.indexOf("--lato") + 1] : "1024";

const pct = (n: number, d: number) => `${d ? Math.round((n / d) * 100) : 0}%`;

try {
  const etichette = await etichetteUmane();
  if (args.includes("--salvate")) valutaSalvate(etichette);
  else await valutaModello(etichette);
} finally {
  await chiudi();
}

// --- Modalità --salvate: quanto ha sbagliato il modello che ha prodotto i dati, e come ---
function valutaSalvate(etichette: Etichetta[]) {
  if (!etichette.length) {
    console.log("Nessuna etichetta nel database: conferma o correggi qualche azione dalla galleria.");
    return;
  }
  const giusti = etichette.filter((e) => e.azione_modello === e.azione_umana).length;
  console.log(`Previsioni salvate vs etichette in galleria: ${etichette.length} eventi controllati\n`);

  // Matrice di confusione: righe = verità (tu), colonne = cosa ha detto il modello.
  const azioni = [...new Set(etichette.flatMap((e) => [e.azione_umana, e.azione_modello]))].sort();
  const righe = Object.fromEntries(
    azioni.map((vera) => [
      `vero: ${vera}`,
      Object.fromEntries(
        azioni.map((detta) => [detta, etichette.filter((e) => e.azione_umana === vera && e.azione_modello === detta).length || ""]),
      ),
    ]),
  );
  console.log("Righe = cosa facevano davvero, colonne = cosa ha detto il modello:");
  console.table(righe);

  // Per azione: quante volte il modello la riconosce quando è vera (recall).
  console.log("Per azione (quando era davvero così, quante volte il modello l'ha detto):");
  for (const vera of azioni) {
    const casi = etichette.filter((e) => e.azione_umana === vera);
    if (!casi.length) continue;
    const ok = casi.filter((e) => e.azione_modello === vera).length;
    console.log(`  ${vera.padEnd(13)} ${ok}/${casi.length} (${pct(ok, casi.length)})`);
  }

  // La confidenza dichiarata dal modello serve a qualcosa? Confronto tra sicuri e incerti.
  const sicuri = etichette.filter((e) => e.confidenza_modello >= 0.6);
  const incerti = etichette.filter((e) => e.confidenza_modello < 0.6);
  const acc = (es: Etichetta[]) => pct(es.filter((e) => e.azione_modello === e.azione_umana).length, es.length);
  console.log(`\nConfidenza ≥ 0.6: ${acc(sicuri)} giusti su ${sicuri.length} · confidenza < 0.6: ${acc(incerti)} giusti su ${incerti.length}`);
  console.log(`\nAccuratezza: ${giusti}/${etichette.length} (${pct(giusti, etichette.length)})`);
}

// --- Modalità normale: riclassifica le foto etichettate con il modello e il prompt attuali ---
async function valutaModello(etichette: Etichetta[]) {
  // Unisce le etichette del file con quelle della galleria (la galleria vince sui doppioni).
  const perFoto = new Map<string, Record<string, string>>();
  const daFile: Caso[] = JSON.parse(readFileSync(new URL("../eval/classificazione.json", import.meta.url), "utf8"));
  for (const c of daFile) perFoto.set(c.foto, { ...c.azioni });
  for (const e of etichette) {
    const nome = parse(e.percorso).name;
    perFoto.set(nome, { ...perFoto.get(nome), [e.uccellino]: e.azione_umana });
  }

  // Converte l'originale alla risoluzione richiesta (in cache in data/eval/).
  const cartella = "data/eval";
  mkdirSync(cartella, { recursive: true });
  const originali = new Map(readdirSync("photos").map((f) => [parse(f).name, join("photos", f)]));
  const immagine = (nome: string) => {
    const jpg = join(cartella, `${nome}-${lato}.jpg`);
    const originale = originali.get(nome);
    if (!originale) throw new Error(`Foto ${nome} non trovata in photos/`);
    if (!existsSync(jpg)) execFileSync("sips", ["-s", "format", "jpeg", "-Z", lato, originale, "--out", jpg], { stdio: "ignore" });
    return jpg;
  };

  console.log(`Modello: ${VISION_MODEL} · lato: ${lato}px · ${perFoto.size} foto (${daFile.length} dal file, ${etichette.length} etichette dalla galleria)\n`);
  let giusti = 0, totale = 0;

  for (const [foto, azioni] of perFoto) {
    console.log(`── ${foto}`);
    try {
      const { analisi } = await analizza(immagine(foto));
      for (const u of analisi.uccellini) {
        const nome = nomeDaColore(u.colore);
        const atteso = azioni[nome];
        if (!atteso) continue; // non etichettato
        totale++;
        const ok = u.azione === atteso;
        if (ok) giusti++;
        console.log(`  ${ok ? "✅" : "❌"} ${nome}: ${u.azione} (${u.confidenza})${ok ? "" : `, atteso ${atteso}`} — ${u.postura}`);
      }
    } catch (err) {
      if (!(err instanceof RispostaNonValida)) throw err;
      console.log("  ❌ risposta non valida per lo schema");
      totale += Object.keys(azioni).length;
    }
  }

  console.log(`\nAccuratezza: ${giusti}/${totale} (${pct(giusti, totale)})`);
}
