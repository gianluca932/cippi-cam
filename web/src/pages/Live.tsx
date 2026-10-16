import { useEffect, useRef, useState } from "react";
import { avviaRegistrazione, EMOJI, fermaRegistrazione, formatOra, nomeAzione, type ScattoApi, type StatoRegistrazione } from "../api";

// Sopra: il video della webcam in diretta (getUserMedia, nel browser): è solo anteprima.
// Gli scatti veri li fa il server (Avvia/Ferma qui sotto, o `npm run scatta`), che li analizza in coda.
// Scatti e stato della registrazione arrivano da soli via SSE.
const CHIAVE_CAMERA = "cippi-cam:camera";

function leggiCamera() {
  try {
    return localStorage.getItem(CHIAVE_CAMERA) ?? "";
  } catch {
    return "";
  }
}
function salvaCamera(id: string) {
  try {
    localStorage.setItem(CHIAVE_CAMERA, id);
  } catch {
    // niente: la scelta vale solo per questa visita
  }
}

// Il video della webcam, con la scelta della fotocamera.
function useWebcam() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camere, setCamere] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState(leggiCamera);
  const [errore, setErrore] = useState<string>();

  useEffect(() => {
    let stream: MediaStream | undefined;
    let attivo = true;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: cameraId ? { deviceId: { exact: cameraId } } : { width: 1280, height: 720 },
          audio: false,
        });
        if (!attivo) return stream.getTracks().forEach((t) => t.stop());
        if (videoRef.current) videoRef.current.srcObject = stream;
        setErrore(undefined);
        // I nomi delle fotocamere sono leggibili solo dopo il permesso.
        const dispositivi = await navigator.mediaDevices.enumerateDevices();
        setCamere(dispositivi.filter((d) => d.kind === "videoinput"));
      } catch (e) {
        const err = e as DOMException;
        if (cameraId && err.name === "OverconstrainedError") setCameraId(""); // la fotocamera salvata non c'è più
        else setErrore(err.name === "NotAllowedError" ? "The browser denied camera access." : err.message);
      }
    })();
    // Chiudere la pagina o cambiare fotocamera spegne quella di prima.
    return () => {
      attivo = false;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [cameraId]);

  const scegli = (id: string) => {
    salvaCamera(id);
    setCameraId(id);
  };
  return { videoRef, camere, cameraId, scegli, errore };
}

