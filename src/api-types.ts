// Tipi delle risposte dell'API, condivisi con il frontend (web/).
// Solo tipi, niente codice: il browser li importa senza tirarsi dietro Node o Postgres.

export type UccellinoApi = { nome: string; colore: string };

export type EventoApi = {
  id: number;
  nome: string;
  colore: string;
  azione: string; // quella effettiva: la correzione umana se c'è, altrimenti il modello
  confidenza: number; // 1 se controllato da una persona
  azione_modello: string; // cosa aveva detto il modello
  confidenza_modello: number;
  azione_umana: string | null; // null = non controllato
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

// Eventi dello streaming della chat (SSE), nell'ordine in cui succedono.
export type EventoChat =
  | { tipo: "pensiero"; testo: string } // un pezzetto di ragionamento
  | { tipo: "passo"; passo: PassoTraccia } // un tool usato o un intervento del guardrail
  | { tipo: "testo"; testo: string } // un pezzetto della risposta
  | { tipo: "fine"; risposta: string; traccia: PassoTraccia[] } // la versione definitiva
  | { tipo: "errore"; messaggio: string };
