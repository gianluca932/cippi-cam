import { AIMessage, createMiddleware, ToolMessage } from "langchain";
import { z } from "zod";
import { modelloChat, unaVolta } from "../modelli/llm.js";
import { systemPrompt } from "./prompt.js";

// I middleware dell'agente: codice nostro che si aggancia al ciclo di LangGraph.
//
// 📘 LangChain — il ciclo di createAgent e dove si agganciano i middleware
//
//        ┌──────────────── wrapModelCall ────────────────┐
//   ──►  │  chiamata al modello (decide: tool o risposta) │ ──► ha chiamato tool? ──sì──► wrapToolCall ──► tool ──┐
//        └───────────────────────────────────────────────┘           │                                          │
//                     ▲                                                no                                         │
//                     │                                                ▼                                          │
//                     └──────────────────────────────────────────── fine        ◄── torna al modello ◄────────────┘
//
// wrapModelCall(request, handler) "avvolge" ogni chiamata al modello:
//   - request contiene modello, messaggi, system prompt, tool, stato;
//   - handler(request) esegue davvero la chiamata e restituisce la risposta (un AIMessage);
//   - possiamo modificare la request prima, guardare la risposta dopo, e chiamare handler anche più volte.
// wrapToolCall(request, handler) fa lo stesso attorno all'esecuzione di un tool.
//
// I middleware si eseguono nell'ordine in cui li passiamo a createAgent (il primo è il più esterno).

// --- Il "contesto": dati che passiamo all'agente a ogni domanda, uguali per tutto il giro ---
// Qui ci passiamo una funzione per segnalare alla chat (in grigio) gli interventi del guardrail,
// e la lingua della domanda (lingua.ts), che decide la lingua della risposta.
export const ContestoAgente = z.object({
  segnala: z.custom<(testo: string) => void>().optional(),
  lingua: z.enum(["it", "en"]).optional(),
});

/** Il testo di un messaggio, che il provider lo dia come stringa o come lista di blocchi. */
const testoDi = (m: AIMessage) => m.text;

// 1. Il system prompt contiene la data di oggi: va ricostruito a ogni chiamata, altrimenti un server
//    acceso da ieri penserebbe che "oggi" sia ancora ieri.
export const promptDelGiorno = createMiddleware({
  name: "PromptDelGiorno",
  contextSchema: ContestoAgente,
  wrapModelCall: (request, handler) =>
    handler({ ...request, systemPrompt: systemPrompt(request.runtime.context?.lingua) }),
});

// 2. Guardrail contro le risposte inventate.
//    Il modello a volte risponde "a memoria" con orari e conteggi falsi, senza chiamare nessun tool.
//    Regola: se la risposta contiene numeri e in questa conversazione non è ancora stato usato un tool,
//    la scartiamo e rifacciamo la stessa chiamata con il ragionamento acceso.
//    La risposta scartata non entra mai nella conversazione: restituiamo direttamente la seconda.
export const guardrailRisposteInventate = createMiddleware({
  name: "GuardrailRisposteInventate",
  contextSchema: ContestoAgente,
  wrapModelCall: async (request, handler) => {
    const risposta = await handler(request);

    const haChiamatoTool = (risposta.tool_calls?.length ?? 0) > 0;
    const toolGiaUsati = request.messages.some((m) => ToolMessage.isInstance(m));
    const sospetta = !haChiamatoTool && !toolGiaUsati && /\d/.test(testoDi(risposta));
    if (!sospetta) return risposta;

    const segnala = request.runtime.context?.segnala ?? (() => {});
    segnala("Answer with numbers but no diary lookup: discarded, retrying with reasoning.");

    // Stessa richiesta, ma con il modello "ragionante": più lento, ma sceglie i tool molto meglio.
    const ragionante = await unaVolta("chat:ragionante", () => modelloChat({ ragionamento: true }));
    const seconda = await handler({ ...request, model: ragionante });

    const ancoraSospetta = !(seconda.tool_calls?.length) && /\d/.test(testoDi(seconda));
    if (!ancoraSospetta) return seconda;

    // Meglio nessuna risposta che una inventata.
    segnala("Again an answer without a diary lookup: discarded.");
    // La risposta di riserva è mostrata così com'è: nella lingua della domanda.
    return new AIMessage(
      request.runtime.context?.lingua === "en"
        ? "I couldn't look this up in the diary. Try rephrasing the question."
        : "Non sono riuscito a consultare il diario per questa domanda. Prova a riformularla.",
    );
  },
});

// 3. Argomenti dei tool: il modello a volte passa "" o null per dire "non specificato".
//    Li togliamo prima che Zod li valuti (altrimenti giorno: "" fallirebbe la regex YYYY-MM-DD).
//    E se il tool fallisce, restituiamo l'errore al modello come messaggio, così può correggersi.
export const argomentiPuliti = createMiddleware({
  name: "ArgomentiPuliti",
  wrapToolCall: async (request, handler) => {
    const args = Object.fromEntries(
      Object.entries(request.toolCall.args ?? {}).filter(([, valore]) => valore !== "" && valore !== null),
    );
    try {
      return await handler({ ...request, toolCall: { ...request.toolCall, args } });
    } catch (errore) {
      return new ToolMessage({
        content: JSON.stringify({ errore: (errore as Error).message }),
        tool_call_id: request.toolCall.id ?? "",
        name: request.toolCall.name,
        status: "error",
      });
    }
  },
});
