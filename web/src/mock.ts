// Stesso contratto del classificatore: solo il tipo, niente Zod nel browser.
import type { CippiEvent } from "../../src/schema";

export type DiaryEntry = CippiEvent & {
  id: string;
  ora: string; // "HH:MM"
  foto?: string; // se manca, la galleria mostra un segnaposto
};

export const MIN_CONFIDENCE = 0.6; // come in src/schema.ts

// Diario finto di oggi. Il primo evento è quello vero, uscito da qwen3.5:9b.
export const diary: DiaryEntry[] = [
  {
    id: "1",
    ora: "08:12",
    azione: "riposa",
    confidenza: 0.95,
    descrizione: "Cippi è appollaiato su una struttura blu, ali chiuse, testa in avanti.",
    foto: "/photos/cippi.jpg",
  },
  { id: "2", ora: "09:30", azione: "mangia", confidenza: 0.88, descrizione: "Becca i semi dalla mangiatoia." },
  { id: "3", ora: "10:05", azione: "si_pulisce", confidenza: 0.81, descrizione: "Si sistema le piume dell'ala sinistra." },
  { id: "4", ora: "11:40", azione: "gioca", confidenza: 0.52, descrizione: "Forse tocca il campanellino, immagine mossa." },
  { id: "5", ora: "13:15", azione: "beve", confidenza: 0.9, descrizione: "Beve dall'abbeveratoio." },
  { id: "6", ora: "14:00", azione: "dorme", confidenza: 0.93, descrizione: "Pisolino su una zampa sola." },
  { id: "7", ora: "16:20", azione: "mangia", confidenza: 0.85, descrizione: "Mangia la foglia di insalata." },
  { id: "8", ora: "17:45", azione: "non_visibile", confidenza: 0.7, descrizione: "La gabbia è inquadrata ma Cippi non si vede." },
];

// Archivio finto: gli ultimi 7 giorni, ricavati rimescolando il diario di oggi.
export type ArchiveDay = { giorno: string; eventi: DiaryEntry[] };

export const archive: ArchiveDay[] = Array.from({ length: 7 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (i + 1));
  const giorno = d.toISOString().slice(0, 10);
  const eventi = diary
    .filter((_, j) => (j + i) % 3 !== 0) // ogni giorno qualche evento in meno
    .map((e, j) => ({
      ...e,
      id: `${giorno}-${j}`,
      foto: undefined,
      azione: diary[(j + i) % diary.length].azione,
      descrizione: diary[(j + i) % diary.length].descrizione,
    }));
  return { giorno, eventi };
});

// "2026-10-12" → "lunedì 12 ottobre" (a mezzogiorno, per non slittare di fuso orario)
export const formatDay = (giorno: string) =>
  new Date(`${giorno}T12:00`).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });

export const EMOJI: Record<CippiEvent["azione"], string> = {
  mangia: "🌾",
  beve: "💧",
  dorme: "😴",
  si_pulisce: "🪶",
  gioca: "🔔",
  vola: "🕊️",
  riposa: "🪵",
  non_visibile: "❓",
};

// Finto agente: stessa firma che avrà quello vero (domanda in, risposta out).
export async function askCippi(question: string): Promise<string> {
  await new Promise((r) => setTimeout(r, 700));
  const q = question.toLowerCase();
  const reliable = diary.filter((e) => e.confidenza >= MIN_CONFIDENCE);

  const find = (azione: CippiEvent["azione"]) => reliable.filter((e) => e.azione === azione);
  const orari = (es: DiaryEntry[]) => es.map((e) => e.ora).join(", ");

  if (q.includes("mangi")) {
    const es = find("mangia");
    return `Oggi Cippi ha mangiato ${es.length} volte: alle ${orari(es)}.`;
  }
  if (q.includes("dorm") || q.includes("riposa")) {
    const es = [...find("dorme"), ...find("riposa")];
    return `Ha dormito o riposato ${es.length} volte: alle ${orari(es)}.`;
  }
  if (q.includes("bev")) {
    const es = find("beve");
    return es.length ? `Ha bevuto alle ${orari(es)}.` : "Oggi non l'ho visto bere.";
  }

  const counts = new Map<string, number>();
  for (const e of reliable) counts.set(e.azione, (counts.get(e.azione) ?? 0) + 1);
  const summary = [...counts].map(([a, n]) => `${a.replace("_", " ")} ×${n}`).join(", ");
  const skipped = diary.length - reliable.length;
  return `Oggi ho ${reliable.length} eventi affidabili: ${summary}.` +
    (skipped ? ` Ne ho ignorati ${skipped} perché incerti.` : "");
}
