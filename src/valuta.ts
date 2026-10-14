import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, parse } from "node:path";
import { chiudi, etichetteGabbia, etichetteUmane, type Etichetta, type EtichettaGabbia } from "./db.js";
import { VISION_MODEL } from "./modelli.js";
import { analizza, RispostaNonValida } from "./pipeline.js";
import { nomeDaColore } from "./uccellini.js";

// Misura l'accuratezza del classificatore sulle foto etichettate a mano.
// Le etichette vengono da eval/classificazione.json E dalle correzioni/conferme fatte in galleria.
//
// Uso: npm run valuta                 → riclassifica le foto etichettate con il modello e il prompt di ADESSO
//      npm run valuta -- --lato 1536  → idem, a un'altra risoluzione
//      npm run valuta -- --foto cam_2026-10-13_15-23-37   → solo quella foto (ripetibile)
//      npm run valuta -- --salvate    → niente modello: confronta le previsioni già nel database con le etichette
// Per provare un altro modello: VISION_MODEL=qwen2.5vl:7b npm run valuta

type Caso = { foto: string; azioni: Record<string, string> };

const args = process.argv.slice(2);
const lato = args.includes("--lato") ? args[args.indexOf("--lato") + 1] : "1024";
// --foto NOME (anche più volte): valuta solo queste foto. Accetta anche il nome con estensione.
const soloFoto = args.flatMap((a, i) => (a === "--foto" && args[i + 1] ? [parse(args[i + 1]).name] : []));

// Campi della gabbia valutati (definiti qui, prima del programma principale che li usa).
const CAMPI = ["acqua", "cibo"] as const;
type Campo = (typeof CAMPI)[number];
const umano = (e: EtichettaGabbia, c: Campo) => ({ acqua: e.acqua_umana, cibo: e.cibo_umano })[c];
const delModello = (e: EtichettaGabbia, c: Campo) => ({ acqua: e.acqua_modello, cibo: e.cibo_modello })[c];

const pct = (n: number, d: number) => `${d ? Math.round((n / d) * 100) : 0}%`;

