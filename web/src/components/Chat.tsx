import { useEffect, useRef, useState, type FormEvent } from "react";
import { askCippi } from "../mock";

type Message = { role: "user" | "assistant"; text: string };

const SUGGESTIONS = ["Cosa ha fatto Cippi oggi?", "Quante volte ha mangiato?", "Ha dormito?"];

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: "Ciao! Chiedimi cosa ha fatto Cippi oggi." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    if (!text.trim() || loading) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setLoading(true);
    const answer = await askCippi(text);
    setMessages((m) => [...m, { role: "assistant", text: answer }]);
    setLoading(false);
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
          <div key={i} className={`bubble ${m.role}`}>{m.text}</div>
        ))}
        {loading && <div className="bubble assistant muted">Sto guardando il diario…</div>}
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
