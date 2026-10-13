import { useEffect, useRef, useState } from "react";
import {
  AZIONI,
  annullaCorrezione,
  COLORE_CSS,
  correggiAzione,
  EMOJI,
  formatOra,
  MIN_CONFIDENCE,
  type EventoApi,
  type FotoApi,
} from "../api";

const ALLARME = ["scarso", "vuoto"];
const etichetta = (azione: string) => `${EMOJI[azione] ?? ""} ${azione.replace("_", " ")}`;

function Livello({ icona, nome, valore }: { icona: string; nome: string; valore: string }) {
  const tipo = ALLARME.includes(valore) ? "allarme" : valore === "non_visibile" ? "spento" : "";
  return (
    <span className={`chip-foto livello ${tipo}`} title={`${nome}: ${valore.replace("_", " ")}`}>
      {icona} {valore === "non_visibile" ? "?" : valore}
    </span>
  );
}

type Stato = "da-controllare" | "giusto" | "sbagliato";
const statoDi = (e: EventoApi): Stato =>
  e.azione_umana === null ? "da-controllare" : e.azione_umana === e.azione_modello ? "giusto" : "sbagliato";

// Sulla foto: un'etichetta per uccellino, verde se il modello aveva ragione, rossa se l'hai corretto.
function EtichetteFoto({ eventi }: { eventi: EventoApi[] }) {
  return (
    <div className="etichette-foto">
      {eventi.map((e) => {
        const stato = statoDi(e);
        const titolo =
          stato === "giusto" ? "Confermato: il modello aveva ragione"
          : stato === "sbagliato" ? `Corretto: il modello diceva ${e.azione_modello.replace("_", " ")}`
          : "Non ancora controllato";
        return (
          <span key={e.id} className={`etichetta-foto ${stato}`} title={titolo}>
            {stato === "giusto" ? "✓" : stato === "sbagliato" ? "✗" : "•"} {e.nome}
          </span>
        );
      })}
    </div>
  );
}

// La foto in grande, in un <dialog> nativo: Esc, focus e sfondo li gestisce il browser.
function FotoGrande({ foto, onChiudi }: { foto: FotoApi | null; onChiudi: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (foto && !d.open) d.showModal();
    if (!foto && d.open) d.close();
  }, [foto]);

  return (
    <dialog
      ref={ref}
      className="foto-grande"
      onClose={onChiudi}
      // Click sullo sfondo (fuori dal contenuto) = chiudi.
      onClick={(ev) => ev.target === ref.current && onChiudi()}
    >
      {foto && (
        <figure>
          <button type="button" className="chiudi" onClick={onChiudi} aria-label="Chiudi">✕</button>
          <img src={`/api/foto/${foto.id}/immagine`} alt={foto.scena} />
          <figcaption>
            <strong>{formatOra(foto.ora)}</strong> · {foto.scena}
            <div className="foto-grande-eventi">
              {foto.eventi.map((e) => (
                <span key={e.id} className={`etichetta-foto ${statoDi(e)}`}>
                  {e.nome}: {etichetta(e.azione)}
                  {e.con_cosa && e.con_cosa !== "niente" && ` · ${e.con_cosa}`}
                </span>
              ))}
              <span className="muted">
                💧 {foto.acqua.replace("_", " ")} · 🌾 {foto.cibo.replace("_", " ")}
                {foto.pulizia && ` · 🧹 ${foto.pulizia.replaceAll("_", " ")}`}
              </span>
            </div>
            <dl className="foto-grande-dettagli">
              {foto.eventi.map((e) => (
                <div key={e.id}>
                  <dt>{e.nome}</dt>
                  <dd>{e.descrizione} <span className="muted">— {e.posizione}; {e.postura}</span></dd>
                </div>
              ))}
              {foto.note_gabbia && (
                <div>
                  <dt>Gabbia</dt>
                  <dd>{foto.note_gabbia}</dd>
                </div>
              )}
            </dl>
          </figcaption>
        </figure>
      )}
    </dialog>
  );
}

