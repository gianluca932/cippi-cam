import "./env.js"; // per primo: carica .env prima che gli altri moduli leggano process.env
import pg from "pg";
import type { FotoApi, GiornoApi, UccellinoApi } from "./api-types.js";
import {
  MIN_CONFIDENCE,
  type AnalisiFoto,
  type Azione,
  type EventoUccellino,
  type Livello,
} from "./schema.js";
import { nomeDaColore, UCCELLINI } from "./uccellini.js";

// Tutte le query stanno qui: il resto del codice non sa che sotto c'è Postgres.
const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://cippi:cippi@localhost:5432/cippi",
});

// pgvector accetta i vettori come stringa "[0.1,0.2,...]".
const toVector = (v: number[]) => `[${v.join(",")}]`;

// Allinea la tabella uccellini a config/uccellini.json (aggiunge o aggiorna, non cancella).
export async function sincronizzaUccellini() {
  for (const u of UCCELLINI) {
    await pool.query(
      `INSERT INTO uccellini (nome, colore) VALUES ($1, $2)
       ON CONFLICT (nome) DO UPDATE SET colore = EXCLUDED.colore`,
      [u.nome, u.colore],
    );
  }
}

export async function fotoEsiste(percorso: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    "SELECT 1 FROM foto WHERE percorso = $1",
    [percorso],
  );
  return (rowCount ?? 0) > 0;
}

