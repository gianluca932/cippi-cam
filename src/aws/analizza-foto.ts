import "../comune/env.js"; // per primo: carica .env prima che gli altri moduli leggano process.env
import { rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { z } from "zod";
import { importaJpg } from "../foto/importazione.js";
import { chiaveValida, scaricaFoto } from "../foto/s3.js";

// La Lambda che analizza le foto: S3 (foto nuova) → SQS → qui.
// È la stessa importaJpg del Mac; cambia solo da dove arriva il file.
//
// Errori: se una foto fallisce, solo il suo messaggio torna in coda (batchItemFailures).
// SQS lo riconsegna e, dopo 3 tentativi, lo sposta nella dead letter queue: non blocca le altre foto.

// Del messaggio di S3 ci serve solo la chiave. "s3:TestEvent" (mandato alla creazione della notifica) non ha Records.
const EventoS3 = z.object({
  Records: z.array(z.object({ s3: z.object({ object: z.object({ key: z.string() }) }) })).default([]),
});

async function importaDaS3(chiave: string) {
  if (!chiaveValida(chiave)) {
    console.warn(`Chiave ignorata: ${chiave}`); // non è una foto del diario: niente da riprovare
    return;
  }
  const foto = await scaricaFoto(chiave);
  if (!foto) return console.warn(`Foto sparita da S3: ${chiave}`);
  if (!foto.ora) throw new Error(`${chiave} senza metadato ora-scatto: caricala con npm run carica`);

  const tmp = join("/tmp", basename(chiave)); // /tmp è l'unica cartella scrivibile in una Lambda
  await writeFile(tmp, foto.dati);
  try {
    const esito = await importaJpg(tmp, { percorso: chiave, ora: foto.ora, log: true });
    // Risposta fuori schema: si lancia un errore, così SQS riprova (il modello non è deterministico).
    if (esito.esito === "scartata") throw new Error(`Risposta del modello fuori schema per ${chiave}`);
    console.log(`${chiave}: ${esito.esito}`);
  } finally {
    await rm(tmp, { force: true });
  }
}

export async function handler(evento: SQSEvent): Promise<SQSBatchResponse> {
  const fallite: SQSBatchResponse["batchItemFailures"] = [];
  for (const messaggio of evento.Records) {
    try {
      const { Records } = EventoS3.parse(JSON.parse(messaggio.body));
      // Nelle notifiche di S3 la chiave è codificata come in un URL (spazi → "+").
      for (const r of Records) await importaDaS3(decodeURIComponent(r.s3.object.key.replace(/\+/g, " ")));
    } catch (err) {
      console.error(`Messaggio ${messaggio.messageId}:`, err);
      fallite.push({ itemIdentifier: messaggio.messageId });
    }
  }
  return { batchItemFailures: fallite };
}
