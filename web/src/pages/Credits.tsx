const STACK = [
  ["Ollama", "modelli in locale"],
  ["qwen3.5:9b", "visione: classifica le foto"],
  ["qwen3:4b", "agente: risponde in chat leggendo il diario"],
  ["Zod", "contratto e validazione dell'output dei modelli"],
  ["React + TypeScript", "interfaccia"],
  ["Vite", "dev server e build"],
  ["React Router", "navigazione tra le pagine"],
];

export function Credits() {
  return (
    <section className="panel credits">
      <h2>Credits</h2>
      <p>
        <strong>Cippi Cam</strong> osserva Cippi, il pappagallino di casa, classifica cosa sta facendo e tiene
        un diario della sua giornata, che puoi interrogare in chat.
      </p>

      <h3>Protagonista</h3>
      <p>🐦 Cippi</p>

      <h3>Sviluppo</h3>
      <p>Gianluca Giordano, con l'aiuto di Claude Code</p>

      <h3>Stack</h3>
      <dl>
        {STACK.map(([name, role]) => (
          <div key={name} className="config-row">
            <dt>{name}</dt>
            <dd>{role}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
