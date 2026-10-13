// Avvia tutto per lo sviluppo: Postgres (Docker), API (Hono) e interfaccia (Vite).
// Uso: npm run dev   ·   Ctrl+C ferma tutto.
// Node puro, senza dipendenze: ogni processo ha il suo prefisso colorato nel terminale.

import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const COLORI = { api: "\x1b[36m", web: "\x1b[35m", dev: "\x1b[33m" };
const RESET = "\x1b[0m";
const log = (nome, riga) => console.log(`${COLORI[nome]}[${nome}]${RESET} ${riga}`);

// 1. Postgres: docker compose up -d non fa niente se è già acceso.
log("dev", "avvio Postgres (docker compose up -d)…");
const db = spawnSync("docker", ["compose", "up", "-d"], { stdio: "pipe", encoding: "utf8" });
if (db.status !== 0) {
  log("dev", `⚠️  Postgres non avviato: ${(db.stderr || db.error?.message || "").trim().split("\n")[0]}`);
  log("dev", "   Docker è acceso? Continuo comunque: l'API mostrerà l'errore alla prima query.");
}

// 2. API e interfaccia, ognuno nel suo gruppo di processi (npm lancia a sua volta tsx o vite).
const processi = [
  { nome: "api", comando: "npm", args: ["run", "server"], cwd: "." },
  { nome: "web", comando: "npm", args: ["run", "dev"], cwd: "web" },
].map(({ nome, comando, args, cwd }) => {
  const figlio = spawn(comando, args, { cwd, detached: true, env: { ...process.env, FORCE_COLOR: "1" } });
  for (const flusso of [figlio.stdout, figlio.stderr]) {
    createInterface({ input: flusso }).on("line", (riga) => log(nome, riga));
  }
  figlio.on("exit", (codice) => {
    log(nome, `terminato (codice ${codice ?? "segnale"})`);
    ferma(); // se uno si chiude, si ferma anche l'altro
  });
  return figlio;
});

log("dev", `interfaccia: http://localhost:5173 · API: http://localhost:3001/api · Ctrl+C per fermare`);

// 3. Uscita pulita: si ferma l'intero gruppo di ogni processo, figli compresi.
let fermando = false;
function ferma() {
  if (fermando) return;
  fermando = true;
  for (const p of processi) {
    try {
      process.kill(-p.pid, "SIGTERM");
    } catch {
      // già terminato
    }
  }
  setTimeout(() => process.exit(0), 500);
}
process.on("SIGINT", ferma);
process.on("SIGTERM", ferma);
