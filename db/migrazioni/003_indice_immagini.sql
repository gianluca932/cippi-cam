-- Ricerca per immagini: indice HNSW sulle impronte CLIP delle foto (512 dimensioni, similarità coseno).
-- La colonna foto.embedding_immagine esiste dal primo schema (vector(512)), finora vuota.

CREATE INDEX IF NOT EXISTS foto_embedding_immagine_idx
  ON foto USING hnsw (embedding_immagine vector_cosine_ops);
