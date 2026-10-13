import pg from "pg";
import type { FotoApi, GiornoApi, UccellinoApi } from "./api-types.js";
import { MIN_CONFIDENCE, type AnalisiFoto, type EventoUccellino } from "./schema.js";
import { nomeDaColore, UCCELLINI } from "./uccellini.js";

// Tutte le query stanno qui: il resto del codice non sa che sotto c'è Postgres.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://cippi:cippi@localhost:5432/cippi",
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
  const { rowCount } = await pool.query("SELECT 1 FROM foto WHERE percorso = $1", [percorso]);
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
      [percorso, ora, modello, analisi.scena, analisi.gabbia.acqua, analisi.gabbia.cibo, analisi.gabbia.note],
    );
    const fotoId = rows[0].id;

    for (const [i, u] of analisi.uccellini.entries()) {
      await client.query(
        `INSERT INTO eventi
           (foto_id, uccellino, azione, confidenza, descrizione, posizione, oggetti_vicini, postura, embedding_testo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [fotoId, nomeDaColore(u.colore), u.azione, u.confidenza, u.descrizione, u.posizione, u.oggetti_vicini, u.postura,
          toVector(embeddings[i])],
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

// Ricerca semantica: gli eventi la cui descrizione è più vicina al vettore della domanda.
export async function cercaSimili(embeddingDomanda: number[], limite = 5): Promise<RisultatoRicerca[]> {
  const { rows } = await pool.query<RisultatoRicerca>(
    `SELECT e.foto_id, f.ora, e.uccellino, e.azione, e.confidenza, e.descrizione,
            1 - (e.embedding_testo <=> $1) AS similarita
     FROM eventi e JOIN foto f ON f.id = e.foto_id
     ORDER BY e.embedding_testo <=> $1
     LIMIT $2`,
    [toVector(embeddingDomanda), limite],
  );
  return rows;
}

// I "giorni" si contano nel fuso orario di casa, non in UTC.
const FUSO = "Europe/Rome";

export async function elencoUccellini(): Promise<UccellinoApi[]> {
  const { rows } = await pool.query<UccellinoApi>("SELECT nome, colore FROM uccellini ORDER BY nome");
  return rows;
}

export async function elencoGiorni(): Promise<GiornoApi[]> {
  const { rows } = await pool.query<GiornoApi>(
    `SELECT to_char((f.ora AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS giorno,
            COUNT(DISTINCT f.id)::int AS foto,
            COUNT(e.id) FILTER (WHERE e.confidenza >= $2 AND e.azione <> 'non_visibile')::int AS eventi_affidabili,
            COALESCE(array_agg(e.azione ORDER BY f.ora)
              FILTER (WHERE e.confidenza >= $2 AND e.azione <> 'non_visibile'), '{}') AS azioni
     FROM foto f LEFT JOIN eventi e ON e.foto_id = f.id
     GROUP BY 1 ORDER BY 1 DESC`,
    [FUSO, MIN_CONFIDENCE],
  );
  return rows;
}

export async function fotoDelGiorno(giorno: string): Promise<FotoApi[]> {
  const { rows } = await pool.query<FotoApi>(
    `SELECT f.id, f.ora, f.scena, f.acqua, f.cibo, f.note_gabbia,
            json_agg(json_build_object(
              'nome', e.uccellino, 'colore', u.colore, 'azione', e.azione, 'confidenza', e.confidenza,
              'descrizione', e.descrizione, 'posizione', e.posizione, 'postura', e.postura,
              'oggetti_vicini', e.oggetti_vicini
            ) ORDER BY e.uccellino) AS eventi
     FROM foto f
     JOIN eventi e ON e.foto_id = f.id
     JOIN uccellini u ON u.nome = e.uccellino
     WHERE (f.ora AT TIME ZONE $1)::date = $2::date
     GROUP BY f.id ORDER BY f.ora`,
    [FUSO, giorno],
  );
  return rows;
}

export async function percorsoFoto(id: number): Promise<string | undefined> {
  const { rows } = await pool.query<{ percorso: string }>("SELECT percorso FROM foto WHERE id = $1", [id]);
  return rows[0]?.percorso;
}

// Tutti gli eventi con i campi da cui si ricostruisce il testo dell'embedding.
export async function eventiPerEmbedding() {
  const { rows } = await pool.query<EventoUccellino & { id: number; percorso: string; uccellino: string; scena: string }>(
    `SELECT e.id, f.percorso, f.scena, e.uccellino, u.colore, e.azione, e.confidenza,
            e.descrizione, e.posizione, e.oggetti_vicini, e.postura
     FROM eventi e JOIN foto f ON f.id = e.foto_id JOIN uccellini u ON u.nome = e.uccellino
     ORDER BY e.id`,
  );
  return rows;
}

export async function chiudi() {
  await pool.end();
}
