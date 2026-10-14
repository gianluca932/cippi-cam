import { tool } from "langchain";
import { z } from "zod";
import { cercaSimili, eventiDelGiorno, gabbiaDelGiorno } from "../db.js";
import { episodi } from "../episodi.js";
import { embed } from "../modelli.js";
import { AZIONI, MIN_CONFIDENCE } from "../schema.js";
import { NOMI } from "../uccellini.js";
import { giornoEOra, hhmm, oggi } from "./orari.js";

// I quattro tool dell'agente.
//
// 📘 LangChain — tool()
// È l'equivalente JavaScript del decoratore @tool di Python. Si passano:
//   1. la funzione da eseguire;
//   2. name e description: il modello li legge per decidere QUANDO usare il tool, quindi vanno scritti bene;
//   3. schema: uno schema Zod per gli argomenti. LangChain lo trasforma in JSON Schema per il modello
//      e valida gli argomenti PRIMA di chiamare la funzione: se il modello sbaglia, la funzione non parte.
// Il valore restituito diventa un ToolMessage che il modello legge al giro successivo:
// per questo restituiamo JSON compatto e riassunti già calcolati, non liste lunghe da interpretare.

// Pezzi di schema riusati da più tool. .describe() finisce nel JSON Schema: è la "documentazione" per il modello.
const Giorno = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .describe("Giorno nel formato YYYY-MM-DD; ometti per oggi");
const Uccellino = z.enum(NOMI).optional().describe("Nome dell'uccellino; ometti per tutti");

const json = (valore: unknown) => JSON.stringify(valore);

export const eventiDelGiornoTool = tool(
  async ({ giorno = oggi(), uccellino }) => {
    const eps = episodi(await eventiDelGiorno(giorno, uccellino));
    if (!eps.length) return json({ giorno, episodi: [], nota: "Nessun evento affidabile in questo giorno." });
    return json({
      giorno,
      episodi: eps.slice(0, 60).map((e) => ({
        uccellino: e.uccellino,
        azione: e.azione,
        dalle: hhmm(e.dalle),
        alle: hhmm(e.alle),
        foto: e.foto,
        ...(e.oggetti.length > 0 && { con: e.oggetti }),
      })),
    });
  },
  {
    name: "eventi_del_giorno",
    description: "Cronologia di un giorno: cosa hanno fatto gli uccellini, a che ora e per quanto, raggruppato in episodi.",
    schema: z.object({ giorno: Giorno, uccellino: Uccellino }),
  },
);

export const contaEventiTool = tool(
  async ({ giorno = oggi(), uccellino, azione }) => {
    const eps = episodi(await eventiDelGiorno(giorno, uccellino)).filter((e) => !azione || e.azione === azione);
    // Un "volta" = un episodio, non una foto: 5 foto consecutive di Cippi che mangia sono un pasto solo.
    const conteggi = new Map<string, { uccellino: string; azione: string; volte: number; orari: string[] }>();
    for (const e of eps) {
      const chiave = `${e.uccellino}/${e.azione}`;
      const c = conteggi.get(chiave) ?? { uccellino: e.uccellino, azione: e.azione, volte: 0, orari: [] };
      c.volte++;
      c.orari.push(hhmm(e.dalle));
      conteggi.set(chiave, c);
    }
    return json({ giorno, conteggi: [...conteggi.values()] });
  },
  {
    name: "conta_eventi",
    description:
      "Quante volte (episodi) ogni uccellino ha fatto ogni azione in un giorno, con gli orari. Usalo per domande tipo 'quante volte'.",
    schema: z.object({ giorno: Giorno, uccellino: Uccellino, azione: z.enum(AZIONI).optional() }),
  },
);

export const cercaMomentiTool = tool(
  async ({ testo, uccellino, giorno }) => {
    // Ricerca ibrida: similarità semantica (pgvector) + filtri SQL su uccellino e giorno.
    const [vettore] = await embed([testo], "domanda");
    const risultati = await cercaSimili(vettore, 5, { uccellino, giorno });
    return json({
      risultati: risultati.map((r) => ({
        quando: giornoEOra(r.ora),
        uccellino: r.uccellino,
        azione: r.azione,
        incerto: r.confidenza < MIN_CONFIDENCE,
        descrizione: r.descrizione,
        similarita: Number(r.similarita.toFixed(2)),
      })),
    });
  },
  {
    name: "cerca_momenti",
    description:
      "Ricerca per significato nelle descrizioni delle foto (es. 'nascosto dietro il posatoio', 'vicino allo specchio'). Usalo quando la domanda non riguarda un'azione precisa.",
    schema: z.object({
      testo: z.string().min(1).describe("Cosa cercare, in italiano"),
      uccellino: Uccellino,
      giorno: Giorno,
    }),
  },
);

export const statoGabbiaTool = tool(
  async ({ giorno = oggi() }) => {
    const foto = await gabbiaDelGiorno(giorno);
    if (!foto.length) return json({ giorno, nota: "Nessuna foto in questo giorno." });

    // Riassunto già calcolato: un modello piccolo sbaglia se deve dedurlo da una lista lunga.
    const riassunto = (campo: "acqua" | "cibo" | "pulizia") => {
      const visibili = foto.filter((f) => f[campo] && f[campo] !== "non_visibile");
      const ultima = visibili.at(-1);
      const perLivello: Record<string, number> = {};
      for (const f of foto) if (f[campo]) perLivello[f[campo]!] = (perLivello[f[campo]!] ?? 0) + 1;
      return {
        ultimo_livello_visto: ultima ? `${ultima[campo]} alle ${hhmm(ultima.ora)}` : "mai visibile oggi",
        foto_per_livello: perLivello,
      };
    };
    return json({
      giorno,
      foto_analizzate: foto.length,
      acqua: riassunto("acqua"),
      cibo: riassunto("cibo"),
      pulizia: riassunto("pulizia"),
    });
  },
  {
    name: "stato_gabbia",
    description: "Livello di acqua e cibo e pulizia della gabbia: l'ultimo visto nel giorno e quante foto per livello.",
    schema: z.object({ giorno: Giorno }),
  },
);

export const STRUMENTI = [eventiDelGiornoTool, contaEventiTool, cercaMomentiTool, statoGabbiaTool];
