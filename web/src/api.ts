import { useEffect, useState } from "react";
import type { ChatApi, EventoChat, StatoRegistrazione } from "../../src/comune/api-types";

export type { ChatApi, EventoApi, EventoChat, FotoApi, GiornoApi, PassoTraccia, ScattoApi, StatoRegistrazione, UccellinoApi } from "../../src/comune/api-types";

export const MIN_CONFIDENCE = 0.6; // come in src/schema.ts

export const EMOJI: Record<string, string> = {
  mangia: "🌾",
  beve: "💧",
  dorme: "😴",
  si_pulisce: "🪶",
  gioca: "🔔",
  vola: "🕊️",
  riposa: "🪵",
  non_visibile: "❓",
};

export const AZIONI = Object.keys(EMOJI); // come AZIONI in src/schema.ts

// L'interfaccia è in inglese; nel database e nell'API i valori restano quelli dello schema (in italiano).
export const NOME_AZIONE: Record<string, string> = {
  mangia: "eating",
  beve: "drinking",
  dorme: "sleeping",
  si_pulisce: "preening",
  gioca: "playing",
  vola: "flying",
  riposa: "resting",
  non_visibile: "not visible",
};
export const nomeAzione = (azione: string) => NOME_AZIONE[azione] ?? azione.replace("_", " ");

export const NOME_LIVELLO: Record<string, string> = { ok: "ok", da_rifornire: "refill", non_visibile: "not seen" };
export const nomeLivello = (livello: string) => NOME_LIVELLO[livello] ?? livello.replace("_", " ");

// Colori dei pallini: dal nome del colore in config/uccellini.json.
export const COLORE_CSS: Record<string, string> = {
  giallo: "#f2c94c",
  celeste: "#7cc7ef",
  verde: "#6fcf97",
  bianco: "#f2f2f2",
  grigio: "#9e9e9e",
  blu: "#2f80ed",
};

// "2026-10-12" → "Monday 12 October" (a mezzogiorno, per non slittare di fuso orario)
export const formatDay = (giorno: string) =>
  new Date(`${giorno}T12:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

// en-GB: orari a 24 ore ("16:43"), come nelle risposte dell'agente.
export const formatOra = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

// Oggi nel fuso del browser, come "YYYY-MM-DD".
export const oggi = () => new Date().toLocaleDateString("sv-SE");

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

export type TurnoChat = { ruolo: "utente" | "assistente"; testo: string };

export async function chiediAlDiario(domanda: string, storia: TurnoChat[] = []): Promise<ChatApi> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domanda, storia }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// Correzioni dalla galleria.
async function invia(method: string, path: string, body?: unknown) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}
export const correggiAzione = (id: number, azione: string) => invia("PATCH", `/eventi/${id}`, { azione });
export const annullaCorrezione = (id: number) => invia("DELETE", `/eventi/${id}/correzione`);
// Gabbia: solo i campi passati; null = annulla la correzione di quel campo.
export const correggiGabbia = (fotoId: number, valori: Partial<Record<"acqua" | "cibo", string | null>>) =>
  invia("PATCH", `/foto/${fotoId}/gabbia`, valori);

// Registrazione dalla pagina Live.
async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const dati = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(dati.errore ?? `${res.status}`);
  return dati;
}
export const avviaRegistrazione = (opzioni: { ogniSec: number; durataMin: number; analizza: boolean; camera: string }) =>
  post<StatoRegistrazione>("/registrazione/avvia", opzioni);
export const fermaRegistrazione = () => post<StatoRegistrazione>("/registrazione/ferma");

// Chat in streaming: legge gli eventi SSE man mano che il server li manda.
// EventSource del browser funziona solo in GET, quindi leggiamo lo stream a mano con fetch.
export async function chiediInStreaming(domanda: string, storia: TurnoChat[], onEvento: (e: EventoChat) => void) {
  const res = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domanda, storia }),
  });
  if (!res.ok || !res.body) throw new Error(`${res.status} ${await res.text()}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Ogni evento SSE finisce con una riga vuota; il contenuto sta nelle righe "data: ...".
    const eventi = buffer.split("\n\n");
    buffer = eventi.pop()!;
    for (const evento of eventi) {
      const data = evento
        .split("\n")
        .filter((r) => r.startsWith("data:"))
        .map((r) => r.slice(5).trim())
        .join("\n");
      if (data) onEvento(JSON.parse(data));
    }
  }
}

// Carica una risorsa dell'API quando cambia il path.
// path null = "non ancora": resta in caricamento senza chiamare l'API (serve quando il percorso dipende da un'altra risposta).
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });

  useEffect(() => {
    let attivo = true;
    setState({ loading: true });
    if (path === null) return;
    get<T>(path)
      .then((data) => attivo && setState({ data, loading: false }))
      .catch((e: Error) => attivo && setState({ error: e.message, loading: false }));
    return () => {
      attivo = false;
    };
  }, [path]);

  return state;
}
