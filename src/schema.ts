import { z } from "zod";

// Il "contratto" tra il modello e il resto del codice.
// Se la risposta del modello non rispetta questo schema, viene scartata.
export const CippiEvent = z.object({
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
  descrizione: z.string().min(1),
});

export type CippiEvent = z.infer<typeof CippiEvent>;

// Sotto questa soglia l'evento non viene considerato affidabile.
export const MIN_CONFIDENCE = 0.6;
