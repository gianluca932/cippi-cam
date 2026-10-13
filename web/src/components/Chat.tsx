import { useEffect, useRef, useState, type FormEvent } from "react";
import { chiediInStreaming, type ChatApi, type EventoChat, type PassoTraccia } from "../api";

type Message = { role: "user" | "assistant"; text: string; traccia?: ChatApi["traccia"] };

const SUGGESTIONS = ["Quante volte ha mangiato Cippi oggi?", "Cosa ha fatto Sky oggi?", "C'è abbastanza acqua?"];
const BENVENUTO: Message = {
  role: "assistant",
  text: "Ciao! Chiedimi cosa hanno fatto Cippi e Sky, quante volte hanno mangiato, o com'è messa la gabbia.",
};

// Il modello a volte usa il markdown: togliamo gli asterischi invece di chiederglielo nel prompt
// (una regola in più nel prompt gli faceva smettere di usare i tool).
const senzaMarkdown = (t: string) => t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^\s*\*\s+/gm, "• ");

// "conta_eventi(uccellino: Cippi, azione: mangia)"
const descriviTool = (p: Extract<PassoTraccia, { tipo: "tool" }>) =>
  `${p.nome}(${Object.entries(p.argomenti).map(([k, v]) => `${k}: ${v}`).join(", ")})`;

// I passaggi dell'agente, in grigio sopra la risposta: come se stesse pensando.
function Traccia({ passi }: { passi: PassoTraccia[] }) {
  return (
    <div className="traccia">
      {passi.map((p, i) => {
        if (p.tipo === "pensiero") return <p key={i}>🧠 {p.testo}</p>;
        if (p.tipo === "guardrail") return <p key={i} className="guardrail">🛡️ {p.testo}</p>;
        return (
          <div key={i} className={p.errore ? "errore" : ""}>
            <p>🔧 {descriviTool(p)}{p.errore && ` — ${p.errore}`}</p>
            <p className="risultato">↳ {p.risultato}</p>
          </div>
        );
      })}
    </div>
  );
}

// Applica un evento dello streaming alla bolla della risposta in corso.
function applica(m: Message, e: EventoChat): Message {
  const traccia = [...(m.traccia ?? [])];
  switch (e.tipo) {
    case "pensiero": {
      // I pezzetti di ragionamento si attaccano all'ultimo pensiero, se è l'ultimo passo.
      const ultimo = traccia.at(-1);
      if (ultimo?.tipo === "pensiero") traccia[traccia.length - 1] = { ...ultimo, testo: ultimo.testo + e.testo };
      else traccia.push({ tipo: "pensiero", testo: e.testo });
      return { ...m, traccia };
    }
    case "passo":
      return { ...m, traccia: [...traccia, e.passo] };
    case "testo":
      return { ...m, text: m.text + e.testo };
    case "fine": // la versione definitiva del server sostituisce quella costruita a pezzi
      return { ...m, text: e.risposta, traccia: e.traccia };
    case "errore":
      return { ...m, text: `⚠️ Errore: ${e.messaggio}` };
  }
}

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([BENVENUTO]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    // Gli ultimi scambi (senza il benvenuto) danno contesto per domande tipo "e Sky?".
    const storia = messages
      .filter((m) => m !== BENVENUTO && !m.text.startsWith("⚠️"))
      .slice(-6)
      .map((m) => ({ ruolo: m.role === "user" ? ("utente" as const) : ("assistente" as const), testo: m.text }));

    // La bolla della risposta parte vuota e si riempie a ogni evento.
    setMessages((m) => [...m, { role: "user", text }, { role: "assistant", text: "", traccia: [] }]);
    setInput("");
    setLoading(true);
    const aggiornaUltima = (f: (m: Message) => Message) =>
      setMessages((ms) => [...ms.slice(0, -1), f(ms[ms.length - 1])]);
    try {
      await chiediInStreaming(text, storia, (e) => aggiornaUltima((m) => applica(m, e)));
    } catch (e) {
      aggiornaUltima((m) => ({ ...m, text: `⚠️ Errore: ${(e as Error).message}` }));
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  return (
    <section className="panel chat">
      <h2>Chat</h2>
      <div className="messages">
        {messages.map((m, i) => {
          // Finché la risposta non inizia, la bolla mostra il "pensiero" (che pulsa piano);
          // appena arriva il primo pezzo di risposta, il pensiero sparisce.
          const staPensando = loading && i === messages.length - 1 && !m.text;
          return (
            <div key={i} className={`bubble ${m.role}`}>
              {staPensando ? (
                <div className="pensando">
                  <p className="pensando-etichetta">Sto pensando…</p>
                  {!!m.traccia?.length && <Traccia passi={m.traccia} />}
                </div>
              ) : (
                <span className="risposta">{m.role === "assistant" ? senzaMarkdown(m.text) : m.text}</span>
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <div className="suggestions">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" onClick={() => send(s)} disabled={loading}>{s}</button>
        ))}
      </div>
      <form onSubmit={onSubmit} className="composer">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Scrivi una domanda…"
        />
        <button type="submit" disabled={loading || !input.trim()}>Invia</button>
      </form>
    </section>
  );
}
