import type { EventoDelGiorno, GabbiaInFoto } from "../db/db.js";
import { MIN_CONFIDENCE } from "../modelli/schema.js";

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

// --- Gabbia: periodi con lo stesso stato di acqua e cibo ---
// "Quando è mancata l'acqua?" ha bisogno degli orari, non dei conteggi: uniamo i controlli consecutivi
// con gli stessi livelli in un periodo, così la cronologia del giorno resta di poche righe.

export type PeriodoGabbia = { dalle: Date; alle: Date; acqua: string; cibo: string; controlli: number };

const PAUSA_GABBIA_MAX_MS = 60 * 60_000; // i controlli sono ogni ~20 minuti: oltre un'ora senza, è un altro periodo

export function periodiGabbia(controlli: GabbiaInFoto[]): PeriodoGabbia[] {
  const risultato: PeriodoGabbia[] = [];
  let corrente: PeriodoGabbia | undefined;
  for (const c of [...controlli].sort((a, b) => a.ora.getTime() - b.ora.getTime())) {
    // Un "non_visibile" non dice niente sul livello: si tiene quello di prima, così un controllo
    // in cui il contenitore era coperto non spezza il periodo in due.
    const acqua = c.acqua === "non_visibile" && corrente ? corrente.acqua : c.acqua;
    const cibo = c.cibo === "non_visibile" && corrente ? corrente.cibo : c.cibo;
    const continua =
      corrente && corrente.acqua === acqua && corrente.cibo === cibo && c.ora.getTime() - corrente.alle.getTime() <= PAUSA_GABBIA_MAX_MS;
    if (continua) {
      corrente!.alle = c.ora;
      corrente!.controlli++;
    } else {
      corrente = { dalle: c.ora, alle: c.ora, acqua, cibo, controlli: 1 };
      risultato.push(corrente);
    }
  }
  return risultato;
}

// --- Insieme: quando gli episodi di due uccellini si sovrappongono ---
// "Hanno giocato insieme?" non si deduce da due cronologie separate (il modello rispondeva una volta sì
// e una volta no): l'intersezione degli orari la calcola il codice.

export type MomentoInsieme = { dalle: Date; alle: Date; azioni: Record<string, string> };

export function momentiInsieme(eps: Episodio[], a: string, b: string): MomentoInsieme[] {
  const di = (nome: string) => eps.filter((e) => e.uccellino === nome);
  const risultato: MomentoInsieme[] = [];
  for (const ea of di(a)) {
    for (const eb of di(b)) {
      // Estremi inclusi: un episodio di una foto sola ha dalle = alle, e due uccellini nella stessa foto hanno la stessa ora.
      const dalle = Math.max(ea.dalle.getTime(), eb.dalle.getTime());
      const alle = Math.min(ea.alle.getTime(), eb.alle.getTime());
      if (dalle <= alle) risultato.push({ dalle: new Date(dalle), alle: new Date(alle), azioni: { [a]: ea.azione, [b]: eb.azione } });
    }
  }
  return risultato.sort((x, y) => x.dalle.getTime() - y.dalle.getTime());
}
