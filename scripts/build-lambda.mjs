// Impacchetta le Lambda con esbuild: per ogni handler infra/build/<nome>/index.mjs più i chunk degli import dinamici.
// Terraform poi li zippa (archive_file) e li carica: il build è separato dal deploy.
// Uso: npm run build:lambda   (prima di terraform plan/apply)
import { build } from "esbuild";
import { cpSync, rmSync, statSync } from "node:fs";

const LAMBDA = { api: "src/aws/api.ts", "analizza-foto": "src/aws/analizza-foto.ts" };

rmSync("infra/build", { recursive: true, force: true });
for (const [nome, entry] of Object.entries(LAMBDA)) {
  const outfile = `infra/build/${nome}/index.mjs`;
  await build({
    entryPoints: { index: entry },
    outdir: `infra/build/${nome}`,
    // Con splitting gli import() dinamici restano file a parte, caricati solo se servono.
    // Senza, esbuild li incorpora e l'import di CLIP (external) finisce in cima a index.mjs: la Lambda non parte.
    splitting: true,
    chunkNames: "chunk-[hash]",
    outExtension: { ".js": ".mjs" }, // Lambda tratta come ESM solo i .mjs (non c'è un package.json con "type": "module")
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    minify: true,
    sourcemap: true, // index.mjs.map accanto: con NODE_OPTIONS=--enable-source-maps gli errori nei log hanno file e riga del .ts
    // CLIP non gira su Lambda (IMPRONTE_IMMAGINI=no) e si carica solo con import dinamico: resta fuori.
    // pg-native è un'alternativa opzionale di pg che non usiamo.
    external: ["@huggingface/transformers", "pg-native"],
    // Alcune dipendenze CommonJS usano require(): in un bundle ESM va ricreato.
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    logLevel: "warning",
  });
  // Il certificato delle CA di RDS: connessione.ts lo legge da config/, relativo alla cartella di lavoro (/var/task).
  cpSync("config/rds-ca-eu-south-1.pem", `infra/build/${nome}/config/rds-ca-eu-south-1.pem`);
  console.log(`✓ ${outfile} (${(statSync(outfile).size / 1024 / 1024).toFixed(1)} MB)`);
}
