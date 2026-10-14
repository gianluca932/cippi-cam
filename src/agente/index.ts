import { AIMessage, AIMessageChunk, createAgent, HumanMessage, ToolMessage, type BaseMessage } from "langchain";
import type { EventoChat, PassoTraccia } from "../api-types.js";
import { modelloChat } from "../llm.js";
import { argomentiPuliti, ContestoAgente, guardrailRisposteInventate, promptDelGiorno } from "./middleware.js";
import { systemPrompt } from "./prompt.js";
import { STRUMENTI } from "./strumenti.js";

// L'agente della chat, costruito con LangChain (createAgent) sopra LangGraph.
//
// 📘 LangChain + LangGraph — cosa fa createAgent
// Costruisce un grafo LangGraph con due nodi, "modello" e "tool", e gli archi tra loro:
//   modello ──(ha chiamato un tool?)──► tool ──► modello ──► … ──(risposta senza tool)──► fine
// È il pattern ReAct (Reason + Act): il ciclo che prima scrivevamo a mano con un for e MAX_GIRI.
// Lo stato del grafo è la lista dei messaggi: domanda, risposte del modello, risultati dei tool.
// I middleware (vedi middleware.ts) aggiungono le nostre regole senza toccare il ciclo.

const MAX_PASSI = 12; // recursionLimit: ogni nodo eseguito è un passo. Evita cicli infiniti (prima: MAX_GIRI = 5 giri).

// Il grafo si costruisce una volta sola e si riusa per tutte le domande.
let agente: Awaited<ReturnType<typeof creaAgente>> | undefined;
async function creaAgente() {
  return createAgent({
    model: await modelloChat(),
    tools: STRUMENTI,
    systemPrompt: systemPrompt(), // aggiornato a ogni chiamata dal middleware promptDelGiorno
    contextSchema: ContestoAgente,
    middleware: [promptDelGiorno, guardrailRisposteInventate, argomentiPuliti],
  });
}

export type TurnoChat = { ruolo: "utente" | "assistente"; testo: string };

/**
 * Fa una domanda all'agente.
 * emetti riceve gli eventi man mano (per lo streaming in chat); senza, si aspetta solo il risultato finale.
 * La firma è la stessa della versione senza LangChain: server e chat non si accorgono del cambio.
 */
export async function chiediAllAgente(
  domanda: string,
  storia: TurnoChat[] = [],
  emetti: (e: EventoChat) => void = () => {},
): Promise<{ risposta: string; traccia: PassoTraccia[] }> {
  agente ??= await creaAgente();

  const traccia: PassoTraccia[] = [];
  const aggiungi = (passo: PassoTraccia) => {
    traccia.push(passo);
    if (passo.tipo !== "pensiero") emetti({ tipo: "passo", passo }); // il pensiero arriva già a pezzetti
  };

  // La conversazione: gli ultimi scambi (per domande tipo "e Sky?") più la domanda nuova.
  const messaggi: BaseMessage[] = [
    ...storia.map((t) => (t.ruolo === "utente" ? new HumanMessage(t.testo) : new AIMessage(t.testo))),
    new HumanMessage(domanda),
  ];

  // 📘 LangGraph — stream con due "modalità" insieme:
  //   "messages": i pezzetti di testo mentre il modello li genera (token per token);
  //   "updates":  cosa ha prodotto ogni nodo quando finisce (la risposta del modello, i risultati dei tool).
  // Ogni elemento dello stream è una coppia [modalità, dati].
  const stream = await agente.stream(
    { messages: messaggi },
    {
      streamMode: ["messages", "updates"],
      recursionLimit: MAX_PASSI,
      context: { segnala: (testo: string) => aggiungi({ tipo: "guardrail", testo }) },
    },
  );

  let toolUsato = false; // la risposta va in streaming solo dopo un tool (vedi sotto)
  let pensiero = ""; // il ragionamento della chiamata in corso, a pezzetti
  let risposta = "";
  const argomentiPerChiamata = new Map<string, Record<string, unknown>>(); // id della chiamata → argomenti

  try {
    for await (const [modalita, dati] of stream) {
      if (modalita === "messages") {
        const [pezzo] = dati as [BaseMessage, unknown];
        if (!AIMessageChunk.isInstance(pezzo)) continue;

        // Il ragionamento (solo con il modello "ragionante") arriva in un campo a parte.
        const ragionamento = pezzo.additional_kwargs?.reasoning_content;
        if (typeof ragionamento === "string" && ragionamento) {
          pensiero += ragionamento;
          emetti({ tipo: "pensiero", testo: ragionamento });
        }
        // La risposta va in streaming solo dopo che è stato usato un tool: una risposta senza tool
        // potrebbe essere inventata, e il guardrail deve poterla scartare prima che compaia.
        if (toolUsato && pezzo.text) emetti({ tipo: "testo", testo: pezzo.text });
        continue;
      }

      // modalita === "updates": { nomeNodo: { messages: [...] } } per ogni nodo che ha finito.
      for (const aggiornamento of Object.values(dati as Record<string, { messages?: BaseMessage[] }>)) {
        for (const messaggio of aggiornamento?.messages ?? []) {
          if (AIMessage.isInstance(messaggio)) {
            // Il modello ha finito: chiudiamo il pensiero di questa chiamata, se c'era.
            if (pensiero) aggiungi({ tipo: "pensiero", testo: pensiero.trim() });
            pensiero = "";
            // Nella traccia mostriamo gli argomenti come li vede il tool (senza "" e null, vedi argomentiPuliti).
            for (const chiamata of messaggio.tool_calls ?? []) argomentiPerChiamata.set(chiamata.id ?? "", senzaVuoti(chiamata.args));
            if (!messaggio.tool_calls?.length) risposta = separaPensiero(messaggio.text).risposta;
          }
          if (ToolMessage.isInstance(messaggio)) {
            toolUsato = true;
            const errore = messaggio.status === "error" ? "il tool ha restituito un errore" : undefined;
            aggiungi({
              tipo: "tool",
              nome: messaggio.name ?? "?",
              argomenti: argomentiPerChiamata.get(messaggio.tool_call_id) ?? {},
              risultato: abbrevia(messaggio.text),
              ...(errore && { errore }),
            });
          }
        }
      }
    }
  } catch (errore) {
    // Superato recursionLimit (il modello continua a chiamare tool senza concludere).
    if ((errore as Error).name !== "GraphRecursionError") throw errore;
    risposta = "Non sono riuscito a trovare una risposta: troppi passaggi. Prova a riformulare.";
  }

  risposta ||= "Non sono riuscito a trovare una risposta. Prova a riformulare.";
  emetti({ tipo: "fine", risposta, traccia });
  return { risposta, traccia };
}

// Qwen3 a volte scrive il ragionamento nel testo, chiuso da </think>: lo separiamo dalla risposta.
function separaPensiero(testo: string): { pensiero?: string; risposta: string } {
  if (!testo.includes("</think>")) return { risposta: testo.trim() };
  const [pensiero, ...resto] = testo.split("</think>");
  return { pensiero: pensiero.replace("<think>", "").trim(), risposta: resto.join("").trim() };
}

const senzaVuoti = (args: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(args).filter(([, valore]) => valore !== "" && valore !== null));

// Il risultato di un tool, accorciato per mostrarlo nella traccia.
function abbrevia(testo: string, max = 220) {
  return testo.length > max ? `${testo.slice(0, max)}…` : testo;
}
