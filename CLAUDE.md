# CLAUDE.md — Cippi Cam

Direttive per lavorare su questo repo. Valgono per ogni sessione. Il contesto del progetto è nel [README](README.md), la storia nel [CHANGELOG](CHANGELOG.md).

**In breve:** diario di due pappagallini (Cippi giallo, Sky celeste). Webcam → modello di visione (`qwen3.5:9b` in Ollama, o Bedrock via env) → output strutturato validato con Zod → Postgres + pgvector → API Hono → React. Una chat con un agente LangChain/LangGraph a tool interroga il diario. È uno **showcase di AI engineering**: le scelte devono essere spiegabili e **misurate**.

---

## 1. Regole d'oro

1. **Ogni commit ha una versione.** Vedi [§2](#2-versioning-a-ogni-commit). Nessuna eccezione.
2. **Misura prima di cambiare prompt o modello.** Ogni modifica a `src/modelli/modelli.ts` (prompt della visione), `src/modelli/schema.ts`, `src/agente/` o ai modelli si valuta con `npm run valuta` prima e dopo, e il risultato va nel CHANGELOG sotto **Misurato**. Il prompt "migliorato" senza misura ci è già costato metà dell'accuratezza (63% → 38%).
3. **I guardrail stanno nel codice, non solo nel prompt.** Il prompt di un modello piccolo è fragile: una sola regola in più ("non usare markdown") ha fatto smettere l'agente di usare i tool. Validazione, rifiuti e fallback si scrivono in TypeScript.
4. **La previsione del modello non si sovrascrive mai.** Le correzioni umane vanno in `azione_umana`; le letture passano dalla vista `eventi_effettivi`.
5. **Zod è il contratto.** Ogni dato che entra dal mondo esterno (risposta del modello, argomenti dei tool, body HTTP, file di config) passa da uno schema Zod.

---

## 2. Versioning a ogni commit

Si segue [Semantic Versioning](https://semver.org/lang/it/). Siamo in `0.x`: l'API non è stabile.

| Tipo di modifica | Incremento | Esempio |
|---|---|---|
| Nuova funzione, nuova pagina, nuovo tool, nuova migrazione, cambio di prompt o modello | **minor** | 0.10.0 → 0.11.0 |
| Correzione di bug, refactoring senza cambi di comportamento, documentazione, stile | **patch** | 0.11.0 → 0.11.1 |
| Cambio incompatibile (schema DB non retrocompatibile, API rotta) — da `1.0.0` in poi | **major** | 1.4.2 → 2.0.0 |

**Ad ogni commit, nello stesso commit:**

1. Aggiorna `"version"` in **entrambi** i `package.json` (radice e `web/`): devono sempre coincidere.
2. Aggiungi in cima a [CHANGELOG.md](CHANGELOG.md) una sezione `## [X.Y.Z] — AAAA-MM-GG · Titolo breve`, con le sottosezioni che servono: **Aggiunto**, **Modificato**, **Corretto**, **Rimosso**, **Misurato**, **Problemi noti**. Spiega il *perché*, non solo il *cosa*. L'hash non si scrive (non esiste ancora): lo porta il tag.
3. Messaggio di commit in italiano: prima riga `vX.Y.Z — Titolo`, poi un elenco puntato, poi la riga di attribuzione.
4. Dopo il commit, crea il tag annotato: `git tag -a vX.Y.Z -m "vX.Y.Z — Titolo"`.

Fai commit e push **solo quando l'utente lo chiede**. Il repo non ha ancora un remote: non crearne uno senza che l'utente lo chieda (pubblicare il codice è una sua scelta).

---

## 3. Ambiente

- **Node via nvm, non nel PATH della shell di Claude.** Prima di `npm`/`npx`/`node`:
  `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`
- **Docker** per Postgres (`npm run db:up`). Se `docker info` fallisce, Docker Desktop è spento: chiedi all'utente di aprirlo.
- **Ollama** con `qwen3.5:9b` e `nomic-embed-text`. Il Mac ha 16 GB: un solo modello grande alla volta. Non scaricare modelli pesanti (>1 GB) senza dirlo, e proponi di cancellare quelli scartati.
- **Porte**: API 3001, interfaccia 5173. Spesso l'utente ha già `npm run server` (in watch) e Vite accesi: **non avviare** processi su quelle porte senza chiedere, e non chiudere i suoi.
- Il server in watch si riavvia a ogni modifica del backend, e **un riavvio ferma la registrazione** della pagina Live.

---

## 4. Come lavorare con l'utente

- **Rispondi in italiano.** Codice, commenti, nomi e messaggi di commit sono in italiano: mantieni la coerenza.
- **Prima di lanciare un comando non banale, spiega in una riga cosa fa e perché.** L'utente vuole seguire e capire.
- **Le prove nell'interfaccia le fa l'utente.** Dopo una modifica al frontend: `tsc` + build, poi dì cosa dovrebbe vedere, senza aprire il browser e senza avviare registrazioni (scattano foto vere con la webcam).
- **Sii onesto sui risultati.** Se una misura peggiora, dillo con i numeri e proponi la correzione.
- **Prima di cancellare guarda e chiedi.** `photos/` e `data/` sono fuori da git: quello che si cancella lì non si recupera. Mostra cosa verrà cancellato e chiedi conferma, salvo richiesta esplicita su un file preciso.

---

## 5. Architettura: dove va cosa

Le cartelle di `src/`: `comandi/` (un file per ogni `npm run …`), `server/` (API e pagina Live), `foto/` (webcam → diario), `modelli/` (tutto ciò che chiama un modello, più lo schema Zod), `agente/` (la chat), `db/` (le query), `comune/` (env, uccellini, tipi condivisi, terminale). Un file nuovo va nella cartella del suo compito; un comando nuovo in `comandi/` più la riga in `package.json`.

| Responsabilità | File | Regola |
|---|---|---|
| Contratto dell'output del modello | `src/modelli/schema.ts` | Unica fonte; da qui escono JSON Schema (per Ollama) e tipi |
| Quale provider e quali modelli | `src/modelli/llm.ts` | **Solo qui** si sceglie il provider (`LLM_PROVIDER=ollama|bedrock`) e si creano i modelli LangChain. Il resto del codice non sa se sotto c'è Ollama o Bedrock |
| Impronte delle immagini | `src/modelli/immagini.ts` | CLIP (Hugging Face, transformers.js, CPU): foto e frasi inglesi nello stesso spazio; modello in `data/modelli/` |
| Visione ed embedding | `src/modelli/modelli.ts` | Prompt della visione; su Ollama chiamata **nativa** (un messaggio testo + immagine: LangChain lo spezza in due e peggiora l'accuratezza), su Bedrock `withStructuredOutput`; embedding con i prefissi; controllo delle dimensioni |
| Query al database | `src/db/db.ts` | **Solo qui** c'è SQL. Il resto del codice non sa che sotto c'è Postgres |
| Tipi condivisi con il frontend | `src/comune/api-types.ts` | **Solo tipi**, nessun import di runtime (il browser li importa) |
| Una foto nel diario | `src/foto/importazione.ts` | Usato da `importa` e dalla registrazione. Su AWS diventa l'handler Lambda |
| Webcam | `src/foto/webcam.ts` | Unico punto che usa `imagesnap` |
| Agente | `src/agente/` | `createAgent` (LangGraph): `strumenti.ts` (tool), `middleware.ts` (guardrail e regole), `prompt.ts`, `index.ts` (stream → eventi della chat) |
| Variabili d'ambiente | `src/comune/env.ts`, `.env.example` | `.env` caricato per primo; mai segreti nel codice |
| API | `src/server/index.ts` | Sottile: valida, chiama i moduli, risponde |
| Uccellini | `config/uccellini.json` | Nome ↔ colore; il modello non vede mai i nomi |

---

## 6. Modelli e prompt

- **Il modello dice il colore, il codice assegna il nome** (`nomeDaColore`). Non reintrodurre i nomi nel prompt: il modello li scambiava.
- **Ordine dei campi = ordine di generazione.** I campi descrittivi (posizione, postura, con_cosa, descrizione) restano **prima** di `azione` e `confidenza`.
- **Ogni campo di testo ha un `.max()`**: finisce nella grammatica e limita i token (e quindi il tempo). Un campo nuovo senza limite non passa.
- **Niente esempi che descrivono un'azione** nel prompt (tipo "becco tra le piume"): il modello li copia. Gli esempi devono essere neutri o di formato.
- **In un prompt tutto è collegato**: una regola sul cibo ha peggiorato le azioni (17/21 → 12/21). Per questo i prompt sono due: azioni e gabbia (che gira a tempo, non a ogni foto). Una modifica a un campo va misurata anche sugli altri campi del suo prompt; se un campo ha bisogno di regole sue, meglio un prompt separato.
- **La `confidenza` del modello non è una probabilità.** Non costruirci sopra logiche importanti senza validarla con `valuta --salvate`.
- **Enum invece di testo libero** quando i valori sono pochi: costano 2-3 token e sono filtrabili in SQL.
- **Agente**: un'aggiunta al system prompt va provata su almeno 5 domande (`npm run chiedi`) per verificare che usi ancora i tool. Formattazione e pulizia del testo si fanno nell'interfaccia, non chiedendole al modello.
- **I tool restituiscono riassunti già calcolati**, non liste lunghe da interpretare.
- **Argomenti dei tool**: schema Zod, `""`/`null` trattati come assenti, errori restituiti al modello come JSON perché si corregga.

---

## 7. LangChain e LangGraph

- **Modelli solo da `src/modelli/llm.ts`** (`modelloChat`, `modelloVisione`, `modelloEmbedding`), riusati con `unaVolta`. Mai `new ChatOllama(...)` sparsi nel codice: è quello che permette di cambiare provider con l'env.
- **Tool con `tool()` di `langchain`** e uno schema Zod; `name` e `description` vanno scritti per il modello, che li legge per scegliere. Restituire JSON compatto e riassunti, non liste lunghe.
- **Regole dell'agente come middleware** (`createMiddleware`): `wrapModelCall` per controllare o ripetere una chiamata al modello, `wrapToolCall` per gli argomenti e gli errori dei tool. Il ciclo modello ↔ tool non si riscrive a mano.
- **Lo stream** dell'agente usa `streamMode: ["messages", "updates"]`: i token da "messages", tool e risposte finali da "updates". La risposta va in streaming solo dopo un tool (la trattiene il guardrail).
- **Dopo ogni modifica a modelli, tool, middleware o prompt**: `npm run chiedi` sulle stesse domande di prima, confrontando tool scelti, risposte inventate e tempi.
- Se si cambia `EMBED_MODEL`, `controllaEmbedding()` ferma server e import: serve una migrazione della colonna, non solo l'env.

## 8. Backend (Node + TypeScript)

**Linguaggio e moduli**
- TypeScript `strict`, ESM con `module: NodeNext`: negli import relativi l'estensione è **`.js`** anche se il file è `.ts`.
- `npx tsc --noEmit -p .` deve passare prima di ogni commit.
- `async`/`await` ovunque; niente callback annidate. Le promesse non attese si marcano con `void` e un commento sul perché.
- Niente `any`: usa `unknown` e restringi con Zod o con type guard.

**Input ed errori**
- **Valida ai confini**: body, query e parametri HTTP con Zod (`safeParse` → 400 con messaggio chiaro). Gli `id` numerici si controllano con `Number.isInteger`.
- Errori attesi → risposta HTTP esplicita (400, 404, 409). Errori inattesi → li gestisce `app.onError` (log + 500).
- I percorsi di file che arrivano da fuori si validano con una whitelist (`nomeValido`): mai concatenare input dell'utente in un percorso.

**Database**
- **Solo query parametrizzate** (`$1, $2…`), mai stringhe concatenate.
- Più scritture collegate → **transazione** (`BEGIN`/`COMMIT`/`ROLLBACK`, `client.release()` nel `finally`).
- Le date si salvano in `timestamptz`; "il giorno" si calcola nel fuso `Europe/Rome`.
- Gli script CLI chiudono il pool (`chiudi()`) nel `finally`.

**Migrazioni**
- Nuovi file numerati in `db/migrazioni/NNN_nome.sql`; non modificare quelle già applicate (salvo correzioni per renderle rilanciabili).
- Devono essere **rilanciabili**: `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, e la vista `eventi_effettivi` sempre con `DROP VIEW IF EXISTS` + `CREATE VIEW` (completa di tutte le colonne).
- Ogni migrazione nuova si prova con `npm run db:migra` **due volte di fila**.

**Processi lunghi e streaming**
- SSE con `streamSSE` di Hono; nei cicli si controlla `stream.aborted`, si manda un `ping` periodico.
- Lavori pesanti (analisi delle foto) **in coda**, uno alla volta: mai bloccare la richiesta HTTP o lo scatto.
- `execFileSync` solo in CLI o dentro il lavoratore in coda, mai in un handler HTTP.
- Processi figli (`caffeinate`, `imagesnap`) si chiudono sempre (`kill` allo stop, `-w <pid>` per `caffeinate`).

**Segreti**
- Mai nel codice o nei commit. Configurazione da variabili d'ambiente, documentate in `.env.example` (`DATABASE_URL`, `LLM_PROVIDER`, `OLLAMA_URL`, `*_MODEL`, `AWS_REGION`…); `.env` non va in git. Le credenziali AWS le trova l'SDK (SSO, profilo, ruolo IAM). La password `cippi` di Docker è solo per lo sviluppo locale.

---

## 9. Frontend (React + Vite)

**Struttura**
- Componenti funzione + hook. Pagine in `web/src/pages/`, componenti riusati in `web/src/components/`, chiamate all'API **solo** in `web/src/api.ts`.
- Tipi delle risposte importati da `src/comune/api-types.ts` (via `api.ts`): non ridefinirli a mano.
- `cd web && npx tsc --noEmit` e `npm run build` devono passare prima di ogni commit.

**Stato**
- **Stato immutabile**: si crea sempre un oggetto nuovo (`{ ...m, text }`), mai `m.text += …`.
- **Aggiornamenti funzionali** (`setX(prev => …)`) quando lo stato si aggiorna da codice asincrono (stream, fetch lunghe): evita le closure con dati vecchi.
- **Updater e reducer puri**: in StrictMode React li chiama due volte in sviluppo; se hanno effetti collaterali i dati si raddoppiano.
- Aggiornamenti ottimistici con **rollback** e messaggio se la richiesta fallisce.

**Effetti**
- Un `useEffect` **non restituisce mai una Promise**: niente `useEffect(async () => …)` né arrow function brevi che restituiscono il valore di una chiamata (ci è già capitato: `scrollIntoView` restituisce una Promise in Chrome recente → "destroy is not a function"). Usa le graffe.
- **Cleanup sempre**: `clearInterval`, `EventSource.close()`, `track.stop()` sulla webcam, flag `attivo = false` per ignorare risposte arrivate dopo lo smontaggio. Per le fetch lunghe preferisci `AbortController`.
- `EventSource` per gli stream in GET (si riconnette da solo); `fetch` + `ReadableStream` per quelli in POST.

**Rendering e accessibilità**
- `key` stabili (id, nomi di file), non l'indice se la lista cambia ordine.
- Elementi semantici: `<button>` per le azioni, `<select>`/`<label>` per le scelte, `<dialog>` con `showModal()` per le finestre modali, `aria-label` sui controlli senza testo.
- Non aggiungere librerie UI o di stato senza un motivo concreto: oggi bastano React, React Router e CSS.

**Stile**
- CSS in `web/src/styles.css`, con **token sul `:root`** (`--bg`, `--panel`, `--text`, `--muted`, `--accent`, `--giusto`, `--sbagliato`…) e tema scuro in `@media (prefers-color-scheme: dark)`. Niente colori sparsi nei componenti, tranne quelli degli uccellini (`COLORE_CSS`).
- Animazioni brevi e disattivate con `@media (prefers-reduced-motion: reduce)`.
- Layout che funziona anche su schermi stretti (griglie `auto-fill` con `minmax(min(Npx, 100%), 1fr)`).
- Tono "prodotto", non "gioco": niente emoji nella struttura dell'interfaccia (header, titoli); vanno bene come icone delle azioni.

---

## 10. Valutazione

| Comando | Quando |
|---|---|
| `npm run valuta` | prima e dopo ogni modifica a prompt, schema o modello di visione (~40s a foto) |
| `npm run valuta -- --foto NOME` | prova veloce su una o due foto difficili, prima della misura completa |
| `npm run valuta -- --salvate` | istantaneo: matrice di confusione delle previsioni salvate contro le correzioni |
| `npm run confronta-embedding -- A B` | prima di cambiare modello di embedding |
| `npm run chiedi -- "…"` | dopo ogni modifica all'agente, su più domande di tipo diverso |

Una misura su una foto sola **non** è un risultato: per le decisioni servono le 12+ foto etichettate. Il Mac sotto carico allunga i tempi: per confrontare le velocità guarda i **token**, non i secondi.

---

## 11. Checklist prima di un commit

- [ ] `npx tsc --noEmit -p .` (backend) e `cd web && npx tsc --noEmit && npm run build` (frontend) passano
- [ ] Nuove migrazioni applicate due volte con `npm run db:migra`
- [ ] Se cambiano prompt, schema o modello: misura con `npm run valuta` e numeri nel CHANGELOG
- [ ] `version` aggiornata in `package.json` **e** `web/package.json`
- [ ] Sezione nuova in CHANGELOG.md
- [ ] README aggiornato se cambiano comandi, architettura o numeri
- [ ] Messaggio `vX.Y.Z — Titolo` e, dopo il commit, `git tag -a vX.Y.Z`
- [ ] Niente file da `photos/`, `data/`, `.env` nel commit
