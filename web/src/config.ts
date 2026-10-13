// Configurazione di Cippi Cam per ambiente.
// Per ora è solo da mostrare; i valori veri vivono nel backend (env) e i segreti andranno in AWS Secrets Manager.

export type Ambiente = "locale" | "aws";

export type AppConfig = {
  modelli: {
    provider: string;
    endpoint: string;
    visione: string; // gli "occhi": classifica le foto
    chat: string; // il "cervello": l'agente che legge il diario
    embedding: string; // ricerca semantica sulle descrizioni
    contesto: number; // num_ctx
    sogliaConfidenza: number;
  };
  database: {
    tipo: string;
    connessione: string;
  };
  storageFoto: {
    tipo: string;
    percorso: string;
  };
  calcolo: {
    tipo: string;
    dettagli: string;
  };
  rete: {
    region?: string;
    vpc?: string;
    subnet?: string;
    securityGroup?: string;
    accesso: string;
  };
};

const TBD = "da definire";

export const configs: Record<Ambiente, AppConfig> = {
  locale: {
    modelli: {
      provider: "Ollama",
      endpoint: "http://localhost:11434",
      visione: "qwen3.5:9b",
      chat: "qwen3.5:9b (lo stesso della visione)",
      embedding: "nomic-embed-text (768 dim)",
      contesto: 8192,
      sogliaConfidenza: 0.6,
    },
    database: { tipo: "Postgres 17 + pgvector (Docker)", connessione: "postgres://localhost:5432/cippi" },
    storageFoto: { tipo: "Filesystem", percorso: "photos/ → data/foto/ (1024px)" },
    calcolo: { tipo: "MacBook", dettagli: "Node.js (Hono, porta 3001) + Ollama + Docker" },
    rete: { accesso: "solo localhost" },
  },
  aws: {
    modelli: {
      provider: TBD, // Ollama su EC2 con GPU oppure Amazon Bedrock
      endpoint: TBD,
      visione: TBD,
      chat: TBD,
      embedding: TBD,
      contesto: 8192,
      sogliaConfidenza: 0.6,
    },
    database: { tipo: "RDS Postgres + pgvector", connessione: TBD }, // stesso SQL del locale
    storageFoto: { tipo: "S3", percorso: `s3://${TBD}` },
    calcolo: { tipo: TBD, dettagli: TBD }, // Lambda, ECS Fargate o EC2
    rete: {
      region: "eu-south-1 (Milano)",
      vpc: TBD,
      subnet: TBD,
      securityGroup: TBD,
      accesso: TBD,
    },
  },
};
