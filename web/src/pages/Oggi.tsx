import { Chat } from "../components/Chat";
import { Gallery } from "../components/Gallery";
import { oggi, useApi, type FotoApi } from "../api";

export function Oggi() {
  const { data, error, loading } = useApi<FotoApi[]>(`/foto?giorno=${oggi()}`);

  return (
    <main className="layout">
      {loading && <p className="muted">Carico il diario…</p>}
      {error && <p className="errore">Non riesco a leggere il diario: {error}. Il server è acceso? (npm run server)</p>}
      {data && <Gallery title="Oggi" foto={data} />}
      <Chat />
    </main>
  );
}
