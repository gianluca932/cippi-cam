import "../comune/env.js"; // per primo: carica .env prima che gli altri moduli leggano process.env
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Embeddings } from "@langchain/core/embeddings";
import { ChatOllama, OllamaEmbeddings } from "@langchain/ollama";
import { z } from "zod";

// La "fabbrica dei modelli": l'unico punto del progetto che sa QUALE provider stiamo usando.
// Il resto del codice chiede "un modello per la chat", "un modello per la visione", "gli embedding"
// e riceve oggetti LangChain con la stessa interfaccia, che sotto ci sia Ollama o Bedrock.
//
// 📘 LangChain — perché funziona
// ChatOllama e ChatBedrockConverse estendono la stessa classe (BaseChatModel): .invoke(), .stream(),
// .bindTools(), .withStructuredOutput() funzionano uguali. Idem OllamaEmbeddings e BedrockEmbeddings (Embeddings).
//
// Per passare ad AWS:   LLM_PROVIDER=bedrock  AWS_REGION=eu-central-1  VISION_MODEL=…  AGENT_MODEL=…  EMBED_MODEL=…
// Le credenziali AWS le trova da solo l'SDK (aws sso login, ~/.aws/credentials, ruolo IAM su Lambda): mai nel codice.

// --- Configurazione: letta dall'ambiente e validata con Zod, come ogni dato che entra da fuori ---

const Env = z.object({
  LLM_PROVIDER: z.enum(["ollama", "bedrock"]).default("ollama"),
  OLLAMA_URL: z.url().default("http://localhost:11434"),
  AWS_REGION: z.string().default("eu-central-1"),
  VISION_MODEL: z.string().optional(),
  AGENT_MODEL: z.string().optional(),
  // Su Ollama il "ragionamento" è un'opzione dello stesso modello (think: true).
  // Su Bedrock dipende dalla famiglia di modelli: qui si può indicare un modello diverso per i casi difficili.
  AGENT_MODEL_RAGIONANTE: z.string().optional(),
  EMBED_MODEL: z.string().optional(),
  // Deve coincidere con la colonna embedding_testo (vector(768)): vedi controllaDimensioniEmbedding in db.ts.
  EMBED_DIMENSIONI: z.coerce.number().int().positive().optional(),
});
const env = Env.parse(process.env);

// Valori di default per provider. Su Bedrock non ce ne sono: i modelli disponibili dipendono
// dall'account e dalla region, quindi vanno scelti esplicitamente.
const DEFAULT = {
  ollama: { visione: "qwen3.5:9b", agente: "qwen3.5:9b", embedding: "nomic-embed-text", dimensioni: 768 },
  bedrock: { visione: undefined, agente: undefined, embedding: undefined, dimensioni: 1024 },
} as const;

function richiesto(valore: string | undefined, variabile: string): string {
  if (!valore) throw new Error(`Con LLM_PROVIDER=${env.LLM_PROVIDER} serve la variabile d'ambiente ${variabile}`);
  return valore;
}

const d = DEFAULT[env.LLM_PROVIDER];

/** Cosa stiamo usando, per i log e per salvare nel database quale modello ha prodotto un dato. */
export const configLlm = {
  provider: env.LLM_PROVIDER,
  ollamaUrl: env.OLLAMA_URL,
  visione: env.VISION_MODEL ?? d.visione,
  agente: env.AGENT_MODEL ?? d.agente,
  agenteRagionante: env.AGENT_MODEL_RAGIONANTE,
  embedding: env.EMBED_MODEL ?? d.embedding,
  dimensioniEmbedding: env.EMBED_DIMENSIONI ?? d.dimensioni,
};

// Bedrock si carica solo se serve (import dinamico): chi usa Ollama non paga l'avvio dell'SDK AWS.
const aws = () => import("@langchain/aws");

// --- I tre "costruttori" ---

/**
 * Il modello della chat (l'agente).
 * ragionamento: true → più lento ma più affidabile nello scegliere i tool (lo usa il guardrail).
 */
export async function modelloChat({ ragionamento = false } = {}): Promise<BaseChatModel> {
  const nome = richiesto(configLlm.agente, "AGENT_MODEL");
  if (env.LLM_PROVIDER === "ollama") {
    return new ChatOllama({
      model: nome,
      baseUrl: env.OLLAMA_URL,
      temperature: 0, // stesse domande → stesse risposte: più facile da misurare
      numCtx: 8192, // system prompt + storia + risultati dei tool
      think: ragionamento,
    });
  }
  const { ChatBedrockConverse } = await aws();
  return new ChatBedrockConverse({
    model: ragionamento ? (configLlm.agenteRagionante ?? nome) : nome,
    region: env.AWS_REGION,
    temperature: 0,
  });
}

/** Il modello di visione: guarda la foto e risponde con l'output strutturato (vedi src/modelli.ts). */
export async function modelloVisione(): Promise<BaseChatModel> {
  const nome = richiesto(configLlm.visione, "VISION_MODEL");
  if (env.LLM_PROVIDER === "ollama") {
    return new ChatOllama({
      model: nome,
      baseUrl: env.OLLAMA_URL,
      temperature: 0,
      numCtx: 8192, // la foto da sola occupa ~1000 token a 1024px (~4000 a piena risoluzione)
      think: false, // niente ragionamento: per classificare è solo più lento
    });
  }
  const { ChatBedrockConverse } = await aws();
  return new ChatBedrockConverse({ model: nome, region: env.AWS_REGION, temperature: 0 });
}

/** Il modello di embedding per la ricerca semantica (nome: per confrontarne altri, vedi confronta-embedding.ts). */
export async function modelloEmbedding(nome = richiesto(configLlm.embedding, "EMBED_MODEL")): Promise<Embeddings> {
  if (env.LLM_PROVIDER === "ollama") {
    return new OllamaEmbeddings({ model: nome, baseUrl: env.OLLAMA_URL });
  }
  const { BedrockEmbeddings } = await aws();
  return new BedrockEmbeddings({ model: nome, region: env.AWS_REGION, dimensions: configLlm.dimensioniEmbedding });
}

// Ogni modello si crea una volta sola e poi si riusa (i costruttori sono async per via dell'import di AWS).
const cache = new Map<string, Promise<unknown>>();
export const unaVolta = <T>(chiave: string, crea: () => Promise<T>): Promise<T> => {
  if (!cache.has(chiave)) cache.set(chiave, crea());
  return cache.get(chiave) as Promise<T>;
};
