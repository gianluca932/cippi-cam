-- Acqua e cibo non si analizzano più a ogni foto, ma con un controllo ogni GABBIA_OGNI_MIN minuti:
-- le foto senza controllo hanno acqua e cibo NULL ("non controllata"), non un valore inventato.
-- La foto che ha acqua/cibo valorizzati È il controllo della gabbia di quel momento.

ALTER TABLE foto ALTER COLUMN acqua DROP NOT NULL;
ALTER TABLE foto ALTER COLUMN cibo  DROP NOT NULL;

-- Per trovare in fretta l'ultimo controllo prima di una certa ora.
CREATE INDEX IF NOT EXISTS foto_controlli_gabbia_idx ON foto (ora) WHERE acqua IS NOT NULL;