// Salva la foto e un evento per ogni uccellino, tutto o niente.
export async function salvaAnalisi(
  analisi: AnalisiFoto,
  percorso: string,
  ora: Date, // quando è stata scattata, non quando è stata analizzata
  modello: string,
  embeddings: number[][], // uno per uccellino, nello stesso ordine
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO foto (percorso, ora, modello, scena, acqua, cibo, note_gabbia)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        percorso,
        ora,
        modello,
        analisi.scena,
        analisi.gabbia.acqua,
        analisi.gabbia.cibo,
        analisi.gabbia.note,
      ],
    );
    const fotoId = rows[0].id;

    for (const [i, u] of analisi.uccellini.entries()) {
      await client.query(
        `INSERT INTO eventi
           (foto_id, uccellino, azione, confidenza, descrizione, posizione, oggetti_vicini, postura, embedding_testo, con_cosa)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          fotoId,
          nomeDaColore(u.colore),
          u.azione,
          u.confidenza,
          u.descrizione,
          u.posizione,
          u.oggetti_vicini,
          u.postura,
          toVector(embeddings[i]),
          u.con_cosa,
        ],
      );
    }
    await client.query("COMMIT");
    return fotoId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export type RisultatoRicerca = {
  foto_id: number;
  ora: Date;
  uccellino: string;
  azione: string;
  confidenza: number;
  descrizione: string;
  similarita: number; // 1 = identico, 0 = niente in comune
};

// I "giorni" si contano nel fuso orario di casa, non in UTC.
const FUSO = "Europe/Rome";

// Ricerca ibrida: similarità semantica (pgvector) + filtri SQL opzionali su uccellino e giorno.
export async function cercaSimili(
  embeddingDomanda: number[],
  limite = 5,
  filtri: { uccellino?: string; giorno?: string } = {},
): Promise<RisultatoRicerca[]> {
  const { rows } = await pool.query<RisultatoRicerca>(
    `SELECT e.foto_id, f.ora, e.uccellino, e.azione, e.confidenza, e.descrizione,
            1 - (e.embedding_testo <=> $1) AS similarita
     FROM eventi_effettivi e JOIN foto f ON f.id = e.foto_id
     WHERE ($3::text IS NULL OR e.uccellino = $3)
       AND ($4::date IS NULL OR (f.ora AT TIME ZONE $5)::date = $4::date)
     ORDER BY e.embedding_testo <=> $1
     LIMIT $2`,
    [toVector(embeddingDomanda), limite, filtri.uccellino ?? null, filtri.giorno ?? null, FUSO],
  );
  return rows;
}

export type EventoDelGiorno = {
  ora: Date;
  uccellino: string;
  azione: string;
  con_cosa: string | null; // null nelle foto importate prima di questo campo
  confidenza: number;
  descrizione: string;
};

// Tutti gli eventi di un giorno in ordine di tempo (gli incerti li scarta chi li usa).
export async function eventiDelGiorno(giorno: string, uccellino?: string): Promise<EventoDelGiorno[]> {
  const { rows } = await pool.query<EventoDelGiorno>(
    `SELECT f.ora, e.uccellino, e.azione, e.con_cosa, e.confidenza, e.descrizione
     FROM eventi_effettivi e JOIN foto f ON f.id = e.foto_id
     WHERE (f.ora AT TIME ZONE $1)::date = $2::date
       AND ($3::text IS NULL OR e.uccellino = $3)
     ORDER BY f.ora, e.uccellino`,
    [FUSO, giorno, uccellino ?? null],
  );
  return rows;
}

export type GabbiaInFoto = { ora: Date; acqua: string; cibo: string; note: string };

// Acqua e cibo in tutte le foto di un giorno, in ordine di tempo.
export async function gabbiaDelGiorno(giorno: string): Promise<GabbiaInFoto[]> {
  const { rows } = await pool.query<GabbiaInFoto>(
    `SELECT ora, acqua, cibo, note_gabbia AS note FROM foto_effettive
     WHERE (ora AT TIME ZONE $1)::date = $2::date
     ORDER BY ora`,
    [FUSO, giorno],
  );
  return rows;
}

export async function elencoUccellini(): Promise<UccellinoApi[]> {
  const { rows } = await pool.query<UccellinoApi>(
    "SELECT nome, colore FROM uccellini ORDER BY nome",
  );
  return rows;
}

export async function elencoGiorni(): Promise<GiornoApi[]> {
  const { rows } = await pool.query<GiornoApi>(
    `SELECT to_char((f.ora AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS giorno,
            COUNT(DISTINCT f.id)::int AS foto,
            COUNT(e.id) FILTER (WHERE e.confidenza >= $2 AND e.azione <> 'non_visibile')::int AS eventi_affidabili,
            COALESCE(array_agg(e.azione ORDER BY f.ora)
              FILTER (WHERE e.confidenza >= $2 AND e.azione <> 'non_visibile'), '{}') AS azioni
     FROM foto f LEFT JOIN eventi_effettivi e ON e.foto_id = f.id
     GROUP BY 1 ORDER BY 1 DESC`,
    [FUSO, MIN_CONFIDENCE],
  );
  return rows;
}

export async function fotoDelGiorno(giorno: string): Promise<FotoApi[]> {
  const { rows } = await pool.query<FotoApi>(
    `SELECT f.id, f.ora, f.scena, f.acqua, f.cibo, f.note_gabbia,
            f.acqua_modello, f.cibo_modello, f.acqua_umana, f.cibo_umano,
            json_agg(json_build_object(
              'id', e.id, 'nome', e.uccellino, 'colore', u.colore, 'azione', e.azione, 'confidenza', e.confidenza,
              'azione_modello', e.azione_modello, 'confidenza_modello', e.confidenza_modello,
              'azione_umana', e.azione_umana,
              'descrizione', e.descrizione, 'posizione', e.posizione, 'postura', e.postura, 'con_cosa', e.con_cosa,
              'oggetti_vicini', e.oggetti_vicini
            ) ORDER BY e.uccellino) AS eventi
     FROM foto_effettive f
     JOIN eventi_effettivi e ON e.foto_id = f.id
     JOIN uccellini u ON u.nome = e.uccellino
     WHERE (f.ora AT TIME ZONE $1)::date = $2::date
     -- Una vista non ha chiave primaria: Postgres vuole tutte le colonne non aggregate nel GROUP BY.
     GROUP BY f.id, f.ora, f.scena, f.acqua, f.cibo, f.note_gabbia,
              f.acqua_modello, f.cibo_modello, f.acqua_umana, f.cibo_umano
     ORDER BY f.ora DESC`,
    [FUSO, giorno],
  );
  return rows;
}

export async function percorsoFoto(id: number): Promise<string | undefined> {
  const { rows } = await pool.query<{ percorso: string }>(
    "SELECT percorso FROM foto WHERE id = $1",
    [id],
  );
  return rows[0]?.percorso;
}

// Gli eventi (tutti, o uno solo) con i campi da cui si ricostruisce il testo dell'embedding.
// L'azione è quella effettiva: se una persona l'ha corretta, l'embedding deve dire quella.
export async function eventiPerEmbedding(id?: number) {
  const { rows } = await pool.query<
    EventoUccellino & {
      id: number;
      percorso: string;
      uccellino: string;
      scena: string;
    }
  >(
    `SELECT e.id, f.percorso, f.scena, e.uccellino, u.colore, e.azione, e.confidenza,
            e.descrizione, e.posizione, e.oggetti_vicini, e.postura, e.con_cosa
     FROM eventi_effettivi e JOIN foto f ON f.id = e.foto_id JOIN uccellini u ON u.nome = e.uccellino
     WHERE ($1::int IS NULL OR e.id = $1)
     ORDER BY e.id`,
    [id ?? null],
  );
  return rows;
}

// Correzione (o conferma) umana di un evento; azione = null la annulla.
// Prima si aggiorna l'azione, poi chi chiama ricalcola l'embedding e lo salva con salvaEmbedding.
export async function correggiEvento(id: number, azione: Azione | null): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE eventi
     SET azione_umana = $2, controllato_il = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END
     WHERE id = $1`,
    [id, azione],
  );
  return (rowCount ?? 0) > 0;
}

export async function salvaEmbedding(id: number, embedding: number[]) {
  await pool.query("UPDATE eventi SET embedding_testo = $2 WHERE id = $1", [id, toVector(embedding)]);
}

export type CorrezioneGabbia = {
  acqua?: Livello | null; // null = annulla la correzione, torna valido il modello
  cibo?: Livello | null;
};

// Correzione (o conferma) umana dello stato della gabbia di una foto. Si aggiornano solo i campi passati.
export async function correggiGabbia(fotoId: number, valori: CorrezioneGabbia): Promise<boolean> {
  const campi = { acqua: "acqua_umana", cibo: "cibo_umano" } as const;
  const set: string[] = [];
  const parametri: unknown[] = [fotoId];
  for (const [chiave, colonna] of Object.entries(campi)) {
    const valore = valori[chiave as keyof CorrezioneGabbia];
    if (valore === undefined) continue;
    parametri.push(valore);
    set.push(`${colonna} = $${parametri.length}`); // i nomi delle colonne vengono dalla nostra lista, mai dall'utente
  }
  if (!set.length) return false;
  const { rowCount } = await pool.query(`UPDATE foto SET ${set.join(", ")} WHERE id = $1`, parametri);
  // In un UPDATE le colonne citate nel SET hanno ancora il valore VECCHIO: la data di controllo
  // si calcola quindi dopo, sui valori appena salvati.
  await pool.query(
    `UPDATE foto SET gabbia_controllata_il =
       CASE WHEN COALESCE(acqua_umana, cibo_umano) IS NULL THEN NULL ELSE now() END
     WHERE id = $1`,
    [fotoId],
  );
  return (rowCount ?? 0) > 0;
}

export type EtichettaGabbia = {
  percorso: string;
  acqua_modello: string; acqua_umana: string | null;
  cibo_modello: string; cibo_umano: string | null;
};

// Le foto in cui hai controllato almeno un campo della gabbia: le etichette per valutare il modello.
export async function etichetteGabbia(): Promise<EtichettaGabbia[]> {
  const { rows } = await pool.query<EtichettaGabbia>(
    `SELECT percorso, acqua_modello, acqua_umana, cibo_modello, cibo_umano
     FROM foto_effettive
     WHERE COALESCE(acqua_umana, cibo_umano) IS NOT NULL
     ORDER BY ora`,
  );
  return rows;
}

export type Etichetta = {
  percorso: string;
  uccellino: string;
  azione_umana: Azione;
  azione_modello: Azione;
  confidenza_modello: number;
  modello: string;
};

// Le correzioni e conferme fatte in galleria: sono le etichette per valutare il modello.
export async function etichetteUmane(): Promise<Etichetta[]> {
  const { rows } = await pool.query<Etichetta>(
    `SELECT f.percorso, e.uccellino, e.azione_umana, e.azione_modello, e.confidenza_modello, f.modello
     FROM eventi_effettivi e JOIN foto f ON f.id = e.foto_id
     WHERE e.azione_umana IS NOT NULL
     ORDER BY f.ora, e.uccellino`,
  );
  return rows;
}

export type FotoAnalizzata = { percorso: string; foto_id: number; eventi: { nome: string; azione: string }[] };

// Quali di questi percorsi (data/foto/X.jpg) sono già nel diario, e con quali azioni.
export async function fotoAnalizzate(percorsi: string[]): Promise<FotoAnalizzata[]> {
  if (!percorsi.length) return [];
  const { rows } = await pool.query<FotoAnalizzata>(
    `SELECT f.percorso, f.id AS foto_id,
            json_agg(json_build_object('nome', e.uccellino, 'azione', e.azione) ORDER BY e.uccellino) AS eventi
     FROM foto f JOIN eventi_effettivi e ON e.foto_id = f.id
     WHERE f.percorso = ANY($1)
     GROUP BY f.id`,
    [percorsi],
  );
  return rows;
}

// --- Impronte delle immagini (CLIP) ---

export async function salvaEmbeddingImmagine(fotoId: number, vettore: number[]) {
  await pool.query("UPDATE foto SET embedding_immagine = $2 WHERE id = $1", [fotoId, toVector(vettore)]);
}

/** Le foto che non hanno ancora l'impronta (per riempirle dopo, vedi embedding-immagini.ts). */
export async function fotoSenzaEmbeddingImmagine(): Promise<{ id: number; percorso: string }[]> {
  const { rows } = await pool.query<{ id: number; percorso: string }>(
    "SELECT id, percorso FROM foto WHERE embedding_immagine IS NULL ORDER BY ora",
  );
  return rows;
}

export type FotoTrovata = { foto_id: number; ora: Date; percorso: string; scena: string; similarita: number };

/** Le foto più vicine a un vettore (di una frase o di un'altra foto), con filtro opzionale sul giorno. */
export async function cercaFotoSimili(
  vettore: number[],
  limite = 5,
  filtri: { giorno?: string; escludiFotoId?: number } = {},
): Promise<FotoTrovata[]> {
  const { rows } = await pool.query<FotoTrovata>(
    `SELECT id AS foto_id, ora, percorso, scena, 1 - (embedding_immagine <=> $1) AS similarita
     FROM foto
     WHERE embedding_immagine IS NOT NULL
       AND ($3::date IS NULL OR (ora AT TIME ZONE $4)::date = $3::date)
       AND ($5::int IS NULL OR id <> $5)
     ORDER BY embedding_immagine <=> $1
     LIMIT $2`,
    [toVector(vettore), limite, filtri.giorno ?? null, FUSO, filtri.escludiFotoId ?? null],
  );
  return rows;
}

/** L'impronta già salvata di una foto (per "foto simili a questa"). */
export async function embeddingImmagineDi(fotoId: number): Promise<number[] | null> {
  const { rows } = await pool.query<{ v: string | null }>(
    "SELECT embedding_immagine::text AS v FROM foto WHERE id = $1",
    [fotoId],
  );
  return rows[0]?.v ? (JSON.parse(rows[0].v) as number[]) : null;
}

// Quante dimensioni ha la colonna embedding_testo (per pgvector il "typmod" è proprio il numero di dimensioni).
export async function dimensioniEmbeddingDb(): Promise<number | null> {
  const { rows } = await pool.query<{ dimensioni: number }>(
    `SELECT atttypmod AS dimensioni FROM pg_attribute
     WHERE attrelid = 'eventi'::regclass AND attname = 'embedding_testo'`,
  );
  return rows[0]?.dimensioni ?? null;
}

export async function chiudi() {
  await pool.end();
}
