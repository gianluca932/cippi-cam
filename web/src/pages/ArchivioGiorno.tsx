import { Link, useParams } from "react-router";
import { Gallery } from "../components/Gallery";
import { formatDay, useApi, type FotoApi } from "../api";

export function ArchivioGiorno() {
  const { giorno = "" } = useParams();
  const { data, error, loading } = useApi<FotoApi[]>(`/foto?giorno=${giorno}`);

  return (
    <>
      <Link to="/archivio" className="back">← Archive</Link>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="errore">{error}</p>}
      {data && <Gallery title={formatDay(giorno)} foto={data} />}
    </>
  );
}
