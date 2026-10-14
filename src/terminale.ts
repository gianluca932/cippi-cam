// Piccoli strumenti per un output leggibile nel terminale: colori, spinner, barra di avanzamento.
// Niente librerie: sono solo codici ANSI. Se l'output non è un terminale (es. un log in background)
// colori e animazioni si spengono da soli e restano righe di testo semplici.

export const interattivo = Boolean(process.stdout.isTTY);

const ansi = (codice: string) => (testo: string) => (interattivo ? `\x1b[${codice}m${testo}\x1b[0m` : testo);
export const c = {
  grigio: ansi("90"),
  verde: ansi("32"),
  giallo: ansi("33"),
  rosso: ansi("31"),
  ciano: ansi("36"),
  grassetto: ansi("1"),
};

/** "35.2s", "1 min 12s", "24 min" */
export function durata(secondi: number): string {
  if (secondi < 60) return `${secondi < 10 ? secondi.toFixed(1) : Math.round(secondi)}s`;
  const min = Math.floor(secondi / 60);
  return min < 10 ? `${min} min ${Math.round(secondi % 60)}s` : `${min} min`;
}

/** "████░░░░░░░░░░░░" */
export function barra(frazione: number, larghezza = 16): string {
  const piene = Math.round(Math.max(0, Math.min(1, frazione)) * larghezza);
  return c.verde("█".repeat(piene)) + c.grigio("░".repeat(larghezza - piene));
}

/**
 * Una riga che "gira" mentre qualcosa è in corso, con i secondi che passano:
 *   ⠙ modello di visione            12s…
 * e che alla fine diventa
 *   ✓ modello di visione            35.1s · 366 token
 */
export class Spinner {
  private static FOTOGRAMMI = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private timer?: NodeJS.Timeout;
  private inizio = 0;
  private etichetta = "";

  avvia(etichetta: string) {
    this.etichetta = etichetta;
    this.inizio = performance.now();
    if (!interattivo) return; // senza terminale: si stampa solo la riga finale
    let i = 0;
    this.timer = setInterval(() => {
      const passati = (performance.now() - this.inizio) / 1000;
      process.stdout.write(`\r\x1b[2K   ${c.ciano(Spinner.FOTOGRAMMI[i++ % 10])} ${this.etichetta.padEnd(28)} ${c.grigio(`${durata(passati)}…`)}`);
    }, 100);
  }

  /** Chiude la riga con ✓ (o ✗) e il tempo impiegato. Restituisce i secondi. */
  ferma(ok = true, dettaglio = ""): number {
    clearInterval(this.timer);
    const secondi = (performance.now() - this.inizio) / 1000;
    const segno = ok ? c.verde("✓") : c.rosso("✗");
    const extra = dettaglio ? c.grigio(` · ${dettaglio}`) : "";
    if (interattivo) process.stdout.write("\r\x1b[2K");
    console.log(`   ${segno} ${this.etichetta.padEnd(28)} ${c.grigio(durata(secondi))}${extra}`);
    return secondi;
  }
}
