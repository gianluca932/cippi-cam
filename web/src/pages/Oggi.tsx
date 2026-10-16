import { Chat } from "../components/Chat";
import { Gallery } from "../components/Gallery";
import { oggi, useApi, type FotoApi } from "../api";

export function Oggi() {
  const { data, error, loading } = useApi<FotoApi[]>(`/foto?giorno=${oggi()}`);

  return (
    <main className="layout">
      {loading && <p className="muted">Loading the diary…</p>}
      {error && <p className="errore">Can't read the diary: {error}. Is the server running? (npm run server)</p>}
      {data && <Gallery title="Today" foto={data} />}
      <Chat />
    </main>
  );
}
