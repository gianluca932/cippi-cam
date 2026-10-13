import { readdir, stat } from "node:fs/promises";
import { extname, join, parse } from "node:path";
import type { ScattoApi } from "./api-types.js";
import { fotoAnalizzate } from "./db.js";

// Gli scatti nella cartella photos/ per la pagina Live: i più recenti, e se sono già nel diario.
// Solo JPG/PNG: gli HEIC dell'iPhone il browser (Chrome) non li sa mostrare.

export const CARTELLA_SCATTI = "photos";
const IMMAGINI = [".jpg", ".jpeg", ".png"];

// Accetta solo nomi di file semplici: niente "../" per uscire dalla cartella.
export const nomeValido = (nome: string) => /^[\w.-]+\.(jpe?g|png)$/i.test(nome) && !nome.startsWith(".");

export async function ultimiScatti(limite = 24): Promise<ScattoApi[]> {
  const file = (await readdir(CARTELLA_SCATTI)).filter((f) => IMMAGINI.includes(extname(f).toLowerCase()));
  const conData = await Promise.all(
    file.map(async (nome) => ({ nome, mtime: (await stat(join(CARTELLA_SCATTI, nome))).mtime })),
  );
  const recenti = conData.sort((a, b) => b.mtime.getTime() - a.mtime.getTime()).slice(0, limite);

  // importa salva le foto convertite come data/foto/<nome>.jpg: è quello il percorso nel database.
  const percorsoDb = (nome: string) => `data/foto/${parse(nome).name}.jpg`;
  const analizzate = new Map((await fotoAnalizzate(recenti.map((s) => percorsoDb(s.nome)))).map((a) => [a.percorso, a]));

  return recenti.map(({ nome, mtime }) => {
    const a = analizzate.get(percorsoDb(nome));
    return { nome, ora: mtime.toISOString(), analisi: a ? { foto_id: a.foto_id, eventi: a.eventi } : null };
  });
}
