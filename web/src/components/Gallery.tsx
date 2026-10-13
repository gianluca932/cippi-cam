import { COLORE_CSS, EMOJI, formatOra, MIN_CONFIDENCE, type FotoApi } from "../api";

const ALLARME = ["scarso", "vuoto"];

function Livello({ icona, nome, valore }: { icona: string; nome: string; valore: string }) {
  const classe = ALLARME.includes(valore) ? "livello allarme" : valore === "non_visibile" ? "livello muted" : "livello";
  return (
    <span className={classe} title={nome}>
      {icona} {valore.replace("_", " ")}
    </span>
  );
}

export function Gallery({ title, foto }: { title: string; foto: FotoApi[] }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {foto.length === 0 && <p className="muted">Nessuna foto. Mettile in photos/ e lancia npm run importa.</p>}
      <div className="grid">
        {foto.map((f) => (
          <article key={f.id} className="card">
            <img src={`/api/foto/${f.id}/immagine`} alt={f.scena} loading="lazy" />
            <div className="card-body">
              <div className="card-top">
                <strong>{formatOra(f.ora)}</strong>
                <span className="livelli">
                  <Livello icona="💧" nome="acqua" valore={f.acqua} />
                  <Livello icona="🌾" nome="cibo" valore={f.cibo} />
                </span>
              </div>
              {f.eventi.map((e) => {
                const incerto = e.confidenza < MIN_CONFIDENCE;
                return (
                  <div key={e.nome} className={`evento ${incerto ? "incerto" : ""}`} title={e.descrizione}>
                    <span className="dot" style={{ background: COLORE_CSS[e.colore] ?? "var(--muted)" }} />
                    <strong>{e.nome}</strong>
                    <span>
                      {EMOJI[e.azione] ?? ""} {e.azione.replace("_", " ")}
                    </span>
                    <span className="muted">
                      {Math.round(e.confidenza * 100)}%{incerto && " · incerto"}
                    </span>
                  </div>
                );
              })}
              <p className="muted scena">{f.scena}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
