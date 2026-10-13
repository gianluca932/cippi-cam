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

export type ChatApi = {
  risposta: string;
  fonti: { foto_id: number; ora: string; uccellino: string; similarita: number }[];
};
