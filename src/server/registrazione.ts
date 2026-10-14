import { spawn, type ChildProcess } from "node:child_process";
import { basename } from "node:path";
import { sincronizzaUccellini } from "../db/db.js";
import type { StatoRegistrazione } from "../comune/api-types.js";
import { importaFoto } from "../foto/importazione.js";
import { scattaFoto, trovaFotocamera } from "../foto/webcam.js";

// La registrazione avviata dalla pagina Live: il server scatta una foto ogni N secondi
// e la mette in coda; un "lavoratore" analizza le foto della coda una alla volta.
// Lo scatto non aspetta mai l'analisi: se il modello è lento, la coda si allunga e poi recupera.
// (Su AWS: S3 al posto della cartella, SQS al posto della coda, Lambda al posto del lavoratore.)
//
// Lo stato vive in memoria nel processo del server: se il server si riavvia, la registrazione si ferma.

export type OpzioniRegistrazione = { ogniSec: number; durataMin: number; analizza: boolean; camera: string };


const stato: StatoRegistrazione = {
  attiva: false,
  camera: null,
  ogniSec: 60,
  analizza: true,
  avviataAlle: null,
  fineAlle: null,
  scattate: 0,
  analizzate: 0,
  scartate: 0,
  inAnalisi: null,
  coda: [],
  errore: null,
};

let timer: NodeJS.Timeout | undefined;
let caffeinate: ChildProcess | undefined;
let lavoratoreAttivo = false;
const percorsi = new Map<string, string>(); // nome file → percorso, per la coda

export const statoRegistrazione = (): StatoRegistrazione => ({ ...stato, coda: [...stato.coda] });

export async function avviaRegistrazione(opzioni: OpzioniRegistrazione): Promise<StatoRegistrazione> {
  if (stato.attiva) return statoRegistrazione();
  const camera = await trovaFotocamera(opzioni.camera); // errore subito se la fotocamera non c'è
  await sincronizzaUccellini();

  Object.assign(stato, {
    attiva: true,
    camera,
    ogniSec: opzioni.ogniSec,
    analizza: opzioni.analizza,
    avviataAlle: new Date().toISOString(),
    fineAlle: new Date(Date.now() + opzioni.durataMin * 60_000).toISOString(),
    scattate: 0,
    analizzate: 0,
    scartate: 0,
    errore: null,
  });

  // Tiene sveglio il Mac finché il server è vivo (-w: si chiude da solo se il server muore).
  caffeinate = spawn("caffeinate", ["-di", "-w", String(process.pid)], { stdio: "ignore" });

  void scattaEProgramma();
  return statoRegistrazione();
}

export function fermaRegistrazione(): StatoRegistrazione {
  clearTimeout(timer);
  caffeinate?.kill();
  caffeinate = undefined;
  stato.attiva = false;
  // Le foto già in coda vengono comunque analizzate: il lavoratore finisce il suo giro.
  return statoRegistrazione();
}

async function scattaEProgramma() {
  if (!stato.attiva) return;
  if (Date.now() >= new Date(stato.fineAlle!).getTime()) {
    fermaRegistrazione();
    return;
  }

  const inizio = Date.now();
  try {
    const file = await scattaFoto(stato.camera!);
    stato.scattate++;
    if (stato.analizza) {
      const nome = basename(file);
      percorsi.set(nome, file);
      stato.coda.push(nome);
      void lavora();
    }
  } catch (err) {
    stato.errore = `Scatto fallito: ${(err as Error).message.split("\n")[0]}`;
  }

  // Il prossimo scatto parte N secondi dopo l'inizio di questo (lo scatto stesso dura 1-2s).
  if (stato.attiva) timer = setTimeout(scattaEProgramma, Math.max(0, stato.ogniSec * 1000 - (Date.now() - inizio)));
}

// Il lavoratore: una foto alla volta, finché la coda non è vuota. Una sola istanza alla volta.
async function lavora() {
  if (lavoratoreAttivo) return;
  lavoratoreAttivo = true;
  try {
    while (stato.coda.length) {
      const nome = stato.coda.shift()!;
      stato.inAnalisi = nome;
      try {
        const esito = await importaFoto(percorsi.get(nome)!, { log: false });
        if (esito.esito === "importata") stato.analizzate++;
        if (esito.esito === "scartata") stato.scartate++;
      } catch (err) {
        stato.errore = `Analisi di ${nome} fallita: ${(err as Error).message.split("\n")[0]}`;
      } finally {
        percorsi.delete(nome);
        stato.inAnalisi = null;
      }
    }
  } finally {
    lavoratoreAttivo = false;
  }
}
