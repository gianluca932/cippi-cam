import { chiediAllAgente } from "./agente.js";
import { chiudi } from "./db.js";

// Prova l'agente da terminale: npm run chiedi -- "quante volte ha mangiato Cippi oggi?"
const domanda = process.argv.slice(2).join(" ");
if (!domanda) {
  console.error('Uso: npm run chiedi -- "la tua domanda"');
  process.exit(1);
}

try {
  const start = performance.now();
  const { risposta, traccia } = await chiediAllAgente(domanda);
  for (const p of traccia) {
    if (p.tipo === "pensiero") console.log(`🧠 ${p.testo}`);
    if (p.tipo === "guardrail") console.log(`🛡️ ${p.testo}`);
    if (p.tipo === "tool") {
      console.log(`🔧 ${p.nome}(${JSON.stringify(p.argomenti)})${p.errore ? ` ❌ ${p.errore}` : ""}`);
      console.log(`   ↳ ${p.risultato}`);
    }
  }
  console.log(`\n💬 ${risposta}`);
  console.log(`\n⏱️ ${((performance.now() - start) / 1000).toFixed(1)}s`);
} finally {
  await chiudi();
}
