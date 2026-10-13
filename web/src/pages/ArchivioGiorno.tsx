import { Link, useParams } from "react-router";
import { Gallery } from "../components/Gallery";
import { archive, formatDay } from "../mock";

export function ArchivioGiorno() {
  const { giorno } = useParams();
  const day = archive.find((d) => d.giorno === giorno);

  if (!day) {
    return (
      <p className="muted">
        Nessun dato per questo giorno. <Link to="/archivio">Torna all'archivio</Link>
      </p>
    );
  }

  return (
    <>
      <Link to="/archivio" className="back">← Archivio</Link>
      <Gallery title={formatDay(day.giorno)} entries={day.eventi} />
    </>
  );
}
