CREATE EXTENSION IF NOT EXISTS vector;

-- Chi vive nella gabbia. Si configura in config/uccellini.json:
-- il classificatore sincronizza questa tabella a ogni avvio.
CREATE TABLE uccellini (
  nome   TEXT PRIMARY KEY,
  colore TEXT NOT NULL UNIQUE
);

-- Una riga per ogni foto analizzata.
CREATE TABLE foto (
  id                 SERIAL PRIMARY KEY,
  ora                TIMESTAMPTZ NOT NULL DEFAULT now(),
  percorso           TEXT NOT NULL,
  modello            TEXT NOT NULL,
  scena              TEXT NOT NULL,
  -- Stato della gabbia: abbondante | sufficiente | scarso | vuoto | non_visibile
  acqua              TEXT NOT NULL,
  cibo               TEXT NOT NULL,
  note_gabbia        TEXT NOT NULL DEFAULT '',
  -- Ricerca sulle immagini con CLIP: per ora vuota, la riempiamo più avanti.
  embedding_immagine vector(512)
);

-- Una riga per ogni uccellino in ogni foto.
CREATE TABLE eventi (
  id              SERIAL PRIMARY KEY,
  foto_id         INT NOT NULL REFERENCES foto(id) ON DELETE CASCADE,
  uccellino       TEXT NOT NULL REFERENCES uccellini(nome) ON UPDATE CASCADE,

  -- Output del modello di visione, già validato da Zod.
  azione          TEXT NOT NULL,
  confidenza      REAL NOT NULL CHECK (confidenza BETWEEN 0 AND 1),
  descrizione     TEXT NOT NULL,
  posizione       TEXT NOT NULL,
  oggetti_vicini  TEXT[] NOT NULL DEFAULT '{}',
  postura         TEXT NOT NULL,

  -- Ricerca semantica sulle descrizioni (nomic-embed-text, 768 dimensioni).
  embedding_testo vector(768),

  UNIQUE (foto_id, uccellino)
);

CREATE INDEX foto_ora_idx ON foto (ora);
CREATE INDEX eventi_embedding_testo_idx ON eventi USING hnsw (embedding_testo vector_cosine_ops);

-- Le migrazioni in db/migrazioni/ si applicano anche ai database nuovi: npm run db:migra
