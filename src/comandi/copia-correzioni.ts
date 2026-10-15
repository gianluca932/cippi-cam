import { z } from "zod";
import { connessionePg } from "../db/connessione.js";
import { chiudi, copiaCorrezioneEvento, copiaCorrezioneGabbia, eventiPerEmbedding, salvaEmbedding } from "../db/db.js";
import { embed, textForEmbedding } from "../modelli/modelli.js";
import { AZIONI, LIVELLI } from "../modelli/schema.js";
import { c } from "../comune/terminale.js";

// Copia le correzioni fatte in galleria dal Postgres locale (Docker) a quello su AWS.
// Le foto sono le stesse (caricate con npm run carica), ma su AWS il modello le ha rianalizzate da zero:
// le previsioni restano quelle nuove, si copiano solo le colonne umane.
//
// Uso: npm run copia-correzioni   (lo script imposta DB_PROVIDER=rds e LLM_PROVIDER=bedrock)
//
// - Destinazione: db.ts, che con DB_PROVIDER=rds entra come "diario" con il token IAM.
// - Origine: DATABASE_LOCALE o il Postgres di Docker. Qui c'è SQL fuori da db.ts perché db.ts ha una connessione sola.
// - Le foto non ancora analizzate su AWS si saltano: si può rilanciare quando la coda ha finito.
// - Gli eventi corretti hanno l'embedding ricalcolato su Bedrock, come fa l'API: il testo contiene l'azione.

const locale = connessionePg({
  connectionString: process.env.DATABASE_LOCALE ?? "postgres://cippi:cippi@localhost:5432/cippi",
});

const RigaEvento = z.object({
  percorso: z.string(),
  uccellino: z.string(),
  azione_umana: z.enum(AZIONI),
  controllato_il: z.date(),
});
const Livello = z.enum(LIVELLI).nullable();
const RigaGabbia = z.object({
  percorso: z.string(),
  acqua_umana: Livello,
  cibo_umano: Livello,
  pulizia_umana: z.string().nullable(),
  gabbia_controllata_il: z.date().nullable(),
});

try {
  const eventi = z.array(RigaEvento).parse(
    (
      await locale.query(
        `SELECT f.percorso, e.uccellino, e.azione_umana, e.controllato_il
         FROM eventi e JOIN foto f ON f.id = e.foto_id
         WHERE e.azione_umana IS NOT NULL ORDER BY f.ora`,
      )
    ).rows,
  );
  const gabbie = z.array(RigaGabbia).parse(
    (
      await locale.query(
        `SELECT percorso, acqua_umana, cibo_umano, pulizia_umana, gabbia_controllata_il
         FROM foto WHERE COALESCE(acqua_umana, cibo_umano, pulizia_umana) IS NOT NULL ORDER BY ora`,
      )
    ).rows,
  );
  console.log(c.grigio(`In locale: ${eventi.length} azioni corrette, ${gabbie.length} foto con la gabbia controllata.`));

  const copiati: number[] = [];
  let mancanti = 0;
  for (const e of eventi) {
    const id = await copiaCorrezioneEvento(e.percorso, e.uccellino, e.azione_umana, e.controllato_il);
    if (id === null) mancanti++;
    else copiati.push(id);
  }
  let gabbieCopiate = 0;
  for (const g of gabbie) {
    const ok = await copiaCorrezioneGabbia(g.percorso, {
      acqua: g.acqua_umana,
      cibo: g.cibo_umano,
      pulizia: g.pulizia_umana,
      il: g.gabbia_controllata_il,
    });
    if (ok) gabbieCopiate++;
  }
  console.log(`${c.verde("✓")} azioni: ${copiati.length} copiate${mancanti ? c.grigio(`, ${mancanti} su foto non ancora analizzate`) : ""}`);
  console.log(`${c.verde("✓")} gabbia: ${gabbieCopiate}/${gabbie.length} foto`);

  // Embedding degli eventi corretti, a blocchi. Titan fa un testo per richiesta e LangChain le manda tutte insieme:
  // con blocchi da 20 Bedrock rispondeva "Too many requests" (poi riusciva riprovando). Con 5 non succede.
  const BLOCCO = 5;
  for (let i = 0; i < copiati.length; i += BLOCCO) {
    const blocco = (await Promise.all(copiati.slice(i, i + BLOCCO).map((id) => eventiPerEmbedding(id)))).flat();
    const vettori = await embed(
      blocco.map((e) => textForEmbedding(e, e.scena)),
      "documento",
    );
    for (const [j, e] of blocco.entries()) await salvaEmbedding(e.id, vettori[j]);
  }
  if (copiati.length) console.log(`${c.verde("✓")} embedding ricalcolati: ${copiati.length}`);
} finally {
  await locale.chiudi();
  await chiudi();
}
