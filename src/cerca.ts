import { cercaSimili, chiudi } from "./db.js";
import { embed } from "./modelli.js";

// Uso: npm run cerca -- "uccellino nascosto dietro il posatoio"
const domanda = process.argv.slice(2).join(" ");
if (!domanda) {
  console.error('Uso: npm run cerca -- "la tua domanda"');
  process.exit(1);
}

try {
  const [vettore] = await embed([domanda], "domanda");
  const risultati = await cercaSimili(vettore, 3);
  console.log(`🔎 "${domanda}"`);
  for (const r of risultati) {
    console.log(`  ${r.similarita.toFixed(3)}  foto #${r.foto_id} · ${r.uccellino} · ${r.azione} — ${r.descrizione}`);
  }
} finally {
  await chiudi();
}
