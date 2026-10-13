-- Dettagli più concreti: con cosa interagisce l'uccellino e quanto è pulita la gabbia.
-- Le foto già importate restano con NULL (il modello non li aveva prodotti).

ALTER TABLE eventi ADD COLUMN IF NOT EXISTS con_cosa TEXT; -- es. "campanellino", "mangiatoia", "niente"
ALTER TABLE foto   ADD COLUMN IF NOT EXISTS pulizia  TEXT; -- pulita | un_po_sporca | sporca | non_visibile

-- La vista si ricrea da zero: così le migrazioni si possono rilanciare in ordine.
DROP VIEW IF EXISTS eventi_effettivi;
CREATE VIEW eventi_effettivi AS
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
  e.embedding_testo,
  e.con_cosa
FROM eventi e;

-- Per filtrare per oggetto in SQL ("quando ha giocato col campanellino?").
CREATE INDEX IF NOT EXISTS eventi_con_cosa_idx ON eventi (lower(con_cosa));
