import { z } from "zod";
import { cercaSimili, eventiDelGiorno, gabbiaDelGiorno } from "./db.js";
import { episodi } from "./episodi.js";
import { chatConTool, embed, type DefinizioneTool, type Messaggio } from "./ollama.js";
import type { EventoChat, PassoTraccia } from "./api-types.js";
import { AZIONI, MIN_CONFIDENCE } from "./schema.js";
import { NOMI, UCCELLINI } from "./uccellini.js";

// L'agente: il modello (qwen3.5:9b, lo stesso della visione) riceve la domanda e una lista di tool, decide quali chiamare,
// legge i risultati e risponde. Il ciclo si ripete finché il modello non risponde senza tool.

const FUSO = "Europe/Rome";
const MAX_GIRI = 5; // tetto alle chiamate di tool per domanda: evita loop infiniti

const oggi = () => new Date().toLocaleDateString("sv-SE", { timeZone: FUSO });
const ieri = () => new Date(Date.now() - 86_400_000).toLocaleDateString("sv-SE", { timeZone: FUSO });
const hhmm = (d: Date) => d.toLocaleTimeString("it-IT", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });

// --- I tool: schema Zod degli argomenti + funzione che li esegue ---

const Giorno = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .describe("Giorno nel formato YYYY-MM-DD; ometti per oggi");
const Uccellino = z.enum(NOMI).describe("Nome dell'uccellino; ometti per tutti");

function tool<S extends z.ZodObject>(nome: string, descrizione: string, schema: S, esegui: (args: z.infer<S>) => Promise<unknown>) {
  return { nome, descrizione, schema, esegui };
}

const TOOLS = [
  tool(
    "eventi_del_giorno",
    "Cronologia di un giorno: cosa hanno fatto gli uccellini, a che ora e per quanto, raggruppato in episodi.",
    z.object({ giorno: Giorno, uccellino: Uccellino.optional() }),
    async ({ giorno = oggi(), uccellino }) => {
      const eps = episodi(await eventiDelGiorno(giorno, uccellino));
      if (!eps.length) return { giorno, episodi: [], nota: "Nessun evento affidabile in questo giorno." };
      return {
        giorno,
        episodi: eps.slice(0, 60).map((e) => ({
          uccellino: e.uccellino,
          azione: e.azione,
          dalle: hhmm(e.dalle),
          alle: hhmm(e.alle),
          foto: e.foto,
        })),
      };
    },
  ),
  tool(
    "conta_eventi",
    "Quante volte (episodi) ogni uccellino ha fatto ogni azione in un giorno, con gli orari. Usalo per domande tipo 'quante volte'.",
    z.object({ giorno: Giorno, uccellino: Uccellino.optional(), azione: z.enum(AZIONI).optional() }),
    async ({ giorno = oggi(), uccellino, azione }) => {
      const eps = episodi(await eventiDelGiorno(giorno, uccellino)).filter((e) => !azione || e.azione === azione);
      const conteggi = new Map<string, { uccellino: string; azione: string; volte: number; orari: string[] }>();
      for (const e of eps) {
        const k = `${e.uccellino}/${e.azione}`;
        const c = conteggi.get(k) ?? { uccellino: e.uccellino, azione: e.azione, volte: 0, orari: [] };
        c.volte++;
        c.orari.push(hhmm(e.dalle));
        conteggi.set(k, c);
      }
      return { giorno, conteggi: [...conteggi.values()] };
    },
  ),
  tool(
    "cerca_momenti",
    "Ricerca per significato nelle descrizioni delle foto (es. 'nascosto dietro il posatoio', 'vicino allo specchio'). Usalo quando la domanda non riguarda un'azione precisa.",
    z.object({
      testo: z.string().min(1).describe("Cosa cercare, in italiano"),
      uccellino: Uccellino.optional(),
      giorno: Giorno,
    }),
    async ({ testo, uccellino, giorno }) => {
      const [vettore] = await embed([testo], "domanda");
      const risultati = await cercaSimili(vettore, 5, { uccellino, giorno });
      return {
        risultati: risultati.map((r) => ({
          quando: `${r.ora.toLocaleDateString("sv-SE", { timeZone: FUSO })} ${hhmm(r.ora)}`,
          uccellino: r.uccellino,
          azione: r.azione,
          incerto: r.confidenza < MIN_CONFIDENCE,
          descrizione: r.descrizione,
          similarita: Number(r.similarita.toFixed(2)),
        })),
      };
    },
  ),
  tool(
    "stato_gabbia",
    "Livello di acqua e cibo nell'ultima foto del giorno, e se durante il giorno sono stati scarsi o vuoti.",
    z.object({ giorno: Giorno }),
    async ({ giorno = oggi() }) => {
      // Riassunto già calcolato: un modello piccolo sbaglia se deve dedurlo da una lista lunga.
      const foto = await gabbiaDelGiorno(giorno);
      if (!foto.length) return { giorno, nota: "Nessuna foto in questo giorno." };
      const riassunto = (campo: "acqua" | "cibo") => {
        const visibili = foto.filter((f) => f[campo] !== "non_visibile");
        const ultima = visibili.at(-1);
        const perLivello: Record<string, number> = {};
        for (const f of foto) perLivello[f[campo]] = (perLivello[f[campo]] ?? 0) + 1;
        return {
          ultimo_livello_visto: ultima ? `${ultima[campo]} alle ${hhmm(ultima.ora)}` : "mai visibile oggi",
          foto_per_livello: perLivello,
        };
      };
      return { giorno, foto_analizzate: foto.length, acqua: riassunto("acqua"), cibo: riassunto("cibo") };
    },
  ),
];