// Una riga per uccellino: l'azione si cambia dal chip, ✓ conferma quella del modello, ↺ annulla.
function RigaEvento({ e, onCambia }: { e: EventoApi; onCambia: (azione: string | null) => void }) {
  const stato = statoDi(e);
  const incerto = stato === "da-controllare" && e.confidenza < MIN_CONFIDENCE;
  const conf = Math.round(e.confidenza_modello * 100);

  return (
    <div className={`riga ${stato} ${incerto ? "incerto" : ""}`} title={e.descrizione}>
      <span className="avatar" style={{ background: COLORE_CSS[e.colore] ?? "var(--muted)" }} aria-hidden>
        {e.nome[0]}
      </span>
      <div className="riga-centro">
        <span className="riga-nome">{e.nome}</span>
        <select
          className="chip-azione"
          value={e.azione}
          onChange={(ev) => onCambia(ev.target.value)}
          aria-label={`Azione di ${e.nome}`}
        >
          {AZIONI.map((a) => (
            <option key={a} value={a}>{etichetta(a)}</option>
          ))}
        </select>
        {e.con_cosa && e.con_cosa !== "niente" && <span className="con-cosa">con {e.con_cosa}</span>}
      </div>
      <div className="riga-azioni">
        {stato === "da-controllare" ? (
          <>
            <span className="conf" title={`Il modello è sicuro al ${conf}%`}>
              <span className="conf-barra"><i style={{ width: `${conf}%` }} /></span>
              {conf}%
            </span>
            <button type="button" className="icona conferma" onClick={() => onCambia(e.azione_modello)} title="È giusto: conferma">
              ✓
            </button>
          </>
        ) : (
          <>
            <span className="esito" title={stato === "sbagliato" ? `Il modello diceva: ${e.azione_modello}` : "Confermato"}>
              {stato === "giusto" ? "giusto" : `era ${e.azione_modello.replace("_", " ")}`}
            </span>
            <button type="button" className="icona" onClick={() => onCambia(null)} title="Annulla: torna alla previsione del modello">
              ↺
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function Gallery({ title, foto }: { title: string; foto: FotoApi[] }) {
  // Copia locale per l'aggiornamento ottimistico: la card cambia subito, la richiesta parte dopo.
  const [locali, setLocali] = useState(foto);
  const [errore, setErrore] = useState<string>();
  const [aperta, setAperta] = useState<number | null>(null); // id della foto aperta in grande
  useEffect(() => setLocali(foto), [foto]);

  const aggiornaEvento = (id: number, f: (e: EventoApi) => EventoApi) =>
    setLocali((fs) => fs.map((ft) => ({ ...ft, eventi: ft.eventi.map((e) => (e.id === id ? f(e) : e)) })));

  async function cambia(e: EventoApi, azione: string | null) {
    const prima = e;
    aggiornaEvento(e.id, (ev) =>
      azione === null
        ? { ...ev, azione_umana: null, azione: ev.azione_modello, confidenza: ev.confidenza_modello }
        : { ...ev, azione_umana: azione, azione, confidenza: 1 },
    );
    setErrore(undefined);
    try {
      if (azione === null) await annullaCorrezione(e.id);
      else await correggiAzione(e.id, azione);
    } catch (err) {
      aggiornaEvento(e.id, () => prima); // la richiesta è fallita: si torna com'era
      setErrore(`Correzione non salvata: ${(err as Error).message}`);
    }
  }

  const controllati = locali.flatMap((f) => f.eventi).filter((e) => e.azione_umana !== null).length;
  const totale = locali.reduce((n, f) => n + f.eventi.length, 0);

  return (
    <section className="panel">
      <div className="galleria-testa">
        <h2>{title}</h2>
        {totale > 0 && (
          <span className="avanzamento" title="Eventi controllati da te">
            <span className="conf-barra"><i style={{ width: `${(controllati / totale) * 100}%` }} /></span>
            {controllati}/{totale} controllati
          </span>
        )}
      </div>
      {errore && <p className="errore">{errore}</p>}
      {locali.length === 0 && <p className="muted">Nessuna foto. Mettile in photos/ e lancia npm run importa.</p>}
      <div className="grid">
        {locali.map((f) => (
          <article key={f.id} className="card">
            <button type="button" className="foto-card" onClick={() => setAperta(f.id)} aria-label="Apri la foto in grande">
              <img src={`/api/foto/${f.id}/immagine`} alt={f.scena} loading="lazy" />
              <span className="chip-foto ora">{formatOra(f.ora)}</span>
              <span className="livelli-foto">
                <Livello icona="💧" nome="acqua" valore={f.acqua} />
                <Livello icona="🌾" nome="cibo" valore={f.cibo} />
                {(f.pulizia === "sporca" || f.pulizia === "un_po_sporca") && (
                  <span className="chip-foto livello allarme" title={`Gabbia ${f.pulizia.replaceAll("_", " ")}`}>🧹</span>
                )}
              </span>
              <EtichetteFoto eventi={f.eventi} />
            </button>
            <div className="card-body">
              {f.eventi.map((e) => (
                <RigaEvento key={e.id} e={e} onCambia={(azione) => cambia(e, azione)} />
              ))}
              <p className="scena">{f.scena}</p>
            </div>
          </article>
        ))}
      </div>
      <FotoGrande foto={locali.find((f) => f.id === aperta) ?? null} onChiudi={() => setAperta(null)} />
    </section>
  );
}
