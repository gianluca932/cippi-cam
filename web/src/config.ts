// Configurazione di Cippi Cam per ambiente.
// Per ora vive nel frontend; quando arriva il backend la sposteremo lì (e i segreti in .env / AWS Secrets Manager).

export type Ambiente = "locale" | "aws";

export type AppConfig = {
  modelli: {
    provider: string;
    endpoint: string;
    visione: string; // gli "occhi": classifica le foto
    chat: string; // il "cervello": l'agente che legge il diario
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
      chat: "qwen3:4b",
      contesto: 8192,
      sogliaConfidenza: 0.6,
    },
    database: { tipo: "SQLite", connessione: "./data/cippi.db" },
    storageFoto: { tipo: "Filesystem", percorso: "./photos" },
    calcolo: { tipo: "MacBook", dettagli: "Node.js + Ollama sulla stessa macchina" },
    rete: { accesso: "solo localhost" },
  },
  aws: {
    modelli: {
      provider: TBD, // Ollama su EC2 con GPU oppure Amazon Bedrock
      endpoint: TBD,
      visione: TBD,
      chat: TBD,
      contesto: 8192,
      sogliaConfidenza: 0.6,
    },
    database: { tipo: TBD, connessione: TBD }, // DynamoDB oppure RDS Postgres
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
