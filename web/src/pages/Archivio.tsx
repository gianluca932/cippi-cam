import { Link } from "react-router";
import { EMOJI, formatDay, useApi, type GiornoApi } from "../api";

export function Archivio() {
  const { data, error, loading } = useApi<GiornoApi[]>("/giorni");

  return (
    <section className="panel">
      <h2>Archive</h2>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="errore">{error}</p>}
      {data?.length === 0 && <p className="muted">No photos in the diary yet.</p>}
      <div className="day-list">
        {data?.map((g) => (
          <Link key={g.giorno} to={`/archivio/${g.giorno}`} className="day">
            <strong>{formatDay(g.giorno)}</strong>
            <span className="muted">
              {g.foto} photos · {g.eventi_affidabili} reliable events
            </span>
            <span className="day-emoji">{g.azioni.map((a) => EMOJI[a] ?? "").join(" ")}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
