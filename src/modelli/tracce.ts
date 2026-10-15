import { Client } from "langsmith";
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";

// Tracce su LangSmith (LANGSMITH_TRACING=true nel .env): LangChain e LangGraph le mandano da soli.
// Qui c'è solo l'eccezione per la visione: le foto (base64 dentro il messaggio) non devono uscire dal diario.
// Pesano centinaia di KB a traccia e sono scatti di casa: nella traccia restano prompt, risposta e token.
//
// Come funziona: LangChain aggiunge il tracer dell'ambiente solo se la chiamata non ne ha già uno.
// Passando un tracer con hideInputs, la chiamata di visione usa quello, con le immagini sostituite.

const IMMAGINE = /^data:image\/[a-z]+;base64,/;

function senzaImmagini(valore: unknown): unknown {
  if (typeof valore === "string") return IMMAGINE.test(valore) ? "[immagine]" : valore;
  if (Array.isArray(valore)) return valore.map(senzaImmagini);
  if (valore && typeof valore === "object")
    return Object.fromEntries(Object.entries(valore).map(([k, v]) => [k, senzaImmagini(v)]));
  return valore;
}

let tracer: LangChainTracer | undefined;

/** Config da passare a invoke() nelle chiamate con immagini. Vuota se il tracing è spento: un tracer lo accenderebbe. */
export function configSenzaImmagini() {
  if (process.env.LANGSMITH_TRACING !== "true") return {};
  tracer ??= new LangChainTracer({
    client: new Client({ hideInputs: (inputs) => senzaImmagini(inputs) as typeof inputs }),
  });
  return { callbacks: [tracer] };
}
