// In che lingua rispondere. La decide il codice, non il modello: con "rispondi nella lingua della domanda"
// nel prompt, Qwen3 235B rispondeva in italiano a domande inglesi sui giorni senza dati
// (eval/agente-en.json: 2 risposte su 14), trascinato dal prompt e dai dati dei tool, che sono in italiano.
//
// Basta contare le parole più comuni: le domande sono brevi, ma ne contengono sempre qualcuna.
// A parità vince l'italiano, la lingua del diario.

export type Lingua = "it" | "en";

const INGLESE = new Set(["the", "did", "does", "do", "what", "when", "how", "many", "was", "were", "is", "are", "and", "on", "at", "of", "any", "there", "today", "yesterday", "times", "while", "doing", "eat", "play", "water", "food"]);
const ITALIANO = new Set(["il", "lo", "la", "le", "gli", "che", "cosa", "quando", "quante", "volte", "ha", "hanno", "è", "di", "e", "del", "della", "alle", "oggi", "ieri", "mentre", "faceva", "mangiato", "giocato", "acqua", "cibo", "c'è"]);

export function linguaDi(testo: string): Lingua {
  const parole = testo.toLowerCase().match(/[a-zà-ù']+/g) ?? [];
  const en = parole.filter((p) => INGLESE.has(p)).length;
  const it = parole.filter((p) => ITALIANO.has(p)).length;
  return en > it ? "en" : "it";
}
