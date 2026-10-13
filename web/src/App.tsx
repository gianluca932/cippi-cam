import { BrowserRouter, Link, NavLink, Route, Routes } from "react-router";
import { useApi, type UccellinoApi } from "./api";
import { configs } from "./config";
import { Archivio } from "./pages/Archivio";
import { ArchivioGiorno } from "./pages/ArchivioGiorno";
import { Configurazione } from "./pages/Configurazione";
import { Credits } from "./pages/Credits";
import { Oggi } from "./pages/Oggi";

const LINKS = [
  { to: "/", label: "Oggi" },
  { to: "/archivio", label: "Archivio" },
  { to: "/configurazione", label: "Configurazione" },
  { to: "/credits", label: "Credits" },
];

// Logo: un obiettivo stilizzato (anelli concentrici), lo stesso della favicon.
function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="#fff" strokeWidth="2.2" />
      <circle cx="16" cy="16" r="3.2" fill="#fff" />
      <circle cx="23.5" cy="8.5" r="1.6" fill="#fff" />
    </svg>
  );
}

// Stato del sistema: verde se l'API risponde, rosso se è spenta.
function StatoSistema() {
  const { error, loading } = useApi<UccellinoApi[]>("/uccellini");
  const stato = loading ? "attesa" : error ? "offline" : "online";
  const testo = loading ? "Connessione…" : error ? "API non raggiungibile" : "Sistema attivo";
  return (
    <div className="stato-sistema" title={error ?? undefined}>
      <span className={`stato-punto ${stato}`} />
      <span>{testo}</span>
      <span className="stato-dettaglio">Locale · {configs.locale.modelli.visione}</span>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            <Logo />
            <span className="brand-nome">Cippi Cam</span>
            <span className="brand-sottotitolo">Monitoraggio comportamentale</span>
          </Link>
          <nav className="nav">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.to === "/"}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <StatoSistema />
        </div>
      </header>
      <div className="app">
        <Routes>
          <Route path="/" element={<Oggi />} />
          <Route path="/archivio" element={<Archivio />} />
          <Route path="/archivio/:giorno" element={<ArchivioGiorno />} />
          <Route path="/configurazione" element={<Configurazione />} />
          <Route path="/credits" element={<Credits />} />
          <Route path="*" element={<p className="muted">Pagina non trovata.</p>} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
