import pg from "pg";
import "../comune/env.js";
import { embeddingTestoPerImmagini } from "../modelli/immagini.js";

// Esperimento: classificare le azioni con CLIP "zero-shot", cioè SENZA addestramento.
// Ogni azione diventa una frase in inglese; per ogni foto vince la frase più vicina alla sua impronta.
// Usa le impronte già salvate nel database: niente modello di visione, nessuna modifica ai dati.
//
// Versione semplice: CLIP guarda la FOTO INTERA (con dentro tutti e due gli uccellini), quindi
// una risposta è giusta se ALMENO UNO dei due stava facendo quell'azione. È una domanda più facile
// di quella dell'LLM (un'azione per uccellino): serve a capire se CLIP "vede" qualcosa, non a confrontarli.
//
// Uso: npm run clip-zero-shot              → azioni
//      npm run clip-zero-shot -- --gabbia   → acqua e cibo (ok / da_rifornire)

// Una frase per azione: il testo conta molto (si chiama "prompt engineering" anche qui).
const FRASI: Record<string, string> = {
  mangia: "a photo of a budgie eating seeds from a feeder",
  beve: "a photo of a budgie drinking water",
  si_pulisce: "a photo of a budgie preening its feathers with its beak",
  riposa: "a photo of a budgie resting calmly on a perch",
  gioca: "a photo of a budgie playing with a toy",
  dorme: "a photo of a budgie sleeping with its head tucked in",
  vola: "a photo of a budgie flying with open wings",
};

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://cippi:cippi@localhost:5432/cippi" });

// Gabbia: per ogni campo, una frase per livello. Qui CLIP dovrebbe andare meglio: conta "cosa c'è", non un gesto.
const FRASI_GABBIA: Record<"acqua" | "cibo", Record<string, string>> = {
  acqua: {
    ok: "a bird cage with a water dispenser full of water",
    da_rifornire: "a bird cage with an empty water dispenser",
  },
  cibo: {
    ok: "a bird cage with seed feeders full of seeds",
    da_rifornire: "a bird cage with an empty seed feeder",
  },
};

const prodottoScalare = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

async function gabbia() {
  for (const campo of ["acqua", "cibo"] as const) {
    const colonna = campo === "acqua" ? "acqua_umana" : "cibo_umano";
    const { rows } = await pool.query<{ ora: string; impronta: string; vero: string }>(
      `SELECT to_char(ora AT TIME ZONE 'Europe/Rome', 'HH24:MI') AS ora, embedding_immagine::text AS impronta, ${colonna} AS vero
       FROM foto WHERE ${colonna} IN ('ok', 'da_rifornire') AND embedding_immagine IS NOT NULL ORDER BY ora`,
    );
    const livelli = Object.keys(FRASI_GABBIA[campo]);
    const vettori = await Promise.all(livelli.map((l) => embeddingTestoPerImmagini(FRASI_GABBIA[campo][l])));
    let giuste = 0;
    const confusione: Record<string, number> = {};
    for (const r of rows) {
      const impronta = JSON.parse(r.impronta) as number[];
      const sim = livelli.map((l, i) => ({ l, s: prodottoScalare(impronta, vettori[i]) })).sort((a, b) => b.s - a.s);
      if (sim[0].l === r.vero) giuste++;
      const k = `vero ${r.vero} → CLIP ${sim[0].l}`;
      confusione[k] = (confusione[k] ?? 0) + 1;
    }
    // Il riferimento minimo: rispondere sempre il valore più frequente. Se CLIP non lo batte, non sta capendo niente.
    const conteggi = rows.reduce<Record<string, number>>((c, r) => ({ ...c, [r.vero]: (c[r.vero] ?? 0) + 1 }), {});
    const [piuFrequente, nPiu] = Object.entries(conteggi).sort((a, b) => b[1] - a[1])[0] ?? ["-", 0];
    const pct = (n: number) => `${Math.round((n / rows.length) * 100)}%`;
    console.log(`\n── ${campo}: ${rows.length} foto etichettate (${Object.entries(conteggi).map(([k, n]) => `${k} ${n}`).join(", ")})`);
    console.log(`  CLIP zero-shot:                        ${giuste}/${rows.length} (${pct(giuste)})`);
    console.log(`  rispondere sempre "${piuFrequente}":   ${nPiu}/${rows.length} (${pct(nPiu)})   ← il riferimento da battere`);
    for (const [k, n] of Object.entries(confusione).sort()) console.log(`    ${k}: ${n}`);
  }
}

try {
  if (process.argv.includes("--gabbia")) {
    await gabbia();
    process.exit(0);
  }
  // Per ogni foto: la sua impronta e le azioni vere (le tue etichette), senza "non_visibile".
  const { rows } = await pool.query<{ id: number; ora: string; impronta: string; azioni: string[] }>(
    `SELECT f.id, to_char(f.ora AT TIME ZONE 'Europe/Rome', 'HH24:MI') AS ora,
            f.embedding_immagine::text AS impronta,
            array_agg(DISTINCT e.azione_umana) AS azioni
     FROM foto f JOIN eventi e ON e.foto_id = f.id
     WHERE e.azione_umana IS NOT NULL AND e.azione_umana <> 'non_visibile' AND f.embedding_immagine IS NOT NULL
     GROUP BY f.id ORDER BY f.ora`,
  );

  // Le impronte delle frasi (CLIP, encoder del testo). Le foto le abbiamo già.
  const azioni = Object.keys(FRASI);
  const vettoriFrasi = await Promise.all(azioni.map((a) => embeddingTestoPerImmagini(FRASI[a])));
  const prodotto = prodottoScalare; // vettori già normalizzati: il prodotto scalare è la similarità coseno

  let giuste = 0;
  const vinte: Record<string, number> = {};
  console.log(`${rows.length} foto con etichette\n`);
  for (const r of rows) {
    const impronta = JSON.parse(r.impronta) as number[];
    const punteggi = azioni.map((a, i) => ({ azione: a, sim: prodotto(impronta, vettoriFrasi[i]) })).sort((x, y) => y.sim - x.sim);
    const scelta = punteggi[0];
    const ok = r.azioni.includes(scelta.azione);
    if (ok) giuste++;
    vinte[scelta.azione] = (vinte[scelta.azione] ?? 0) + 1;
    const secondo = punteggi[1];
    console.log(
      `  ${ok ? "✅" : "❌"} ${r.ora}  CLIP: ${scelta.azione.padEnd(10)} ${scelta.sim.toFixed(3)}` +
        `  (2ª ${secondo.azione} ${secondo.sim.toFixed(3)})   vero: ${r.azioni.join(", ")}`,
    );
  }

  console.log(`\nGiuste (almeno uno dei due faceva quell'azione): ${giuste}/${rows.length} (${Math.round((giuste / rows.length) * 100)}%)`);
  console.log(`Quante volte CLIP ha scelto ogni azione: ${Object.entries(vinte).map(([a, n]) => `${a} ${n}`).join(" · ")}`);
} finally {
  await pool.end();
}
