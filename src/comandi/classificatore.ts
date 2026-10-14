import pg from "pg";
import "../comune/env.js";

// Esperimento: due classificatori "veri" sopra le impronte CLIP, addestrati sulle TUE etichette.
// CLIP fa solo da "occhi" (foto → 512 numeri); il classificatore è un modello piccolo e nostro.
//
//   1. k-NN: per una foto, le k foto etichettate più simili votano l'etichetta.
//   2. Regressione logistica: impara un peso per ognuno dei 512 numeri, poi dà una probabilità.
//
// Misura onesta con LEAVE-ONE-OUT: per ogni foto si allena su tutte le ALTRE e si prova su quella,
// così nessuna foto è giudicata da un modello che l'ha già vista.
// Confronti sulle stesse foto: rispondere sempre la classe più frequente, e l'LLM (previsioni salvate).
// Solo lettura: non modifica niente.
//
// ⚠️ Foto una al minuto = foto consecutive quasi identiche, con la stessa etichetta. Con il semplice
// leave-one-out la foto "gemella" del minuto prima resta nell'allenamento e il risultato si gonfia
// (data leakage). Con --blocco N si toglie dall'allenamento ogni foto entro N minuti da quella di prova:
// il classificatore deve generalizzare da momenti diversi.
//
// Uso: npm run classificatore                 → leave-one-out
//      npm run classificatore -- --blocco 10  → senza le foto entro ±10 minuti

type Esempio = { ora: string; minuto: number; x: number[]; y: number; llm: string | null }; // y: 1 = da_rifornire, 0 = ok

const args = process.argv.slice(2);
const BLOCCO = args.includes("--blocco") ? Number(args[args.indexOf("--blocco") + 1]) : 0; // minuti

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://cippi:cippi@localhost:5432/cippi" });

const prodotto = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);

// --- 1. k-NN ------------------------------------------------------------------------------------
// Le impronte sono normalizzate: il prodotto scalare è la similarità coseno.
function knn(allenamento: Esempio[], x: number[], k = 5): number {
  const vicini = allenamento
    .map((e) => ({ y: e.y, sim: prodotto(e.x, x) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, k);
  // Voto pesato per la similarità, e corretto per lo sbilanciamento: ogni classe pesa in proporzione inversa
  // a quanto è frequente, altrimenti vincerebbe quasi sempre la classe con più esempi.
  const nPos = allenamento.filter((e) => e.y === 1).length || 1;
  const nNeg = allenamento.length - nPos || 1;
  let voti = 0;
  for (const v of vicini) voti += v.y === 1 ? v.sim / nPos : -v.sim / nNeg;
  return voti > 0 ? 1 : 0;
}

// --- 2. Regressione logistica --------------------------------------------------------------------
// p(da_rifornire) = sigmoide(w · x + b). Si parte da pesi zero e si correggono un po' alla volta
// nella direzione che riduce l'errore (discesa del gradiente), per un numero fisso di passi.
const sigmoide = (z: number) => 1 / (1 + Math.exp(-z));

function allenaLogistica(es: Esempio[], { passi = 400, passo = 0.5, l2 = 0.01 } = {}) {
  const d = es[0].x.length;
  const w = new Array(d).fill(0);
  let b = 0;
  // Pesi per le classi: gli errori sulla classe rara costano di più.
  const nPos = es.filter((e) => e.y === 1).length || 1;
  const nNeg = es.length - nPos || 1;
  const peso = (y: number) => (y === 1 ? es.length / (2 * nPos) : es.length / (2 * nNeg));

  for (let t = 0; t < passi; t++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (const e of es) {
      const errore = (sigmoide(prodotto(w, e.x) + b) - e.y) * peso(e.y); // quanto sbaglia su questo esempio
      for (let i = 0; i < d; i++) gw[i] += errore * e.x[i];
      gb += errore;
    }
    for (let i = 0; i < d; i++) w[i] -= passo * (gw[i] / es.length + l2 * w[i]); // l2: tiene piccoli i pesi (meno overfitting)
    b -= passo * (gb / es.length);
  }
  return (x: number[]) => sigmoide(prodotto(w, x) + b);
}

// --- Misura ---------------------------------------------------------------------------------------
const pct = (n: number, tot: number) => `${n}/${tot} (${Math.round((n / tot) * 100)}%)`;

async function valuta(campo: "acqua" | "cibo") {
  const { rows } = await pool.query<{ ora: string; impronta: string; vero: string; llm: string }>(
    `SELECT to_char(ora AT TIME ZONE 'Europe/Rome', 'HH24:MI') AS ora, embedding_immagine::text AS impronta,
            ${campo}_${campo === "acqua" ? "umana" : "umano"} AS vero, ${campo} AS llm
     FROM foto
     WHERE ${campo}_${campo === "acqua" ? "umana" : "umano"} IN ('ok', 'da_rifornire') AND embedding_immagine IS NOT NULL
     ORDER BY ora`,
  );
  const esempi: Esempio[] = rows.map((r) => ({
    ora: r.ora,
    minuto: Number(r.ora.slice(0, 2)) * 60 + Number(r.ora.slice(3, 5)),
    x: JSON.parse(r.impronta),
    y: r.vero === "da_rifornire" ? 1 : 0,
    llm: r.llm,
  }));

  let giusteKnn = 0;
  let giusteLog = 0;
  const sbagliate: string[] = [];
  for (const [i, prova] of esempi.entries()) {
    // leave-one-out, e con --blocco anche tutte le foto vicine nel tempo
    const altre = esempi.filter((e, j) => j !== i && Math.abs(e.minuto - prova.minuto) > BLOCCO);
    if (!altre.some((e) => e.y === 1) || !altre.some((e) => e.y === 0)) continue; // serve almeno un esempio per classe
    const pKnn = knn(altre, prova.x);
    const pLog = allenaLogistica(altre)(prova.x) > 0.5 ? 1 : 0;
    if (pKnn === prova.y) giusteKnn++;
    if (pLog === prova.y) giusteLog++;
    if (pLog !== prova.y) sbagliate.push(`${prova.ora} (vero ${prova.y ? "da_rifornire" : "ok"})`);
  }

  const n = esempi.length;
  const nPos = esempi.filter((e) => e.y === 1).length;
  const piuFrequente = Math.max(nPos, n - nPos);
  const giusteLlm = esempi.filter((e) => e.llm === (e.y ? "da_rifornire" : "ok")).length;

  console.log(`\n── ${campo}: ${n} foto etichettate (da_rifornire ${nPos}, ok ${n - nPos})${BLOCCO ? ` · escluse dall'allenamento le foto entro ±${BLOCCO} min` : ""}`);
  console.log(`  rispondere sempre la classe più frequente   ${pct(piuFrequente, n)}`);
  console.log(`  LLM (previsioni salvate)                    ${pct(giusteLlm, n)}`);
  console.log(`  k-NN (k=5)                                  ${pct(giusteKnn, n)}`);
  console.log(`  regressione logistica                       ${pct(giusteLog, n)}`);
  if (sbagliate.length) console.log(`    sbagliate dalla logistica: ${sbagliate.join(", ")}`);
}

try {
  await valuta("acqua");
  await valuta("cibo");
} finally {
  await pool.end();
}
