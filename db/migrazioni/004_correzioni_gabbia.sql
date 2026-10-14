-- Correzioni umane anche per lo stato della gabbia (acqua, cibo, pulizia), come per le azioni (001).
-- I valori del modello (acqua, cibo, pulizia) non si toccano mai: la correzione sta accanto.

ALTER TABLE foto ADD COLUMN IF NOT EXISTS acqua_umana           TEXT;        -- NULL = non controllato
ALTER TABLE foto ADD COLUMN IF NOT EXISTS cibo_umano            TEXT;
ALTER TABLE foto ADD COLUMN IF NOT EXISTS pulizia_umana         TEXT;
ALTER TABLE foto ADD COLUMN IF NOT EXISTS gabbia_controllata_il TIMESTAMPTZ;

-- La "verità" sulla gabbia in un solo punto: il valore umano se c'è, altrimenti quello del modello.
-- Galleria e agente leggono da qui.
DROP VIEW IF EXISTS foto_effettive;
CREATE VIEW foto_effettive AS
SELECT
  f.id,
  f.ora,
  f.percorso,
  f.modello,
  f.scena,
  f.note_gabbia,
  COALESCE(f.acqua_umana, f.acqua)     AS acqua,
  COALESCE(f.cibo_umano, f.cibo)       AS cibo,
  COALESCE(f.pulizia_umana, f.pulizia) AS pulizia,
  f.acqua   AS acqua_modello,
  f.cibo    AS cibo_modello,
  f.pulizia AS pulizia_modello,
  f.acqua_umana,
  f.cibo_umano,
  f.pulizia_umana,
  f.gabbia_controllata_il
FROM foto f;
