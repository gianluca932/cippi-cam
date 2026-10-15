import "../comune/env.js"; // per primo: carica .env prima di leggere process.env
import { readFileSync } from "node:fs";
import pg from "pg";
import { Signer } from "@aws-sdk/rds-signer";
import { z } from "zod";

// Come si parla con Postgres. Le query (in db.ts) sono le stesse per tutti e due i modi, cambia solo il login:
//   pg   → DATABASE_URL con utente e password (in locale, Docker)
//   rds  → RDS Postgres su AWS, utente senza password: si entra con un token IAM firmato (vale 15 minuti,
//          serve solo all'apertura della connessione) e solo in SSL, verificando il certificato di RDS.
//          Così le Lambda stanno fuori dalla VPC (niente NAT) e la porta aperta da sola non basta per entrare.

export type Risultato<T> = { rows: T[]; rowCount: number };
export type Esecutore = {
  query<T = Record<string, unknown>>(sql: string, parametri?: unknown[]): Promise<Risultato<T>>;
};
export type Connessione = Esecutore & {
  /** Più scritture collegate: tutto o niente. */
  transazione<R>(lavoro: (q: Esecutore) => Promise<R>): Promise<R>;
  chiudi(): Promise<void>;
};

const Env = z.discriminatedUnion("DB_PROVIDER", [
  z.object({
    DB_PROVIDER: z.literal("pg"),
    DATABASE_URL: z.string().default("postgres://cippi:cippi@localhost:5432/cippi"),
  }),
  z.object({
    DB_PROVIDER: z.literal("rds"),
    DB_HOST: z.string().min(1),
    DB_PORT: z.coerce.number().int().default(5432),
    DB_NAME: z.string().default("cippi"),
    DB_USER: z.string().default("diario"),
    AWS_REGION: z.string().default("eu-south-1"),
  }),
]);

// Il certificato delle CA di RDS (pubblico, da truststore.pki.rds.amazonaws.com): Node non lo conosce.
// Il percorso è relativo alla cartella di lavoro: la radice del repo sul Mac, /var/task su Lambda (lo copia build-lambda).
export const sslRds = () => ({ ca: readFileSync("config/rds-ca-eu-south-1.pem", "utf8") });

export function connessionePg(config: pg.PoolConfig): Connessione {
  const pool = new pg.Pool(config);
  const esecutore = (c: pg.Pool | pg.PoolClient): Esecutore => ({
    async query<T>(sql: string, parametri: unknown[] = []) {
      const r = await c.query(sql, parametri);
      return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
    },
  });
  return {
    ...esecutore(pool),
    async transazione(lavoro) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const risultato = await lavoro(esecutore(client));
        await client.query("COMMIT");
        return risultato;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
    chiudi: () => pool.end(),
  };
}

export function apriConnessione(): Connessione {
  const env = Env.parse({ ...process.env, DB_PROVIDER: process.env.DB_PROVIDER ?? "pg" });
  if (env.DB_PROVIDER === "pg") return connessionePg({ connectionString: env.DATABASE_URL });

  // Credenziali dall'ambiente: ruolo IAM della Lambda, profilo AWS sul Mac.
  const signer = new Signer({ hostname: env.DB_HOST, port: env.DB_PORT, username: env.DB_USER, region: env.AWS_REGION });
  return connessionePg({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: () => signer.getAuthToken(), // pg la chiede a ogni connessione nuova: il token è sempre fresco
    ssl: sslRds(),
    // Un db.t4g.micro regge poche decine di connessioni: ogni Lambda ne tiene al massimo 2.
    max: 2,
  });
}
