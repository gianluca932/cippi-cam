// Date e ore nel fuso di casa: "oggi" per l'agente è il giorno italiano, non quello UTC.

export const FUSO = "Europe/Rome";

/** "2026-10-14" */
export const oggi = () => new Date().toLocaleDateString("sv-SE", { timeZone: FUSO });

/** "2026-10-13" */
export const ieri = () => new Date(Date.now() - 86_400_000).toLocaleDateString("sv-SE", { timeZone: FUSO });

/** "14:05" */
export const hhmm = (d: Date) => d.toLocaleTimeString("it-IT", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });

/** "2026-10-13 14:05" */
export const giornoEOra = (d: Date) => `${d.toLocaleDateString("sv-SE", { timeZone: FUSO })} ${hhmm(d)}`;
