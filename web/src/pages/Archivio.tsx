import { Link } from "react-router";
import { archive, EMOJI, formatDay, MIN_CONFIDENCE } from "../mock";

export function Archivio() {
  return (
    <section className="panel">
      <h2>Archivio</h2>
      <div className="day-list">
        {archive.map(({ giorno, eventi }) => {
          const affidabili = eventi.filter((e) => e.confidenza >= MIN_CONFIDENCE);
          return (
            <Link key={giorno} to={`/archivio/${giorno}`} className="day">
              <strong>{formatDay(giorno)}</strong>
              <span className="muted">{affidabili.length} eventi affidabili su {eventi.length}</span>
              <span className="day-emoji">{affidabili.map((e) => EMOJI[e.azione]).join(" ")}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
