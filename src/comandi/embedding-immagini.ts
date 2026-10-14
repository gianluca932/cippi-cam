import { chiudi, fotoSenzaEmbeddingImmagine, salvaEmbeddingImmagine } from "../db/db.js";
import { embeddingImmagine } from "../modelli/immagini.js";

// Calcola l'impronta CLIP delle foto che non ce l'hanno ancora (quelle importate prima di CLIP).
// Si può rilanciare quando si vuole: tocca solo le foto senza impronta.
// Uso: npm run embedding-immagini

try {
  const daFare = await fotoSenzaEmbeddingImmagine();
  console.log(`${daFare.length} foto senza impronta`);
  const inizio = performance.now();
  for (const [i, f] of daFare.entries()) {
    await salvaEmbeddingImmagine(f.id, await embeddingImmagine(f.percorso));
    if ((i + 1) % 10 === 0 || i === daFare.length - 1) console.log(`  ${i + 1}/${daFare.length}`);
  }
  console.log(`✅ Fatto in ${((performance.now() - inizio) / 1000).toFixed(1)}s (compreso il caricamento di CLIP)`);
} finally {
  await chiudi();
}
