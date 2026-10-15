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
    // Le scelte dell'infrastruttura (infra/*.tf). I modelli di Bedrock si decidono misurando con valuta.
    modelli: {
      provider: "Amazon Bedrock",
      endpoint: "bedrock-runtime.eu-south-1.amazonaws.com",
      visione: "Qwen3-VL 235B (azioni 56%, cibo 94% su 57 foto)",
      chat: "Qwen3 235B (testuale, con tool)",
      embedding: "Titan Text Embeddings v2 (1024 dim.)",
      contesto: 8192,
      sogliaConfidenza: 0.6,
    },
    database: { tipo: "RDS PostgreSQL 17 (db.t4g.micro) + pgvector", connessione: "SSL + token IAM, senza password" }, // stesso SQL del locale
    storageFoto: { tipo: "S3", percorso: "s3://cippi-cam-foto-<account>/data/foto/" },
    calcolo: { tipo: "AWS Lambda (Node 22, arm64)", dettagli: "S3 → SQS + DLQ → Lambda di analisi; API Hono in streaming" },
    rete: {
      region: "eu-south-1 (Milano)",
      vpc: "solo per il database; le Lambda stanno fuori, senza NAT",
      subnet: "2, in due zone di disponibilità",
      securityGroup: "solo la 5432: per entrare servono SSL e un token IAM",
      accesso: "CloudFront + password (Basic Auth)",
    },
  },
};
