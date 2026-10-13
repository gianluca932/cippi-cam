import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { chiudi, eventiPerEmbedding } from "./db.js";
import { embed, textForEmbedding } from "./ollama.js";

// Confronta modelli di embedding sugli stessi eventi e sulle stesse domande (eval/ricerca.json).
// Calcola tutto in memoria: il database non viene toccato.
// Uso: npm run confronta-embedding -- nomic-embed-text bge-m3 qwen3-embedding:0.6b

type Caso = { domanda: string; attesi: string[] }; // "IMG_0719/Sky" = foto/uccellino

const modelli = process.argv.slice(2);
if (!modelli.length) modelli.push("nomic-embed-text");
const casi: Caso[] = JSON.parse(readFileSync(new URL("../eval/ricerca.json", import.meta.url), "utf8"));

const coseno = (a: number[], b: number[]) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / Math.sqrt(na * nb);
};

try {
  const eventi = await eventiPerEmbedding();
  const chiavi = eventi.map((e) => `${basename(e.percorso, extname(e.percorso))}/${e.uccellino}`);
  const testi = eventi.map((e) => textForEmbedding(e, e.scena));
  console.log(`${eventi.length} eventi, ${casi.length} domande\n`);

  const riepilogo = [];
  for (const modello of modelli) {
    const start = performance.now();
    const docs = await embed(testi, "documento", modello);
    const domande = await embed(casi.map((c) => c.domanda), "domanda", modello);

    let hit1 = 0, mrr = 0;
    console.log(`── ${modello} (${docs[0].length} dim)`);
    casi.forEach((caso, i) => {
      const classifica = docs
        .map((d, j) => ({ chiave: chiavi[j], sim: coseno(domande[i], d) }))
        .sort((a, b) => b.sim - a.sim);
      // Posizione del primo risultato giusto (1 = in cima).
      const rank = classifica.findIndex((r) => caso.attesi.includes(r.chiave)) + 1;
      if (rank === 1) hit1++;
      if (rank > 0) mrr += 1 / rank;
      const top = classifica[0];
      console.log(`  ${rank === 1 ? "✅" : "❌"} "${caso.domanda}" → ${top.chiave} (${top.sim.toFixed(3)}), giusto in posizione ${rank}`);
    });
    riepilogo.push({
      modello,
      "hit@1": `${hit1}/${casi.length}`,
      MRR: (mrr / casi.length).toFixed(2),
      tempo: `${((performance.now() - start) / 1000).toFixed(1)}s`,
    });
    console.log();
  }
  console.table(riepilogo);
} finally {
  await chiudi();
}