try {
  const etichette = await etichetteUmane();
  const gabbia = await etichetteGabbia();
  if (args.includes("--salvate")) {
    valutaSalvate(etichette);
    valutaGabbiaSalvata(gabbia);
  } else await valutaModello(etichette, gabbia);
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

// --- Gabbia (--salvate): acqua e cibo salvati dal modello contro le tue correzioni ---

function valutaGabbiaSalvata(gabbia: EtichettaGabbia[]) {
  console.log(`\n── Gabbia: ${gabbia.length} foto controllate`);
  if (!gabbia.length) {
    console.log("Nessuna etichetta sulla gabbia: conferma o correggi acqua e cibo dalla galleria.");
    return;
  }
  for (const campo of CAMPI) {
    const casi = gabbia.filter((e) => umano(e, campo) !== null);
    if (!casi.length) continue;
    const giusti = casi.filter((e) => delModello(e, campo) === umano(e, campo)).length;
    // Gli errori raggruppati: "il modello diceva X, era Y" (×N)
    const errori = new Map<string, number>();
    for (const e of casi) {
      if (delModello(e, campo) === umano(e, campo)) continue;
      const chiave = `diceva ${delModello(e, campo) ?? "?"}, era ${umano(e, campo)}`;
      errori.set(chiave, (errori.get(chiave) ?? 0) + 1);
    }
    const dettaglio = [...errori].map(([k, n]) => `${k} ×${n}`).join(" · ");
    console.log(`  ${campo.padEnd(8)} ${giusti}/${casi.length} (${pct(giusti, casi.length)})${dettaglio ? `   ${dettaglio}` : ""}`);
  }
}

// --- Modalità normale: riclassifica le foto etichettate con il modello e il prompt attuali ---
async function valutaModello(etichette: Etichetta[], etichetteGabbia: EtichettaGabbia[]) {
  // Per ogni foto: le azioni attese (dal file e dalla galleria, la galleria vince) e lo stato della gabbia atteso.
  type Attese = { azioni: Record<string, string>; gabbia: Partial<Record<Campo, string>> };
  const perFoto = new Map<string, Attese>();
  const attese = (nome: string) => perFoto.get(nome) ?? perFoto.set(nome, { azioni: {}, gabbia: {} }).get(nome)!;
  const daFile: Caso[] = JSON.parse(readFileSync(new URL("../eval/classificazione.json", import.meta.url), "utf8"));
  for (const c of daFile) Object.assign(attese(c.foto).azioni, c.azioni);
  for (const e of etichette) attese(parse(e.percorso).name).azioni[e.uccellino] = e.azione_umana;
  for (const e of etichetteGabbia) {
    for (const campo of CAMPI) {
      const valore = umano(e, campo);
      if (valore !== null) attese(parse(e.percorso).name).gabbia[campo] = valore;
    }
  }

  // Converte l'originale alla risoluzione richiesta (in cache in data/eval/).
  const cartella = "data/eval";
  mkdirSync(cartella, { recursive: true });
  const originali = new Map(readdirSync("photos").map((f) => [parse(f).name, join("photos", f)]));
  const immagine = (nome: string) => {
    const jpg = join(cartella, `${nome}-${lato}.jpg`);
    const originale = originali.get(nome);
    if (!originale) return null; // foto archiviata o cancellata: si salta
    if (!existsSync(jpg)) execFileSync("sips", ["-s", "format", "jpeg", "-Z", lato, originale, "--out", jpg], { stdio: "ignore" });
    return jpg;
  };

  if (soloFoto.length) {
    for (const nome of [...perFoto.keys()]) if (!soloFoto.includes(nome)) perFoto.delete(nome);
    const mancanti = soloFoto.filter((n) => !perFoto.has(n));
    if (mancanti.length) console.log(`⚠️ Senza etichette, saltate: ${mancanti.join(", ")}`);
  }

  console.log(
    `Modello: ${VISION_MODEL} · lato: ${lato}px · ${perFoto.size} foto ` +
      `(${etichette.length} etichette sulle azioni, ${etichetteGabbia.length} foto con la gabbia controllata)\n`,
  );
  let giusti = 0, totale = 0;
  const gabbiaGiusti: Record<Campo, number> = { acqua: 0, cibo: 0 };
  const gabbiaTotale: Record<Campo, number> = { acqua: 0, cibo: 0 };
  const saltate: string[] = [];

  for (const [foto, { azioni, gabbia }] of perFoto) {
    const jpg = immagine(foto);
    if (!jpg) {
      saltate.push(foto);
      continue;
    }
    console.log(`── ${foto}`);
    try {
      const { analisi } = await analizza(jpg);
      for (const u of analisi.uccellini) {
        const nome = nomeDaColore(u.colore);
        const atteso = azioni[nome];
        if (!atteso) continue; // non etichettato
        totale++;
        const ok = u.azione === atteso;
        if (ok) giusti++;
        console.log(`  ${ok ? "✅" : "❌"} ${nome}: ${u.azione} (${u.confidenza})${ok ? "" : `, atteso ${atteso}`} — ${u.postura}`);
      }
      for (const campo of CAMPI) {
        const atteso = gabbia[campo];
        if (!atteso) continue;
        const detto = analisi.gabbia[campo];
        gabbiaTotale[campo]++;
        if (detto === atteso) gabbiaGiusti[campo]++;
        console.log(`  ${detto === atteso ? "✅" : "❌"} ${campo}: ${detto}${detto === atteso ? "" : `, atteso ${atteso}`}`);
      }
    } catch (err) {
      if (!(err instanceof RispostaNonValida)) throw err;
      console.log("  ❌ risposta non valida per lo schema");
      totale += Object.keys(azioni).length;
      for (const campo of CAMPI) if (gabbia[campo]) gabbiaTotale[campo]++;
    }
  }

  if (saltate.length) console.log(`\n⚠️ ${saltate.length} foto etichettate non sono più in photos/ (archiviate?): saltate.`);
  console.log(`\nAccuratezza azioni: ${giusti}/${totale} (${pct(giusti, totale)})`);
  for (const campo of CAMPI) {
    if (gabbiaTotale[campo]) console.log(`Accuratezza ${campo}: ${gabbiaGiusti[campo]}/${gabbiaTotale[campo]} (${pct(gabbiaGiusti[campo], gabbiaTotale[campo])})`);
  }
}
