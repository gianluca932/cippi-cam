import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, parse } from "node:path";
import { VISION_MODEL } from "./ollama.js";
import { analizza, RispostaNonValida } from "./pipeline.js";
import { nomeDaColore } from "./uccellini.js";

// Misura l'accuratezza del classificatore sulle foto etichettate a mano (eval/classificazione.json).
// Non tocca il database. Uso: npm run valuta -- [--lato 1536]
// Per provare un altro modello: VISION_MODEL=qwen2.5vl:7b npm run valuta

type Caso = { foto: string; azioni: Record<string, string> };

const args = process.argv.slice(2);
const lato = args.includes("--lato") ? args[args.indexOf("--lato") + 1] : "1024";
const casi: Caso[] = JSON.parse(readFileSync(new URL("../eval/classificazione.json", import.meta.url), "utf8"));

// Converte l'originale alla risoluzione richiesta (in cache in data/eval/).
const cartella = "data/eval";
mkdirSync(cartella, { recursive: true });
const originali = new Map(readdirSync("photos").map((f) => [parse(f).name, join("photos", f)]));

function immagine(nome: string): string {
  const jpg = join(cartella, `${nome}-${lato}.jpg`);
  const originale = originali.get(nome);
  if (!originale) throw new Error(`Foto ${nome} non trovata in photos/`);
  if (!existsSync(jpg)) execFileSync("sips", ["-s", "format", "jpeg", "-Z", lato, originale, "--out", jpg], { stdio: "ignore" });
  return jpg;
}

console.log(`Modello: ${VISION_MODEL} · lato: ${lato}px · ${casi.length} foto\n`);
let giusti = 0, totale = 0;

for (const caso of casi) {
  console.log(`── ${caso.foto}`);
  try {
    const { analisi } = await analizza(immagine(caso.foto));
    for (const u of analisi.uccellini) {
      const nome = nomeDaColore(u.colore);
      const atteso = caso.azioni[nome];
      if (!atteso) continue; // non etichettato
      totale++;
      const ok = u.azione === atteso;
      if (ok) giusti++;
      console.log(`  ${ok ? "✅" : "❌"} ${nome}: ${u.azione} (${u.confidenza})${ok ? "" : `, atteso ${atteso}`} — ${u.postura}`);
    }
  } catch (err) {
    if (!(err instanceof RispostaNonValida)) throw err;
    console.log("  ❌ risposta non valida per lo schema");
    totale += Object.keys(caso.azioni).length;
  }
}

console.log(`\nAccuratezza: ${giusti}/${totale} (${totale ? Math.round((giusti / totale) * 100) : 0}%)`);
