import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { z } from "zod";
import { connessionePg, sslRds } from "../db/connessione.js";
import { configLlm } from "../modelli/llm.js";
import { c } from "../comune/terminale.js";
import { UCCELLINI } from "../comune/uccellini.js";

// Lo schema e le migrazioni sul database di AWS (RDS Postgres).
// In locale c'è `npm run db:migra` con psql nel container; qui ci si collega dal Mac con pg.
//
// Uso: npm run db:migra:aws   (DB_HOST e DB_MASTER_SECRET_ARN nel .env: output env_mac di terraform)
//
// - Entra come utente master: la password la genera RDS e sta in Secrets Manager, non passa da Terraform né dal .env.
// - init.sql solo la prima volta (non è rilanciabile): se la tabella foto esiste già si salta.
// - Le migrazioni sono rilanciabili per regola (IF NOT EXISTS, DROP VIEW + CREATE VIEW): si applicano tutte, sempre.
// - embedding_testo nasce con le dimensioni del modello di embedding scelto (Titan: 1024), non con le 768 di nomic.
//   Lo script npm imposta LLM_PROVIDER=bedrock: senza, configLlm darebbe le dimensioni di Ollama.
//   Se la colonna esiste con dimensioni diverse si corregge solo a tabella vuota (con dati servirebbe ricalcolare gli embedding).
// - Allinea la tabella uccellini a config/uccellini.json: gli eventi la referenziano, e sulle Lambda nessuno la riempie.
// - Alla fine crea (o aggiorna) l'utente "diario" delle Lambda: login solo con token IAM, niente DDL.

const Env = z.object({
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().default(5432),
  DB_NAME: z.string().default("cippi"),
  DB_USER: z.string().default("diario"),
  DB_MASTER_SECRET_ARN: z.string().startsWith("arn:aws:secretsmanager:"),
});
const env = Env.parse(process.env);

const segreto = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: env.DB_MASTER_SECRET_ARN }));
const master = z.object({ username: z.string(), password: z.string() }).parse(JSON.parse(segreto.SecretString ?? "{}"));

const db = connessionePg({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: master.username,
  password: master.password,
  ssl: sslRds(),
});

// Allinea embedding_testo alle dimensioni attese. La vista eventi_effettivi dipende dalla colonna:
// si toglie qui e la ricreano le migrazioni subito dopo.
async function controllaDimensioni(dimensioni: number) {
  const { rows } = await db.query<{ tipo: string; righe: number }>(
    `SELECT format_type(atttypid, atttypmod) AS tipo, (SELECT count(*)::int FROM eventi) AS righe
       FROM pg_attribute WHERE attrelid = 'eventi'::regclass AND attname = 'embedding_testo'`,
  );
  const atteso = `vector(${dimensioni})`;
  if (rows[0].tipo === atteso) return;
  if (rows[0].righe > 0)
    throw new Error(`embedding_testo è ${rows[0].tipo}, servirebbe ${atteso}, ma eventi ha ${rows[0].righe} righe: serve una migrazione che ricalcoli gli embedding`);
  await db.query(`DROP VIEW IF EXISTS eventi_effettivi; ALTER TABLE eventi ALTER COLUMN embedding_testo TYPE ${atteso}`);
  console.log(`${c.verde("✓")} embedding_testo: ${rows[0].tipo} → ${atteso} (tabella vuota)`);
}

async function esegui(file: string, sostituisci = (sql: string) => sql) {
  await db.query(sostituisci(readFileSync(file, "utf8"))); // senza parametri pg accetta più istruzioni insieme
  console.log(`${c.verde("✓")} ${file}`);
}

// L'utente delle Lambda. Il nome è un identificatore SQL (non un parametro): lo controlla la regex.
const utenteApp = (nome: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(nome)) throw new Error(`DB_USER non valido: ${nome}`);
  return `
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${nome}') THEN CREATE ROLE ${nome} LOGIN; END IF;
    END $$;
    GRANT rds_iam TO ${nome};
    GRANT USAGE ON SCHEMA public TO ${nome};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${nome};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${nome};`;
};

try {
  console.log(c.grigio(`Mi collego a ${env.DB_HOST} come ${master.username}…`));
  const { rows } = await db.query<{ esiste: boolean }>("SELECT to_regclass('public.foto') IS NOT NULL AS esiste");

  const dimensioni = configLlm.dimensioniEmbedding;
  if (rows[0].esiste) {
    console.log(c.grigio("init.sql: schema già presente, salto"));
    await controllaDimensioni(dimensioni);
  } else await esegui("db/init.sql", (sql) => sql.replace("embedding_testo vector(768)", `embedding_testo vector(${dimensioni})`));

  const cartella = "db/migrazioni";
  for (const f of readdirSync(cartella).filter((f) => f.endsWith(".sql")).sort()) await esegui(join(cartella, f));

  // Come sincronizzaUccellini in db.ts, che però usa la connessione dell'app.
  for (const u of UCCELLINI)
    await db.query("INSERT INTO uccellini (nome, colore) VALUES ($1, $2) ON CONFLICT (nome) DO UPDATE SET colore = EXCLUDED.colore", [u.nome, u.colore]);
  console.log(`${c.verde("✓")} uccellini: ${UCCELLINI.map((u) => u.nome).join(", ")}`);

  await db.query(utenteApp(env.DB_USER));
  console.log(`${c.verde("✓")} utente ${env.DB_USER} (token IAM, solo lettura e scrittura dei dati)`);
  console.log(c.grigio(`\nSchema aggiornato. embedding_testo: ${dimensioni} dimensioni.`));
} finally {
  await db.chiudi();
}
