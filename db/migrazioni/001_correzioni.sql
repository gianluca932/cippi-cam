-- Correzioni umane dalla galleria. Si può rilanciare: non rompe niente se è già applicata.

-- La previsione del modello (azione, confidenza) non si tocca mai: la correzione sta accanto.
ALTER TABLE eventi ADD COLUMN IF NOT EXISTS azione_umana   TEXT;        -- NULL = non controllato
ALTER TABLE eventi ADD COLUMN IF NOT EXISTS controllato_il TIMESTAMPTZ;

-- La "verità" in un solo punto: l'azione umana se c'è, altrimenti quella del modello.
-- Un evento controllato da una persona vale come confidenza 1.
CREATE OR REPLACE VIEW eventi_effettivi AS
SELECT
  e.id,
  e.foto_id,
  e.uccellino,
  COALESCE(e.azione_umana, e.azione)                         AS azione,
  CASE WHEN e.azione_umana IS NULL THEN e.confidenza ELSE 1 END AS confidenza,
  e.azione       AS azione_modello,
  e.confidenza   AS confidenza_modello,
  e.azione_umana,
  e.controllato_il,
  e.descrizione,
  e.posizione,
  e.oggetti_vicini,
  e.postura,
  e.embedding_testo
FROM eventi e;
