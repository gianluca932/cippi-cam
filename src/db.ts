import pg from "pg";
import type { AnalisiFoto } from "./schema.js";
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

// Salva la foto e un evento per ogni uccellino, tutto o niente.
export async function salvaAnalisi(
  analisi: AnalisiFoto,
  percorso: string,
  modello: string,
  embeddings: number[][], // uno per uccellino, nello stesso ordine
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO foto (percorso, modello, scena, acqua, cibo, note_gabbia)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [percorso, modello, analisi.scena, analisi.gabbia.acqua, analisi.gabbia.cibo, analisi.gabbia.note],
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
  descrizione: string;
  similarita: number; // 1 = identico, 0 = niente in comune
};

// Ricerca semantica: gli eventi la cui descrizione è più vicina al vettore della domanda.
export async function cercaSimili(embeddingDomanda: number[], limite = 5): Promise<RisultatoRicerca[]> {
  const { rows } = await pool.query<RisultatoRicerca>(
    `SELECT e.foto_id, f.ora, e.uccellino, e.azione, e.descrizione,
            1 - (e.embedding_testo <=> $1) AS similarita
     FROM eventi e JOIN foto f ON f.id = e.foto_id
     ORDER BY e.embedding_testo <=> $1
     LIMIT $2`,
    [toVector(embeddingDomanda), limite],
  );
  return rows;
}

export async function chiudi() {
  await pool.end();
}