// Gli scatti dal server, aggiornati in tempo reale con EventSource (SSE in GET, si riconnette da solo).
function useScatti() {
  const [scatti, setScatti] = useState<ScattoApi[]>([]);
  const [registrazione, setRegistrazione] = useState<StatoRegistrazione>();
  const [connesso, setConnesso] = useState(false);
  useEffect(() => {
    const es = new EventSource("/api/scatti/stream");
    es.addEventListener("scatti", (e) => setScatti(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("registrazione", (e) => setRegistrazione(JSON.parse((e as MessageEvent).data)));
    es.onopen = () => setConnesso(true);
    es.onerror = () => setConnesso(false); // EventSource riprova da solo
    return () => es.close();
  }, []);
  return { scatti, registrazione, setRegistrazione, connesso };
}

// Un orologio che ticchetta ogni secondo.
function useAdesso() {
  const [adesso, setAdesso] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAdesso(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return adesso;
}

const durata = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
};

const fa = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`;
};

// Avvia/Ferma la registrazione sul server, con intervallo, durata e fotocamera.
function Controlli({ stato, onStato }: { stato?: StatoRegistrazione; onStato: (s: StatoRegistrazione) => void }) {
  const [ogniSec, setOgniSec] = useState(60);
  const [durataMin, setDurataMin] = useState(60);
  const [camera, setCamera] = useState("MacBook");
  const [analizza, setAnalizza] = useState(true);
  const [inviando, setInviando] = useState(false);
  const [errore, setErrore] = useState<string>();
  const attiva = stato?.attiva ?? false;

  async function premi() {
    setInviando(true);
    setErrore(undefined);
    try {
      onStato(attiva ? await fermaRegistrazione() : await avviaRegistrazione({ ogniSec, durataMin, analizza, camera }));
    } catch (e) {
      setErrore((e as Error).message);
    } finally {
      setInviando(false);
    }
  }

  return (
    <div className="live-controlli">
      <label>
        One photo every
        <select value={ogniSec} onChange={(e) => setOgniSec(Number(e.target.value))} disabled={attiva}>
          {[30, 60, 120, 300].map((s) => (
            <option key={s} value={s}>{s < 60 ? `${s} s` : `${s / 60} min`}</option>
          ))}
        </select>
      </label>
      <label>
        for
        <select value={durataMin} onChange={(e) => setDurataMin(Number(e.target.value))} disabled={attiva}>
          {[15, 30, 60, 120, 240, 480].map((m) => (
            <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>
          ))}
        </select>
      </label>
      <label>
        with
        <select value={camera} onChange={(e) => setCamera(e.target.value)} disabled={attiva}>
          <option value="MacBook">MacBook</option>
          <option value="iPhone">iPhone</option>
        </select>
      </label>
      <label className="live-check">
        <input type="checkbox" checked={analizza} onChange={(e) => setAnalizza(e.target.checked)} disabled={attiva} />
        analyse right away
      </label>
      <button type="button" className={`live-pulsante ${attiva ? "ferma" : ""}`} onClick={premi} disabled={inviando || !stato}>
        {attiva ? "⏹ Stop" : "● Start recording"}
      </button>
      {errore && <span className="errore">{errore}</span>}
    </div>
  );
}

export function Live() {
  const { videoRef, camere, cameraId, scegli, errore } = useWebcam();
  const { scatti, registrazione, setRegistrazione, connesso } = useScatti();
  const adesso = useAdesso();

  // Gli scatti visti per la prima volta mentre la pagina è aperta entrano con un'animazione.
  const visti = useRef<Set<string> | null>(null);
  const nuovi = new Set<string>();
  if (scatti.length) {
    if (visti.current === null) visti.current = new Set(scatti.map((s) => s.nome)); // primo caricamento: niente animazione
    for (const s of scatti) if (!visti.current.has(s.nome)) nuovi.add(s.nome);
  }
  useEffect(() => {
    if (visti.current) for (const s of scatti) visti.current.add(s.nome);
  }, [scatti]);

  const ultimo = scatti[0] ? new Date(scatti[0].ora).getTime() : null;
  const registra = registrazione?.attiva ?? false;
  const inCoda = new Set(registrazione?.coda ?? []);

  return (
    <main className="live">
      <section className="live-video">
        <video ref={videoRef} autoPlay muted playsInline />
        {errore && <div className="live-errore">{errore}</div>}
        <div className="live-overlay alto">
          <span className="live-badge">
            <span className="live-punto" /> LIVE
          </span>
          <span className="chip-foto">
            {new Date(adesso).toLocaleTimeString("en-GB")}
          </span>
        </div>
        {camere.length > 1 && (
          <select className="live-camera" value={cameraId} onChange={(e) => scegli(e.target.value)} aria-label="Camera">
            <option value="">Default camera</option>
            {camere.map((c) => (
              <option key={c.deviceId} value={c.deviceId}>{c.label || "Camera"}</option>
            ))}
          </select>
        )}
      </section>

      <Controlli stato={registrazione} onStato={setRegistrazione} />

      <div className="live-stato">
        <span className={`rec ${registra ? "attivo" : ""}`}>
          <span className="rec-punto" /> {registra ? "REC" : "Paused"}
        </span>
        {registra && registrazione?.avviataAlle && (
          <span className="rec-tempo">{durata(adesso - new Date(registrazione.avviataAlle).getTime())}</span>
        )}
        {registrazione && (registra || registrazione.scattate > 0) && (
          <span className="muted">
            {registrazione.scattate} photos · {registrazione.analizzate} analysed
            {registrazione.inAnalisi && " · 🔍 analysing"}
            {registrazione.coda.length > 0 && ` · ${registrazione.coda.length} queued`}
          </span>
        )}
        {!registra && ultimo !== null && <span className="muted">Last photo {fa(adesso - ultimo)}</span>}
        {registrazione?.errore && <span className="errore">{registrazione.errore}</span>}
        <span className={`live-sse ${connesso ? "ok" : ""}`} title="Real-time updates (SSE)">
          {connesso ? "● live updates" : "○ reconnecting…"}
        </span>
      </div>

      <section className="panel">
        <h2>Latest photos</h2>
        {scatti.length === 0 && <p className="muted">No photos in photos/ yet.</p>}
        <div className="scatti">
          {scatti.map((s) => (
            <figure key={s.nome} className={`scatto ${nuovi.has(s.nome) ? "nuovo" : ""}`}>
              <img src={`/api/scatti/${encodeURIComponent(s.nome)}/immagine`} alt={`Photo taken at ${formatOra(s.ora)}`} loading="lazy" />
              <span className="chip-foto ora">{formatOra(s.ora)}</span>
              <figcaption>
                {s.analisi ? (
                  s.analisi.eventi.map((e) => (
                    <span key={e.nome}>
                      <strong>{e.nome}</strong> {EMOJI[e.azione] ?? ""} {nomeAzione(e.azione)}
                    </span>
                  ))
                ) : s.nome === registrazione?.inAnalisi ? (
                  <span className="in-analisi">🔍 the model is looking…</span>
                ) : inCoda.has(s.nome) ? (
                  <span className="muted">⏳ queued</span>
                ) : (
                  <span className="muted">not analysed yet</span>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    </main>
  );
}
