import { tool } from "langchain";
import { z } from "zod";
import { cercaSimili, eventiDelGiorno, gabbiaDelGiorno } from "../db/db.js";
import { episodi, momentiInsieme, periodiGabbia, type MomentoInsieme, type PeriodoGabbia } from "./episodi.js";
import { embed } from "../modelli/modelli.js";
import { AZIONI, MIN_CONFIDENCE } from "../modelli/schema.js";
import { NOMI } from "../comune/uccellini.js";
import { giornoEOra, hhmm, oggi } from "./orari.js";

// I cinque tool dell'agente.
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
const Ora = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .optional()
  .describe("Ora HH:MM per domande su un momento preciso (es. \"alle 16:26\"); ometti per tutto il giorno");

const json = (valore: unknown) => JSON.stringify(valore);


// Gli intervalli in cui vale una condizione (es. "acqua da rifornire"), unendo i periodi consecutivi.
function intervalli(periodi: PeriodoGabbia[], vale: (p: PeriodoGabbia) => boolean): string[] {
  const uniti: { dalle: Date; alle: Date }[] = [];
  let precedenteVale = false;
  for (const p of periodi) {
    if (vale(p)) {
      if (precedenteVale) uniti.at(-1)!.alle = p.alle;
      else uniti.push({ dalle: p.dalle, alle: p.alle });
    }
    precedenteVale = vale(p);
  }
  return uniti.map((i) => (hhmm(i.dalle) === hhmm(i.alle) ? hhmm(i.dalle) : `${hhmm(i.dalle)}–${hhmm(i.alle)}`));
}

// I "quando" della gabbia, già calcolati. Nomi che non si possono fraintendere: con
// "acqua_da_rifornire: 16:17–16:30" il modello capiva "in quegli orari la stavano rifornendo".
const scarso = (l: string) => l === "da_rifornire";
const gabbiaScarsa = (periodi: PeriodoGabbia[]) => ({
  acqua_scarsa: intervalli(periodi, (p) => scarso(p.acqua)),
  cibo_scarso: intervalli(periodi, (p) => scarso(p.cibo)),
  acqua_e_cibo_scarsi_insieme: intervalli(periodi, (p) => scarso(p.acqua) && scarso(p.cibo)),
});

// "Cosa succedeva alle 16:26?": il confronto tra orari lo fa il codice, non il modello.
// (Con la cronologia intera il modello sceglieva il periodo sbagliato: 16:26 non è "dentro" 16:17–16:22.)
// Gli orari "HH:MM" dello stesso giorno si confrontano anche come stringhe.
const dentro = (ora: string, dalle: Date, alle: Date) => hhmm(dalle) <= ora && ora <= hhmm(alle);

// La gabbia a un'ora: il periodo che la contiene, altrimenti l'ultimo controllo prima.
function gabbiaAlle(ora: string, periodi: PeriodoGabbia[]) {
  const periodo = periodi.find((p) => dentro(ora, p.dalle, p.alle)) ?? periodi.filter((p) => hhmm(p.alle) <= ora).at(-1);
  return periodo
    ? { acqua: periodo.acqua, cibo: periodo.cibo, controllata: `${hhmm(periodo.dalle)}–${hhmm(periodo.alle)}` }
    : "nessun controllo prima di quest'ora";
}

function momento(ora: string, eps: ReturnType<typeof episodi>, periodi: PeriodoGabbia[]) {
  const uccellini = eps
    .filter((e) => dentro(ora, e.dalle, e.alle))
    .map((e) => ({ uccellino: e.uccellino, azione: e.azione, dalle: hhmm(e.dalle), alle: hhmm(e.alle) }));
  return {
    ora,
    uccellini: uccellini.length ? uccellini : "nessun evento affidabile a quest'ora",
    gabbia: gabbiaAlle(ora, periodi),
  };
}

