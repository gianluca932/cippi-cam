import { z } from "zod";
import { COLORI } from "./uccellini.js";

// Il "contratto" tra il modello e il resto del codice.
// Se la risposta del modello non rispetta questo schema, viene scartata.
// I colori ammessi arrivano da config/uccellini.json; il nome lo assegna il codice.
//
// L'ordine dei campi conta: con l'output strutturato il modello li scrive in quest'ordine.
// Prima osserva (posizione, postura, descrizione), poi classifica (azione, confidenza).

export const EventoUccellino = z.object({
  colore: z.enum(COLORI),
  posizione: z.string().min(1),
  postura: z.string().min(1),
  oggetti_vicini: z.array(z.string()),
  descrizione: z.string().min(1),
  azione: z.enum([
    "mangia",
    "beve",
    "dorme",
    "si_pulisce",
    "gioca",
    "vola",
    "riposa",
    "non_visibile",
  ]),
  confidenza: z.number().min(0).max(1),
});

export const LIVELLI = ["abbondante", "sufficiente", "scarso", "vuoto", "non_visibile"] as const;
export const LIVELLI_ALLARME: readonly Livello[] = ["scarso", "vuoto"];

// Lo stato della gabbia: riguarda la foto, non il singolo uccellino.
export const StatoGabbia = z.object({
  note: z.string(), // cosa si vede di abbeveratoio e mangiatoia
  acqua: z.enum(LIVELLI),
  cibo: z.enum(LIVELLI),
});

export const AnalisiFoto = z
  .object({
    scena: z.string().min(1),
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
