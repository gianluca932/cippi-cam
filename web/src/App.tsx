import { BrowserRouter, NavLink, Route, Routes } from "react-router";
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

export function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <header className="header">
          <h1>🐦 Cippi Cam</h1>
          <nav className="nav">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.to === "/"}>
                {l.label}
              </NavLink>
            ))}
          </nav>
        </header>
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
