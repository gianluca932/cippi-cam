import { parseArgs } from "node:util";
import { cercaFotoSimili, cercaSimili, chiudi, embeddingImmagineDi } from "../db/db.js";
import { embeddingTestoPerImmagini } from "../modelli/immagini.js";
import { embed } from "../modelli/modelli.js";

// Ricerca semantica nel diario, in tre modi:
//   npm run cerca -- "uccellino nascosto dietro il posatoio"     → nelle DESCRIZIONI scritte dal modello (testo)
//   npm run cerca -- --immagini "two budgies near the feeder"     → direttamente nelle FOTO (CLIP, in inglese)
//   npm run cerca -- --simili 12                                   → le foto più simili alla foto #12
const { values, positionals } = parseArgs({
  options: { immagini: { type: "boolean" }, simili: { type: "string" } },
  allowPositionals: true,
});
const domanda = positionals.join(" ");
if (!domanda && !values.simili) {
  console.error('Uso: npm run cerca -- "domanda"  |  --immagini "query in inglese"  |  --simili <id foto>');
  process.exit(1);
}

try {
  if (values.simili) {
    const id = Number(values.simili);
    const vettore = await embeddingImmagineDi(id);
    if (!vettore) throw new Error(`La foto #${id} non esiste o non ha ancora l'impronta (npm run embedding-immagini)`);
    console.log(`🖼️  Foto simili alla #${id}`);
    for (const r of await cercaFotoSimili(vettore, 5, { escludiFotoId: id })) {
      console.log(`  ${r.similarita.toFixed(3)}  foto #${r.foto_id} · ${r.percorso} — ${r.scena}`);
    }
  } else if (values.immagini) {
    const vettore = await embeddingTestoPerImmagini(domanda);
    console.log(`🖼️  "${domanda}" (nelle foto)`);
    for (const r of await cercaFotoSimili(vettore, 5)) {
      console.log(`  ${r.similarita.toFixed(3)}  foto #${r.foto_id} · ${r.percorso} — ${r.scena}`);
    }
  } else {
    const [vettore] = await embed([domanda], "domanda");
    console.log(`🔎 "${domanda}" (nelle descrizioni)`);
    for (const r of await cercaSimili(vettore, 5)) {
      console.log(`  ${r.similarita.toFixed(3)}  foto #${r.foto_id} · ${r.uccellino} · ${r.azione} — ${r.descrizione}`);
    }
  }
} finally {
  await chiudi();
}
