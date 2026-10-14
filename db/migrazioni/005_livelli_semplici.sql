-- Livelli della gabbia semplificati (v0.12.0):
--   acqua, cibo: abbondante | sufficiente → ok;  scarso | vuoto → da_rifornire
--   pulizia:     un_po_sporca | sporca    → sporca
-- Vale sia per i valori del modello che per le correzioni umane. Si può rilanciare:
-- tocca solo i valori vecchi (utile se un import partito prima del cambio salva ancora quelli).

UPDATE foto SET acqua = CASE WHEN acqua IN ('abbondante', 'sufficiente') THEN 'ok' ELSE 'da_rifornire' END
WHERE acqua IN ('abbondante', 'sufficiente', 'scarso', 'vuoto');
UPDATE foto SET cibo = CASE WHEN cibo IN ('abbondante', 'sufficiente') THEN 'ok' ELSE 'da_rifornire' END
WHERE cibo IN ('abbondante', 'sufficiente', 'scarso', 'vuoto');
UPDATE foto SET pulizia = 'sporca' WHERE pulizia = 'un_po_sporca';

UPDATE foto SET acqua_umana = CASE WHEN acqua_umana IN ('abbondante', 'sufficiente') THEN 'ok' ELSE 'da_rifornire' END
WHERE acqua_umana IN ('abbondante', 'sufficiente', 'scarso', 'vuoto');
UPDATE foto SET cibo_umano = CASE WHEN cibo_umano IN ('abbondante', 'sufficiente') THEN 'ok' ELSE 'da_rifornire' END
WHERE cibo_umano IN ('abbondante', 'sufficiente', 'scarso', 'vuoto');
UPDATE foto SET pulizia_umana = 'sporca' WHERE pulizia_umana = 'un_po_sporca';
