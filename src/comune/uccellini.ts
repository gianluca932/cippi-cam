import { z } from "zod";
// Import del JSON (non lettura da disco): così finisce anche dentro il pacchetto delle Lambda.
import config from "../../config/uccellini.json" with { type: "json" };

// Chi vive nella gabbia: si configura in config/uccellini.json.
// Il modello riconosce solo il colore; il nome lo assegna il codice, così non può scambiarli.
const Uccellino = z.object({
  nome: z.string().min(1),
  colore: z.string().min(1),
});
export type Uccellino = z.infer<typeof Uccellino>;

export const UCCELLINI = z
  .array(Uccellino)
  .min(1)
  .refine((us) => new Set(us.map((u) => u.nome)).size === us.length, { message: "Nomi duplicati" })
  // Per ora l'identità passa dal colore: due uccellini dello stesso colore richiederanno un altro criterio.
  .refine((us) => new Set(us.map((u) => u.colore)).size === us.length, { message: "Colori duplicati" })
  .parse(config);

export const COLORI = UCCELLINI.map((u) => u.colore) as [string, ...string[]];
export const NOMI = UCCELLINI.map((u) => u.nome) as [string, ...string[]];

export function nomeDaColore(colore: string): string {
  const u = UCCELLINI.find((u) => u.colore === colore);
  if (!u) throw new Error(`Nessun uccellino ${colore} in config/uccellini.json`);
  return u.nome;
}
