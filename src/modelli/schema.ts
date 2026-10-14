import { z } from "zod";
import { COLORI } from "../comune/uccellini.js";

// Il "contratto" tra il modello e il resto del codice.
// Se la risposta del modello non rispetta questo schema, viene scartata.
// I colori ammessi arrivano da config/uccellini.json; il nome lo assegna il codice.
//
// L'ordine dei campi conta: con l'output strutturato il modello li scrive in quest'ordine.
// Prima osserva (posizione, postura, descrizione), poi classifica (azione, confidenza).

export const AZIONI = [
  "mangia",
  "beve",
  "dorme",
  "si_pulisce",
  "gioca",
  "vola",
  "riposa",
  "non_visibile",
] as const;
export type Azione = (typeof AZIONI)[number];

// I .max() finiscono nel JSON Schema e quindi nella grammatica di Ollama: il modello NON può
// superarli. È il modo per avere testi concreti senza allungare i tempi (ogni token costa ~50ms).
export const EventoUccellino = z.object({
  colore: z.enum(COLORI),
  posizione: z.string().min(1).max(50),
  postura: z.string().min(1).max(60),
  // L'oggetto con cui interagisce (campanellino, mangiatoia, specchio…) o "niente".
  // Viene prima di azione: vedere l'oggetto aiuta a scegliere l'azione giusta.
  con_cosa: z.string().min(1).max(30),
  oggetti_vicini: z.array(z.string().max(25)).max(3),
  descrizione: z.string().min(1).max(120),
  azione: z.enum(AZIONI),
  confidenza: z.number().min(0).max(1),
});

// Pochi livelli, legati a una decisione: per acqua e cibo "rabbocco o no".
// (La pulizia della gabbia è stata tolta: dalle foto non si riusciva a giudicarla. Le colonne nel DB restano.)
// "da_rifornire" comprende sia "sta finendo" che "è finita": l'avviso deve arrivare PRIMA che manchi l'acqua.
// Meno classi = etichette più coerenti e meno esempi necessari per un futuro classificatore.
export const LIVELLI = ["ok", "da_rifornire", "non_visibile"] as const;
export const LIVELLI_ALLARME: readonly Livello[] = ["da_rifornire"];

// Lo stato della gabbia: riguarda la foto, non il singolo uccellino.
// Gli enum costano 2-3 token l'uno: informazioni utili quasi gratis.
export const StatoGabbia = z.object({
  note: z.string().max(80), // cosa si vede di abbeveratoio, mangiatoia e fondo
  acqua: z.enum(LIVELLI),
  cibo: z.enum(LIVELLI),
});

export const AnalisiFoto = z
  .object({
    scena: z.string().min(1).max(100),
    gabbia: StatoGabbia,
    uccellini: z.array(EventoUccellino).length(COLORI.length),
  })
  // Non finisce nel JSON Schema per Ollama: è un controllo in più dopo la risposta.
  .refine((a) => new Set(a.uccellini.map((u) => u.colore)).size === COLORI.length, {
    message: "Serve esattamente un elemento per ogni colore",
  });

export type Livello = (typeof LIVELLI)[number];
export type EventoUccellino = z.infer<typeof EventoUccellino>;
export type AnalisiFoto = z.infer<typeof AnalisiFoto>;

// Sotto questa soglia l'evento non viene considerato affidabile.
export const MIN_CONFIDENCE = 0.6;
