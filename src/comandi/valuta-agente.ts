import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "langsmith";
import { evaluate, type EvaluationResult } from "langsmith/evaluation";
import { z } from "zod";
import { chiediAllAgente } from "../agente/index.js";
import { chiudi } from "../db/db.js";
import { configLlm } from "../modelli/llm.js";
import { c } from "../comune/terminale.js";

// Misura l'agente della chat: è `valuta` per la chat (regola d'oro n. 2).
// Le domande stanno in eval/agente.json (versionato in git) e si sincronizzano nel dataset "cippi-cam-agente"
// su LangSmith. Ogni lancio è un esperimento: su LangSmith si confrontano affiancati, con la traccia di ogni domanda.
//
// Uso: LLM_PROVIDER=bedrock AGENT_MODEL=… DB_PROVIDER=rds npm run valuta-agente
//      npm run valuta-agente -- --file eval/agente-en.json   (le stesse domande in inglese)
//      (le risposte attese valgono per il diario su RDS; serve LANGSMITH_API_KEY nel .env)
// Il dataset su LangSmith prende il nome dal file: agente.json → cippi-cam-agente, agente-en.json → cippi-cam-agente-en.
//
// I valutatori sono codice, non un modello giudice: controllano cose verificabili.
//   tool_giusti      → ha chiamato i tool attesi?
//   risposta_giusta  → la risposta contiene i numeri e gli orari attesi, e niente di quello che non deve dire?

const { values } = parseArgs({ options: { file: { type: "string", default: "eval/agente.json" } } });
const FILE = values.file;
const DATASET = `cippi-cam-${basename(FILE, ".json")}`;

const Domanda = z.object({
  domanda: z.string(),
  tool: z.array(z.string()).min(1),
  deve_contenere: z.array(z.string()).default([]),
  non_deve_contenere: z.array(z.string()).default([]),
  tipo: z.string(),
});
type Atteso = Omit<z.infer<typeof Domanda>, "domanda">;

const file = readFileSync(FILE, "utf8");
const { domande } = z.object({ domande: z.array(Domanda).min(1) }).parse(JSON.parse(file));

// --- Il dataset su LangSmith: si ricrea solo se eval/agente.json è cambiato ---

const client = new Client();
const impronta = createHash("sha256").update(file).digest("hex").slice(0, 12);

async function sincronizzaDataset() {
  const descrizione = `Domande per l'agente di Cippi Cam (da ${FILE}, impronta ${impronta})`;
  const esiste = await client.hasDataset({ datasetName: DATASET });
  const dataset = esiste ? await client.readDataset({ datasetName: DATASET }) : await client.createDataset(DATASET, { description: descrizione });
  if (esiste && dataset.description === descrizione) return;

  const vecchi: string[] = [];
  for await (const e of client.listExamples({ datasetId: dataset.id })) vecchi.push(e.id);
  if (vecchi.length) await client.deleteExamples(vecchi);
  await client.createExamples(
    domande.map(({ domanda, ...atteso }) => ({ inputs: { domanda }, outputs: atteso, dataset_id: dataset.id })),
  );
  await client.updateDataset({ datasetId: dataset.id, description: descrizione });
  console.log(c.grigio(`Dataset ${DATASET} aggiornato: ${domande.length} domande.`));
}

// --- I valutatori ---

const cerca = (regola: string, testo: string) => new RegExp(regola, "i").test(testo);

function toolGiusti({ outputs, referenceOutputs }: { outputs: Record<string, unknown>; referenceOutputs?: Record<string, unknown> }): EvaluationResult {
  const usati = (outputs.tool as string[]) ?? [];
  const attesi = (referenceOutputs as Atteso).tool;
  const mancanti = attesi.filter((voce) => !voce.split("|").some((t) => usati.includes(t)));
  return { key: "tool_giusti", score: mancanti.length ? 0 : 1, comment: mancanti.length ? `mancano: ${mancanti.join(", ")} · usati: ${usati.join(", ") || "nessuno"}` : undefined };
}

function rispostaGiusta({ outputs, referenceOutputs }: { outputs: Record<string, unknown>; referenceOutputs?: Record<string, unknown> }): EvaluationResult {
  const risposta = String(outputs.risposta ?? "");
  const { deve_contenere, non_deve_contenere } = referenceOutputs as Atteso;
  const mancano = deve_contenere.filter((r) => !cerca(r, risposta));
  const vietati = non_deve_contenere.filter((r) => cerca(r, risposta));
  const problemi = [...mancano.map((r) => `manca /${r}/`), ...vietati.map((r) => `non doveva dire /${r}/`)];
  return { key: "risposta_giusta", score: problemi.length ? 0 : 1, comment: problemi.join(" · ") || undefined };
}

// --- L'esperimento ---

try {
  await sincronizzaDataset();
  const modello = `${configLlm.provider}:${configLlm.agente}`;
  console.log(c.grigio(`Agente: ${modello} · database: ${process.env.DB_PROVIDER ?? "pg"} · ${domande.length} domande (${FILE})\n`));

  const risultati = await evaluate(
    async ({ domanda }: { domanda: string }) => {
      const { risposta, traccia } = await chiediAllAgente(domanda);
      const tool = traccia.flatMap((p) => (p.tipo === "tool" ? [p.nome] : []));
      return { risposta, tool };
    },
    {
      data: DATASET,
      evaluators: [toolGiusti, rispostaGiusta],
      experimentPrefix: modello.replace(/[^\w.-]+/g, "-"),
      metadata: { modello_agente: configLlm.agente, provider: configLlm.provider, database: process.env.DB_PROVIDER ?? "pg" },
      maxConcurrency: 2, // Bedrock limita le richieste in parallelo
      client,
    },
  );

  let tool = 0;
  let giuste = 0;
  for (const { run, example, evaluationResults } of risultati.results) {
    const voto = (k: string) => evaluationResults.results.find((r) => r.key === k);
    const [t, r] = [voto("tool_giusti"), voto("risposta_giusta")];
    tool += Number(t?.score ?? 0);
    giuste += Number(r?.score ?? 0);
    const secondi = run.end_time && run.start_time ? ((Number(new Date(run.end_time)) - Number(new Date(run.start_time))) / 1000).toFixed(1) : "?";
    console.log(`${t?.score ? "✅" : "❌"} tool  ${r?.score ? "✅" : "❌"} risposta  ${c.grigio(`${secondi}s`)}  ${example.inputs.domanda}`);
    for (const commento of [t?.comment, r?.comment].filter(Boolean)) console.log(c.grigio(`      ${commento}`));
    if (!r?.score) console.log(c.grigio(`      ↳ ${String(run.outputs?.risposta ?? "").replace(/\s+/g, " ").slice(0, 200)}`));
  }
  const n = risultati.results.length;
  console.log(`\nTool giusti: ${tool}/${n} · Risposte giuste: ${giuste}/${n}`);
  console.log(c.grigio(`Esperimento su LangSmith: ${risultati.experimentName}`));
} finally {
  await chiudi();
}
