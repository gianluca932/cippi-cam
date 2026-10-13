import { useEffect, useRef, useState, type FormEvent } from "react";
import { chiediAlDiario, type ChatApi } from "../api";

type Message = { role: "user" | "assistant"; text: string; strumenti?: ChatApi["strumenti"] };

const SUGGESTIONS = ["Quante volte ha mangiato Cippi oggi?", "Cosa ha fatto Sky oggi?", "C'è abbastanza acqua?"];
const BENVENUTO: Message = {
  role: "assistant",
  text: "Ciao! Chiedimi cosa hanno fatto Cippi e Sky, quante volte hanno mangiato, o com'è messa la gabbia.",
};

// Il modello a volte usa il markdown: togliamo gli asterischi invece di chiederglielo nel prompt
// (una regola in più nel prompt gli faceva smettere di usare i tool).
const senzaMarkdown = (t: string) => t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^\s*\*\s+/gm, "• ");

// "conta_eventi(uccellino: Cippi, azione: mangia)"
const descriviTool = (s: ChatApi["strumenti"][number]) =>
  `${s.nome}(${Object.entries(s.argomenti).map(([k, v]) => `${k}: ${v}`).join(", ")})`;

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
      const { risposta, strumenti } = await chiediAlDiario(text, storia);
      setMessages((m) => [...m, { role: "assistant", text: senzaMarkdown(risposta), strumenti }]);
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
            {m.text}
            {!!m.strumenti?.length && (
              <div className="strumenti">
                {m.strumenti.map((s, j) => (
                  <div key={j} className={s.errore ? "errore" : ""}>
                    🔧 {descriviTool(s)}
                    {s.errore && ` — ${s.errore}`}
                  </div>
                ))}
              </div>
            )}
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
