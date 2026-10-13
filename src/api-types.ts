// Tipi delle risposte dell'API, condivisi con il frontend (web/).
// Solo tipi, niente codice: il browser li importa senza tirarsi dietro Node o Postgres.

export type UccellinoApi = { nome: string; colore: string };

export type EventoApi = {
  nome: string;
  colore: string;
  azione: string;
  confidenza: number;
  descrizione: string;
  posizione: string;
  postura: string;
  oggetti_vicini: string[];
};

export type FotoApi = {
  id: number;
  ora: string; // ISO
  scena: string;
  acqua: string;
  cibo: string;
  note_gabbia: string;
  eventi: EventoApi[];
};

export type GiornoApi = {
  giorno: string; // "2026-10-13"
  foto: number;
  eventi_affidabili: number;
  azioni: string[]; // azioni affidabili in ordine di tempo
};

// Cosa ha fatto l'agente prima di rispondere, in ordine: si mostra in grigio sopra la risposta.
export type PassoTraccia =
  | { tipo: "pensiero"; testo: string } // il ragionamento del modello, quando c'è
  | { tipo: "tool"; nome: string; argomenti: Record<string, unknown>; risultato: string; errore?: string }
  | { tipo: "guardrail"; testo: string }; // un intervento del codice sul modello

export type ChatApi = {
  risposta: string;
  traccia: PassoTraccia[];
};
