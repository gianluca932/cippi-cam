import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

// Scatti dalla webcam con imagesnap (brew install imagesnap). Usato da `npm run scatta` e dalla pagina Live.

const run = promisify(execFile);

// I nomi delle fotocamere possono contenere spazi speciali (es. "MacBook Air"):
// li normalizziamo e cerchiamo per sottostringa.
const normalizza = (s: string) => s.replace(/\s+/g, " ").toLowerCase();

export async function elencoFotocamere(): Promise<string[]> {
  const { stdout } = await run("imagesnap", ["-l"]);
  return stdout.split("\n").filter((r) => r.startsWith("=> ")).map((r) => r.slice(3).trim());
}

// La fotocamera il cui nome contiene `parte` (es. "MacBook", "iPhone").
export async function trovaFotocamera(parte: string): Promise<string> {
  const fotocamere = await elencoFotocamere();
  const camera = fotocamere.find((f) => normalizza(f).includes(normalizza(parte)));
  if (!camera) throw new Error(`Nessuna fotocamera contiene "${parte}". Disponibili: ${fotocamere.join(", ")}`);
  return camera;
}

// "2026-10-13_15-04-20" nell'ora locale: ordinabile e leggibile.
const timestamp = () => new Date().toLocaleString("sv-SE").replace(" ", "_").replaceAll(":", "-");

// Scatta una foto e restituisce il percorso del file (es. photos/cam_2026-10-13_15-04-20.jpg).
export async function scattaFoto(camera: string, cartella = "photos"): Promise<string> {
  mkdirSync(cartella, { recursive: true });
  const file = join(cartella, `cam_${timestamp()}.jpg`);
  // -w 1: un secondo di "riscaldamento" perché la webcam regoli luce e messa a fuoco.
  await run("imagesnap", ["-q", "-w", "1", "-d", camera, file]);
  return file;
}