// Il formato che Ollama si aspetta: il JSON Schema degli argomenti lo ricaviamo da Zod.
const DEFINIZIONI: DefinizioneTool[] = TOOLS.map((t) => {
  const { $schema: _, ...parameters } = z.toJSONSchema(t.schema) as Record<string, unknown>;
  return { type: "function", function: { name: t.nome, description: t.descrizione, parameters } };
});

const systemPrompt = () => `Sei l'assistente di Cippi Cam: rispondi a domande sui pappagallini di casa usando il loro diario.
Uccellini: ${UCCELLINI.map((u) => `${u.nome} (${u.colore})`).join(", ")}.
Azioni possibili: ${AZIONI.join(", ")}.
Oggi è ${oggi()}, ieri era ${ieri()}. Fuso orario: Italia.

Regole:
- Per qualsiasi fatto sugli uccellini usa SEMPRE i tool: non inventare orari, conteggi o azioni.
- Se la domanda non nomina un giorno, si parla di oggi: ometti "giorno" (è oggi di default).
- "Quante volte" → conta_eventi. "Cosa ha fatto" → eventi_del_giorno. Concetti liberi ("nascosto", "vicino a...") → cerca_momenti. Acqua e cibo → stato_gabbia.
- Se un tool non trova niente, dillo chiaramente.
- Il diario viene da un modello di visione che può sbagliare: se i dati sono pochi o incerti, dillo.
- Per acqua e cibo conta soprattutto "ultimo_livello_visto": un singolo "scarso" isolato può essere un errore.
- Rispondi in italiano, breve e amichevole, con gli orari quando servono.
/no_think`;

// Qwen3 a volte scrive il ragionamento nel testo, chiuso da </think>: lo separiamo dalla risposta.
function separaPensiero(testo: string): { pensiero?: string; risposta: string } {
  if (!testo.includes("</think>")) return { risposta: testo.trim() };
  const [pensiero, ...resto] = testo.split("</think>");
  return { pensiero: pensiero.replace("<think>", "").trim(), risposta: resto.join("").trim() };
}

// Il risultato di un tool, accorciato per mostrarlo nella traccia.
const abbrevia = (v: unknown, max = 220) => {
  const json = JSON.stringify(v);
  return json.length > max ? `${json.slice(0, max)}…` : json;
};

export type TurnoChat = { ruolo: "utente" | "assistente"; testo: string };

