import { readFileSync } from "node:fs";
import { z } from "zod";

// Chi vive nella gabbia: si configura in config/uccellini.json.
// Il modello riconosce solo il colore; il nome lo assegna il codice, così non può scambiarli.
const Uccellino = z.object({
  nome: z.string().min(1),
  colore: z.string().min(1),
});
export type Uccellino = z.infer<typeof Uccellino>;

const CONFIG_PATH = new URL("../config/uccellini.json", import.meta.url);

export const UCCELLINI = z
  .array(Uccellino)
  .min(1)
  .refine((us) => new Set(us.map((u) => u.nome)).size === us.length, { message: "Nomi duplicati" })
  // Per ora l'identità passa dal colore: due uccellini dello stesso colore richiederanno un altro criterio.
  .refine((us) => new Set(us.map((u) => u.colore)).size === us.length, { message: "Colori duplicati" })
  .parse(JSON.parse(readFileSync(CONFIG_PATH, "utf8")));

export const COLORI = UCCELLINI.map((u) => u.colore) as [string, ...string[]];

export function nomeDaColore(colore: string): string {
  const u = UCCELLINI.find((u) => u.colore === colore);
  if (!u) throw new Error(`Nessun uccellino ${colore} in config/uccellini.json`);
  return u.nome;
}
