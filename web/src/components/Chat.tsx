import { useEffect, useRef, useState, type FormEvent } from "react";
import { chiediAlDiario, type ChatApi, type PassoTraccia } from "../api";

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

    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setLoading(true);
    try {
      const { risposta, traccia } = await chiediAlDiario(text, storia);
      setMessages((m) => [...m, { role: "assistant", text: senzaMarkdown(risposta), traccia }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: `⚠️ Errore: ${(e as Error).message}` }]);
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
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {!!m.traccia?.length && <Traccia passi={m.traccia} />}
            {m.text}
          </div>
        ))}
        {loading && <div className="bubble assistant muted">Sto consultando il diario…</div>}
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