// emetti riceve gli eventi man mano (per lo streaming); senza, si aspetta solo il risultato finale.
export async function chiediAllAgente(
  domanda: string,
  storia: TurnoChat[] = [],
  emetti: (e: EventoChat) => void = () => {},
): Promise<{ risposta: string; traccia: PassoTraccia[] }> {
  const messages: Messaggio[] = [
    { role: "system", content: systemPrompt() },
    ...storia.map((t): Messaggio => ({ role: t.ruolo === "utente" ? "user" : "assistant", content: t.testo })),
    { role: "user", content: domanda },
  ];
  const traccia: PassoTraccia[] = [];
  const toolUsati = () => traccia.some((p) => p.tipo === "tool");
  const aggiungi = (passo: PassoTraccia) => {
    traccia.push(passo);
    if (passo.tipo !== "pensiero") emetti({ tipo: "passo", passo }); // il pensiero è già arrivato a pezzetti
  };
  const fine = (risposta: string) => {
    emetti({ tipo: "fine", risposta, traccia });
    return { risposta, traccia };
  };
  let pensa = false; // si accende solo se il modello prova a rispondere senza tool

  for (let giro = 0; giro < MAX_GIRI; giro++) {
    // Il pensiero va subito al browser. La risposta solo se è già stato usato un tool:
    // altrimenti potrebbe essere inventata, e la trattiene finché il guardrail non l'ha controllata.
    const sicura = toolUsati();
    const risposta = await chatConTool(messages, DEFINIZIONI, pensa, (d) => {
      if (d.pensiero) emetti({ tipo: "pensiero", testo: d.pensiero });
      if (d.testo && sicura) emetti({ tipo: "testo", testo: d.testo });
    });
    messages.push({ role: "assistant", content: risposta.content, tool_calls: risposta.tool_calls });

    const { pensiero: pensieroNelTesto, risposta: testo } = separaPensiero(risposta.content);
    const pensiero = risposta.thinking?.trim() || pensieroNelTesto;
    if (pensiero) aggiungi({ tipo: "pensiero", testo: pensiero });

    // Nessun tool richiesto: questa è la risposta finale...
    if (!risposta.tool_calls?.length) {
      // ...a meno che citi numeri o orari senza aver consultato il diario: quasi certamente inventati.
      // Guardrail nel codice, non nel prompt: un modello piccolo a volte ignora le regole del prompt.
      if (!toolUsati() && /\d/.test(testo)) {
        if (pensa) {
          // Anche ragionando non ha usato tool: meglio nessuna risposta che una inventata.
          aggiungi({ tipo: "guardrail", testo: "Di nuovo una risposta senza consultare il diario: la scarto." });
          return fine("Non sono riuscito a consultare il diario per questa domanda. Prova a riformularla.");
        }
        aggiungi({
          tipo: "guardrail",
          testo: "Risposta con numeri senza aver consultato il diario: la scarto e riprovo ragionando.",
        });
        messages.pop();
        pensa = true;
        continue;
      }
      return fine(testo);
    }

    for (const chiamata of risposta.tool_calls) {
      const { name, arguments: args } = chiamata.function;
      const t = TOOLS.find((t) => t.nome === name);
      let contenuto: unknown;

      // Il modello a volte passa "" o null per dire "non specificato": li trattiamo come assenti.
      const argsPuliti = Object.fromEntries(Object.entries(args ?? {}).filter(([, v]) => v !== "" && v !== null));
      // Guardrail: gli argomenti scelti dal modello passano da Zod prima di toccare il database.
      const parsed = t?.schema.safeParse(argsPuliti);
      if (!t) {
        contenuto = { errore: `Tool sconosciuto: ${name}` };
      } else if (!parsed?.success) {
        contenuto = { errore: "Argomenti non validi", dettagli: parsed?.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
      } else {
        contenuto = await t.esegui(parsed.data as never);
      }

      const errore = (contenuto as { errore?: string }).errore;
      aggiungi({ tipo: "tool", nome: name, argomenti: argsPuliti, risultato: abbrevia(contenuto), ...(errore && { errore }) });
      messages.push({ role: "tool", tool_name: name, content: JSON.stringify(contenuto) });
    }
    // Il ragionamento serve a scegliere il tool; per scrivere la risposta finale basta la modalità veloce.
    pensa = false;
  }

  return fine("Non sono riuscito a trovare una risposta: troppi passaggi. Prova a riformulare.");
}