export const eventiDelGiornoTool = tool(
  async ({ giorno = oggi(), uccellino, ora }) => {
    const eps = episodi(await eventiDelGiorno(giorno, uccellino));
    const periodi = periodiGabbia(await gabbiaDelGiorno(giorno));
    if (ora) return json({ giorno, ...momento(ora, eps, periodi) });
    // Solo gli intervalli, non la cronologia intera: con tutti i periodi in coda agli episodi
    // il modello rispondeva "il cibo c'era sempre" anche se era scarso dalle 16:23 alle 16:36.
    const gabbia = gabbiaScarsa(periodi);
    if (!eps.length) return json({ giorno, episodi: [], gabbia, nota: "Nessun evento affidabile in questo giorno." });
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
      gabbia,
    });
  },
  {
    name: "eventi_del_giorno",
    description:
      "Cronologia di un giorno: cosa hanno fatto gli uccellini, a che ora e per quanto (episodi), e quando acqua o cibo erano scarsi. Con \"ora\" restituisce solo quel momento.",
    schema: z.object({
      giorno: Giorno,
      uccellino: Uccellino,
      ora: Ora,
    }),
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
  async ({ giorno = oggi(), ora }) => {
    const foto = await gabbiaDelGiorno(giorno);
    // La gabbia non si controlla a ogni foto ma ogni ~20 minuti: qui ci sono solo i controlli.
    if (!foto.length) return json({ giorno, nota: "Nessun controllo della gabbia in questo giorno." });

    // Riassunto già calcolato: un modello piccolo sbaglia se deve dedurlo da una lista lunga.
    const riassunto = (campo: "acqua" | "cibo") => {
      const visibili = foto.filter((f) => f[campo] && f[campo] !== "non_visibile");
      const ultima = visibili.at(-1);
      const perLivello: Record<string, number> = {};
      for (const f of foto) if (f[campo]) perLivello[f[campo]!] = (perLivello[f[campo]!] ?? 0) + 1;
      return {
        ultimo_livello_visto: ultima ? `${ultima[campo]} alle ${hhmm(ultima.ora)}` : "mai visibile oggi",
        controlli_per_livello: perLivello,
      };
    };
    // I "quando": gli intervalli già calcolati, così il modello non deve dedurli dai conteggi.
    const periodi = periodiGabbia(foto);
    if (ora) return json({ giorno, ora, gabbia: gabbiaAlle(ora, periodi) });
    return json({
      giorno,
      ...gabbiaScarsa(periodi),
      controlli: foto.length,
      ultimo_controllo: hhmm(foto.at(-1)!.ora),
      acqua: riassunto("acqua"),
      cibo: riassunto("cibo"),
    });
  },
  {
    name: "stato_gabbia",
    description:
      "Acqua e cibo nella gabbia: l'ultimo controllo (con l'ora) e QUANDO erano scarsi, cioè bassi o finiti e da riempire (intervalli di orari, anche tutti e due insieme). Con \"ora\" restituisce com'era la gabbia in quel momento.",
    schema: z.object({ giorno: Giorno, ora: Ora }),
  },
);

export const momentiInsiemeTool = tool(
  async ({ giorno = oggi(), azione }) => {
    const [a, b] = NOMI;
    const tutti = momentiInsieme(episodi(await eventiDelGiorno(giorno)), a, b);
    // Con "azione": solo i momenti in cui la fanno TUTTI E DUE (es. "hanno giocato insieme?").
    const momenti = azione ? tutti.filter((m) => m.azioni[a] === azione && m.azioni[b] === azione) : tutti;
    const orario = (m: MomentoInsieme) => (hhmm(m.dalle) === hhmm(m.alle) ? hhmm(m.dalle) : `${hhmm(m.dalle)}–${hhmm(m.alle)}`);
    // Raggruppati per coppia di azioni ("Cippi mangia, Sky dorme"): riassunto già calcolato, non una lista lunga.
    const gruppi = new Map<string, { [nome: string]: string | number | string[] }>();
    for (const m of momenti) {
      const chiave = `${m.azioni[a]}/${m.azioni[b]}`;
      const g = gruppi.get(chiave) ?? { [a]: m.azioni[a], [b]: m.azioni[b], volte: 0, orari: [] as string[] };
      g.volte = (g.volte as number) + 1;
      (g.orari as string[]).push(orario(m));
      gruppi.set(chiave, g);
    }
    if (!gruppi.size)
      return json({ giorno, azione, insieme: [], nota: azione ? `Mai tutti e due "${azione}" nello stesso momento.` : "Nessun momento con tutti e due visibili." });
    return json({ giorno, ...(azione && { azione }), insieme: [...gruppi.values()].map((g) => ({ ...g, orari: (g.orari as string[]).slice(0, 10) })) });
  },
  {
    name: "momenti_insieme",
    description: `Cosa facevano ${NOMI.join(" e ")} NELLO STESSO MOMENTO, con gli orari. Con "azione" restituisce solo quando la facevano tutti e due (es. "hanno giocato insieme?", "mangiano insieme?").`,
    schema: z.object({ giorno: Giorno, azione: z.enum(AZIONI).optional().describe("Azione fatta da tutti e due; ometti per tutte") }),
  },
);

export const STRUMENTI = [eventiDelGiornoTool, contaEventiTool, cercaMomentiTool, statoGabbiaTool, momentiInsiemeTool];
