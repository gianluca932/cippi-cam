import { Chat } from "../components/Chat";
import { Gallery } from "../components/Gallery";
import { formatDay, oggi, useApi, type FotoApi, type GiornoApi } from "../api";

// La prima pagina: le foto di oggi o, se oggi non ce ne sono, quelle dell'ultimo giorno che ne ha.
// Il titolo lo dice ("Latest day · …"): le date restano quelle vere.
export function Oggi() {
  const giorni = useApi<GiornoApi[]>("/giorni");
  const ultimo = giorni.data?.[0]?.giorno; // /giorni è in ordine dal più recente
  const giorno = giorni.loading ? null : !ultimo || giorni.data?.some((g) => g.giorno === oggi()) ? oggi() : ultimo;
  const { data, error, loading } = useApi<FotoApi[]>(giorno && `/foto?giorno=${giorno}`);
  const errore = giorni.error ?? error;
  const titolo = giorno === oggi() ? "Today" : `Latest day · ${formatDay(giorno ?? oggi())}`;

  return (
    <main className="layout">
      {loading && !errore && <p className="muted">Loading the diary…</p>}
      {errore && <p className="errore">Can't read the diary: {errore}. Is the server running? (npm run server)</p>}
      {data && <Gallery title={titolo} foto={data} />}
      <Chat />
    </main>
  );
}
