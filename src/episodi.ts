import type { EventoDelGiorno } from "./db.js";
import { MIN_CONFIDENCE } from "./schema.js";

// Con una foto ogni 20 secondi, "Cippi mangia per 5 minuti" sono 15 eventi ma UN episodio.
// Qui uniamo gli eventi affidabili consecutivi con la stessa azione.

export type Episodio = {
  uccellino: string;
  azione: string;
  dalle: Date;
  alle: Date;
  foto: number;
  oggetti: string[]; // con cosa ha interagito durante l'episodio (es. "campanellino")
};

const PAUSA_MAX_MS = 2 * 60_000; // oltre 2 minuti senza foto, è un altro episodio

export function episodi(eventi: EventoDelGiorno[]): Episodio[] {
  const affidabili = eventi
    .filter((e) => e.confidenza >= MIN_CONFIDENCE && e.azione !== "non_visibile")
    .sort((a, b) => a.ora.getTime() - b.ora.getTime());

  const risultato: Episodio[] = [];
  const ultimoPer = new Map<string, Episodio>(); // l'episodio in corso di ogni uccellino

  for (const e of affidabili) {
    const corrente = ultimoPer.get(e.uccellino);
    const continua =
      corrente && corrente.azione === e.azione && e.ora.getTime() - corrente.alle.getTime() <= PAUSA_MAX_MS;

    const oggetto = e.con_cosa && e.con_cosa !== "niente" ? e.con_cosa.toLowerCase() : null;
    if (continua) {
      corrente.alle = e.ora;
      corrente.foto++;
      if (oggetto && !corrente.oggetti.includes(oggetto)) corrente.oggetti.push(oggetto);
    } else {
      const nuovo = { uccellino: e.uccellino, azione: e.azione, dalle: e.ora, alle: e.ora, foto: 1, oggetti: oggetto ? [oggetto] : [] };
      risultato.push(nuovo);
      ultimoPer.set(e.uccellino, nuovo);
    }
  }
  return risultato;
}
