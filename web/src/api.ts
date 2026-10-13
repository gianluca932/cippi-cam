import { useEffect, useState } from "react";
import type { ChatApi } from "../../src/api-types";

export type { ChatApi, EventoApi, FotoApi, GiornoApi, UccellinoApi } from "../../src/api-types";

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

// Colori dei pallini: dal nome del colore in config/uccellini.json.
export const COLORE_CSS: Record<string, string> = {
  giallo: "#f2c94c",
  celeste: "#7cc7ef",
  verde: "#6fcf97",
  bianco: "#f2f2f2",
  grigio: "#9e9e9e",
  blu: "#2f80ed",
};

// "2026-10-12" → "lunedì 12 ottobre" (a mezzogiorno, per non slittare di fuso orario)
export const formatDay = (giorno: string) =>
  new Date(`${giorno}T12:00`).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });

export const formatOra = (iso: string) =>
  new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

// Oggi nel fuso del browser, come "YYYY-MM-DD".
export const oggi = () => new Date().toLocaleDateString("sv-SE");

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

export async function chiediAlDiario(domanda: string): Promise<ChatApi> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domanda }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// Carica una risorsa dell'API quando cambia il path.
export function useApi<T>(path: string) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });

  useEffect(() => {
    let attivo = true;
    setState({ loading: true });
    get<T>(path)
      .then((data) => attivo && setState({ data, loading: false }))
      .catch((e: Error) => attivo && setState({ error: e.message, loading: false }));
    return () => {
      attivo = false;
    };
  }, [path]);

  return state;
}
