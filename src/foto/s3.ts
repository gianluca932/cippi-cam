import "../comune/env.js"; // per primo: carica .env prima di leggere process.env
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";

// Le foto del diario su S3. Unico punto del codice che parla con S3.
// La chiave di un oggetto è lo stesso percorso che c'è nel database (data/foto/X.jpg): locale e cloud coincidono.
// L'ora dello scatto viaggia come metadato dell'oggetto, perché la Lambda non ha l'originale con l'EXIF.

const s3 = new S3Client({}); // regione e credenziali dall'ambiente (profilo sul Mac, ruolo IAM su Lambda)

const bucket = () => z.string().min(3, "Manca FOTO_BUCKET: il bucket delle foto (output di terraform)").parse(process.env.FOTO_BUCKET);

/** Le sole chiavi accettate: mai un percorso costruito con input esterno senza controllo. */
export const chiaveValida = (chiave: string) => /^data\/foto\/[\w.-]+\.jpg$/.test(chiave);

const METADATO_ORA = "ora-scatto"; // su S3 diventa l'header x-amz-meta-ora-scatto

export async function caricaFoto(chiave: string, dati: Uint8Array, ora: Date) {
  if (!chiaveValida(chiave)) throw new Error(`Chiave non valida: ${chiave}`);
  await s3.send(
    new PutObjectCommand({ Bucket: bucket(), Key: chiave, Body: dati, ContentType: "image/jpeg", Metadata: { [METADATO_ORA]: ora.toISOString() } }),
  );
}

export async function fotoSuS3(chiave: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket(), Key: chiave }));
    return true;
  } catch (err) {
    if ((err as Error).name === "NotFound") return false;
    throw err;
  }
}

/** I byte e l'ora di scatto di una foto; null se non esiste. */
export async function scaricaFoto(chiave: string): Promise<{ dati: Uint8Array; ora: Date | null } | null> {
  if (!chiaveValida(chiave)) return null;
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: bucket(), Key: chiave }));
    const ora = r.Metadata?.[METADATO_ORA];
    return { dati: await r.Body!.transformToByteArray(), ora: ora ? new Date(ora) : null };
  } catch (err) {
    if ((err as Error).name === "NoSuchKey") return null;
    throw err;
  }
}
