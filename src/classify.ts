import { readFileSync } from "node:fs";
import { z } from "zod";
import { CippiEvent, MIN_CONFIDENCE } from "./schema.js";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.VISION_MODEL ?? "qwen3.5:9b";

const imagePath = process.argv[2];
if (!imagePath) {
  console.error("Uso: npm run classify -- photos/cippi.jpg");
  process.exit(1);
}

const imageBase64 = readFileSync(imagePath).toString("base64");

const prompt = `Nella foto c'è un pappagallino (budgerigar) di nome Cippi.
Descrivi cosa sta facendo. Rispondi SOLO con JSON.
- azione: una tra mangia, beve, dorme, si_pulisce, gioca, vola, riposa, non_visibile
- confidenza: numero tra 0 e 1 (quanto sei sicuro)
- descrizione: una frase breve in italiano
Se il pappagallino non si vede, usa "non_visibile".`;

const start = performance.now();
const res = await fetch(`${OLLAMA_URL}/api/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: MODEL,
    stream: false,
    think: false, // niente ragionamento: per classificare è solo più lento
    format: z.toJSONSchema(CippiEvent), // Ollama forza l'output a questo schema
    messages: [{ role: "user", content: prompt, images: [imageBase64] }],
    options: { temperature: 0, num_ctx: 8192 }, // la foto da sola occupa ~4000 token
  }),
});

if (!res.ok) {
  console.error(`Ollama ha risposto ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const data = (await res.json()) as {
  message: { content: string };
  // Tempi restituiti da Ollama, in nanosecondi.
  load_duration: number;
  prompt_eval_duration: number;
  prompt_eval_count: number;
  eval_duration: number;
  eval_count: number;
};
const sec = (ns: number) => (ns / 1e9).toFixed(1) + "s";
console.log(`⏱️ Totale: ${((performance.now() - start) / 1000).toFixed(1)}s`);
console.log(`   caricamento modello: ${sec(data.load_duration)}`);
console.log(`   lettura foto+prompt: ${sec(data.prompt_eval_duration)} (${data.prompt_eval_count} token)`);
console.log(`   generazione risposta: ${sec(data.eval_duration)} (${data.eval_count} token)`);
console.log("Risposta grezza:", data.message.content);

// Primo guardrail: lo schema Zod.
const parsed = CippiEvent.safeParse(JSON.parse(data.message.content));
if (!parsed.success) {
  console.error("❌ Risposta scartata (schema non valido):", parsed.error.issues);
  process.exit(1);
}

// Secondo guardrail: la soglia di confidenza.
if (parsed.data.confidenza < MIN_CONFIDENCE) {
  console.warn(`⚠️ Evento incerto (confidenza ${parsed.data.confidenza}), non lo salverei.`);
}

console.log("✅ Evento valido:", parsed.data);
