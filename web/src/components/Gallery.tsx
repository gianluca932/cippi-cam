import { EMOJI, MIN_CONFIDENCE, type DiaryEntry } from "../mock";

export function Gallery({ title, entries }: { title: string; entries: DiaryEntry[] }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      <div className="grid">
        {entries.map((e) => {
          const uncertain = e.confidenza < MIN_CONFIDENCE;
          return (
            <article key={e.id} className={`card ${uncertain ? "uncertain" : ""}`}>
              {e.foto ? (
                <img src={e.foto} alt={e.descrizione} />
              ) : (
                <div className="placeholder">{EMOJI[e.azione]}</div>
              )}
              <div className="card-body">
                <div className="card-top">
                  <span className="badge">
                    {EMOJI[e.azione]} {e.azione.replace("_", " ")}
                  </span>
                  <span className="muted">{e.ora}</span>
                </div>
                <p>{e.descrizione}</p>
                <span className="muted">
                  confidenza {Math.round(e.confidenza * 100)}%{uncertain && " · incerto"}
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
