import { readFileSync } from "node:fs";
import { chiudi, salvaAnalisi, sincronizzaUccellini } from "./db.js";
import { classifyImage, embed, textForEmbedding, VISION_MODEL } from "./ollama.js";
import { AnalisiFoto, LIVELLI_ALLARME, MIN_CONFIDENCE } from "./schema.js";
import { nomeDaColore } from "./uccellini.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run"); // analizza senza salvare nel database
const imagePath = args.find((a) => !a.startsWith("--"));
if (!imagePath) {
  console.error("Uso: npm run classify -- photos/IMG_0719.jpg [--dry-run]");
  process.exit(1);
}

const sec = (ns: number) => (ns / 1e9).toFixed(1) + "s";

try {
  // 1. Gli occhi: il modello di visione guarda la foto.
  const start = performance.now();
  const { raw, timing } = await classifyImage(readFileSync(imagePath).toString("base64"));
  console.log(`⏱️ Visione: ${((performance.now() - start) / 1000).toFixed(1)}s`);
  console.log(`   caricamento modello: ${sec(timing.load_duration)}`);
  console.log(`   lettura foto+prompt: ${sec(timing.prompt_eval_duration)} (${timing.prompt_eval_count} token)`);
  console.log(`   generazione risposta: ${sec(timing.eval_duration)} (${timing.eval_count} token)`);

  // Primo guardrail: lo schema Zod.
  const parsed = AnalisiFoto.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    console.error("Risposta grezza:", raw);
    console.error("❌ Risposta scartata (schema non valido):", parsed.error.issues);
    process.exit(1);
  }
  const analisi = parsed.data;

  console.log(`\n📷 ${analisi.scena}`);

  const { acqua, cibo, note } = analisi.gabbia;
  console.log(`🏠 acqua: ${acqua} · cibo: ${cibo} — ${note}`);
  if (LIVELLI_ALLARME.includes(acqua)) console.warn(`🚨 Acqua ${acqua}: va controllata!`);
  if (LIVELLI_ALLARME.includes(cibo)) console.warn(`🚨 Cibo ${cibo}: va controllato!`);

  for (const u of analisi.uccellini) {
    // Secondo guardrail: la soglia di confidenza. L'evento si salva comunque,
    // ma chi legge il diario (galleria, agente) ignora quelli incerti.
    const flag = u.confidenza < MIN_CONFIDENCE ? "⚠️ incerto" : "✅";
    console.log(`${flag} ${nomeDaColore(u.colore)} (${u.colore}): ${u.azione} (${u.confidenza}) — ${u.descrizione}`);
    console.log(`   posizione: ${u.posizione} · postura: ${u.postura} · vicino a: ${u.oggetti_vicini.join(", ") || "-"}`);
  }

  // 2. Un embedding per uccellino, per la ricerca semantica.
  const embedStart = performance.now();
  const embeddings = await embed(analisi.uccellini.map((u) => textForEmbedding(u, analisi.scena)), "documento");
  console.log(`\n⏱️ Embedding: ${((performance.now() - embedStart) / 1000).toFixed(1)}s (${embeddings.length} × ${embeddings[0].length} dimensioni)`);

  // 3. Nel diario.
  if (dryRun) {
    console.log("🧪 --dry-run: niente salvataggio.");
  } else {
    await sincronizzaUccellini();
    const fotoId = await salvaAnalisi(analisi, imagePath, VISION_MODEL, embeddings);
    console.log(`💾 Foto #${fotoId} salvata con ${analisi.uccellini.length} eventi.`);
  }
} finally {
  await chiudi();
}
