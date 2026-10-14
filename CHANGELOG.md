# Changelog

Tutte le modifiche rilevanti di Cippi Cam, dalla più recente alla più vecchia.
Il formato segue [Keep a Changelog](https://keepachangelog.com/it/1.1.0/) e le versioni [Semantic Versioning](https://semver.org/lang/it/). Ogni versione corrisponde a un commit con il tag `vX.Y.Z`; per le versioni fino alla 0.10.0, ricostruite a posteriori, tra parentesi c'è anche l'hash.

Le sezioni **Misurato** riportano i risultati di `npm run valuta` e `npm run confronta-embedding` al momento della modifica.

---

## [0.12.1] — 2026-10-14 · Codice diviso in cartelle

### Modificato
- `src/` diviso per compito: `comandi/` (un file per ogni `npm run …`), `server/`, `foto/`, `modelli/`, `agente/`, `db/`, `comune/`. Solo spostamenti (con `git mv`, la storia dei file resta): nessuna logica cambiata, i comandi `npm run …` sono gli stessi.
- Import ricalcolati in automatico (69), percorsi verso `config/` ed `eval/`, script in `package.json`, tipi del frontend, README e CLAUDE.md aggiornati.

---

## [0.12.0] — 2026-10-14 · Ricerca per immagini, correzioni di acqua e cibo, webcam nuova

### Aggiunto
- **Impronte CLIP delle foto** ([src/modelli/immagini.ts](src/modelli/immagini.ts)): `Xenova/clip-vit-base-patch32` da Hugging Face con transformers.js, in Node sulla CPU, senza Ollama. 512 numeri a foto in ~30 ms, nella colonna `embedding_immagine` che esisteva dal primo schema.
  - calcolate in automatico a ogni import; `npm run embedding-immagini` per le foto già presenti;
  - migrazione 003: indice HNSW;
  - `npm run cerca -- --immagini "…"` (ricerca testo → foto, in inglese) e `--simili <id>` (foto simili).
- **Correzione di acqua e cibo in galleria**: riga "Gabbia" con due pillole; ✓ conferma, ↺ annulla. Migrazione 004: `acqua_umana`, `cibo_umano`, vista `foto_effettive`; `PATCH /api/foto/:id/gabbia`. Il valore del modello non si sovrascrive mai.
- **`valuta` misura anche la gabbia**, sia sulle previsioni salvate (`--salvate`) sia riclassificando.
- **`importa` con avanzamento visuale**: barra, stima del tempo, una riga per fase (conversione, visione, embedding, salvataggio, impronta) con spinner e tempi, riassunto per foto. Senza librerie ([src/comune/terminale.ts](src/comune/terminale.ts)); senza terminale, righe semplici.

### Modificato
- **Livelli della gabbia ridotti** a una decisione: acqua e cibo `ok` / `da_rifornire` / `non_visibile` (prima 5 livelli). "da_rifornire" comprende "sta finendo": l'avviso deve arrivare prima che manchi. Migrazione 005 converte i valori salvati.
- **Pulizia della gabbia tolta** da schema, prompt, agente e interfaccia: dalle foto non si riusciva a giudicarla. Le colonne nel database restano.
- **Webcam USB nuova**, vicina alla gabbia; foto e diario ripartiti da zero (backup del giorno prima in `data/archivio/`).

### Corretto
- `valuta` saltava in errore sulle foto etichettate ma archiviate: ora le salta con un avviso.

### Misurato
| | Risultato |
|---|---|
| **Azioni**, previsioni salvate, webcam nuova (101 etichette) | **82/101 = 81%** (ieri, webcam lontana: 57%) · mangia 14/14 · si pulisce 6/6 · riposa 34/43 · gioca 5/10 |
| **Acqua** (25 etichette) | **20/25 = 80%** |
| **Cibo** (29 etichette) | **21/29 = 72%**: 8 errori, tutti "da rifornire" non visti |
| Esperimento: regola delle due mangiatoie nel prompt (14 foto) | cibo 6/14 → **11/14**, ma **azioni 17/21 → 12/21** → **scartata** |
| CLIP | ~30 ms a foto · "a yellow budgie with ruffled feathers preening" trova per prima la foto in cui Cippi si pulisce |

### Problemi noti
- **Cibo**: per l'utente è "da rifornire" se anche una sola delle due mangiatoie è vuota; il modello guarda l'insieme. La regola nel prompt unico peggiora le azioni: va risolta con un prompt separato per la gabbia (ogni 15–30 minuti) o con un classificatore sui ritagli fissi delle mangiatoie.
- **La webcam USB si scurisce dopo un po'** (anche in Photo Booth) e torna normale solo staccandola e riattaccandola; l'esposizione non è regolabile (CameraController senza effetto). Va bene per sessioni brevi.
- Le etichette sono state date guardando le previsioni del modello: possibile effetto "ancoraggio" che gonfia un po' le accuratezze.
- Dopo la modifica al tool `stato_gabbia` l'agente non è stato riprovato con `npm run chiedi`.

---

## [0.11.0] — 2026-10-14 · Agente su LangChain/LangGraph e provider via env

### Aggiunto
- **Agente su LangChain + LangGraph** ([src/agente/](src/agente/)): `createAgent` costruisce il grafo modello ↔ tool al posto del ciclo `for` scritto a mano.
  - `strumenti.ts`: i 4 tool con `tool()` e schemi Zod (l'equivalente del `@tool` di Python);
  - `middleware.ts`: le regole come middleware. `promptDelGiorno` (system prompt con la data, a ogni chiamata), `guardrailRisposteInventate` (`wrapModelCall`: risposta con numeri senza tool → stessa chiamata con il modello "ragionante"), `argomentiPuliti` (`wrapToolCall`: via `""` e `null`, errori restituiti al modello);
  - `index.ts`: stream di LangGraph con `streamMode: ["messages", "updates"]` tradotto negli eventi della chat. La firma di `chiediAllAgente` non cambia: server e chat non se ne accorgono.
- **Fabbrica dei modelli** ([src/modelli/llm.ts](src/modelli/llm.ts)): `LLM_PROVIDER=ollama|bedrock` sceglie il provider per agente, visione ed embedding (`ChatOllama`/`ChatBedrockConverse`, `OllamaEmbeddings`/`BedrockEmbeddings`). Per Bedrock vanno indicati i modelli: se manca una variabile, errore chiaro.
- **Configurazione da `.env`** ([src/comune/env.ts](src/comune/env.ts), [.env.example](.env.example)), caricato con `process.loadEnvFile()` senza librerie.
- **Controllo degli embedding** (`controllaEmbedding`): all'avvio di server e import confronta le dimensioni del modello con la colonna `embedding_testo`, e si ferma con un messaggio chiaro se serve una migrazione.
- Nella traccia della chat ora compare anche il **ragionamento** (🧠) quando il guardrail fa riprovare.

### Modificato
- `src/ollama.ts` è diventato [src/modelli/modelli.ts](src/modelli/modelli.ts): niente più chiamate dirette a Ollama per chat ed embedding.
- **Visione su Ollama con chiamata nativa** (un solo messaggio testo + immagine), su Bedrock con `withStructuredOutput`.

### Misurato
| | Prima | Dopo |
|---|---|---|
| Agente, 8 domande | tool, argomenti e risposte | **identici**; guardrail sulle stesse 2 domande; tempi uguali (8–30 s) |
| Visione, codice precedente (un messaggio), 31 foto · 60 etichette | **57%** (34/60) | — |
| Visione via `@langchain/ollama` (due messaggi), stesse 32 etichette | 15/32 | **8/32** → scartata per Ollama |

### Problemi noti
- `@langchain/ollama` 1.3.0 spezza testo e immagine in due messaggi Ollama (`convertHumanGenericMessagesToOllama`). Nessuna segnalazione trovata: candidato a una issue upstream.
- L'SDK AWS avvisa che le versioni pubblicate da gennaio 2027 richiederanno Node 22.
- Webcam USB nuova ("CAMERA - UAC"): l'esposizione automatica non si lascia regolare (CameraController non ha effetto) e alcune foto escono scure.

---

## [0.10.1] — 2026-10-13 · Changelog, CLAUDE.md e versioning

### Aggiunto
- **CHANGELOG.md**: la storia del progetto ricostruita dai commit, con i numeri di ogni esperimento (**Misurato**) e i **Problemi noti**.
- **CLAUDE.md**: le direttive per lavorare sul repo con Claude Code. Versioning, ambiente, architettura, regole su prompt e modelli, best practice per Node e React, valutazione, checklist prima di ogni commit.
- **Tag git** `v0.1.0` … `v0.10.0` sui commit esistenti, e da qui un tag per ogni commit.

### Modificato
- `version` di `package.json` e `web/package.json` allineata al changelog (era rimasta `0.1.0`).

---

## [0.10.0] — 2026-10-13 · README e avvio con un comando (`cf18cf4`)

### Aggiunto
- **README completo**: architettura con diagrammi Mermaid, le scelte tecniche, i numeri della valutazione, le lezioni imparate e la roadmap verso AWS.
- **`npm run dev`** ([scripts/dev.mjs](scripts/dev.mjs)): accende Postgres se è spento, avvia API e interfaccia con l'output prefissato (`[api]`, `[web]`); Ctrl+C ferma tutto, figli compresi. Node puro, senza dipendenze.
- **`npm run valuta -- --foto NOME`**: valuta solo le foto indicate, per provare una modifica al prompt in pochi secondi.

---

## [0.9.0] — 2026-10-13 · Pagina Live e descrizioni più concrete (`d2744f6`)

### Aggiunto
- **Pagina Live**:
  - video della webcam in diretta nel browser (`getUserMedia`), con badge LIVE, orologio e scelta della fotocamera;
  - **Avvia / Ferma registrazione**: il server scatta ogni N secondi e analizza ogni foto **in coda**, una alla volta. Lo scatto non aspetta mai l'analisi;
  - scatti e stato (REC, durata, scatti, analizzati, in coda) aggiornati in tempo reale via SSE con `EventSource`;
  - ogni scatto mostra "in coda" → "il modello sta guardando…" → il risultato.
- `POST /api/registrazione/avvia` e `/ferma`, con opzioni validate da Zod; `GET /api/scatti`, `/api/scatti/:nome/immagine`, `/api/scatti/stream`.
- Nuovi campi nell'analisi: **`con_cosa`** (l'oggetto con cui interagisce l'uccellino) e **`pulizia`** della gabbia.
- **Migrazione 002**: colonne `con_cosa` e `pulizia`, indice su `con_cosa`.
- L'agente riporta gli oggetti negli episodi e la pulizia nello stato della gabbia.
- In galleria: "con campanellino" sotto l'azione, chip 🧹 se la gabbia è sporca, dettagli completi nella foto grande.

### Modificato
- **Limiti di lunghezza** (`.max()`) su tutti i campi di testo dello schema: finiscono nella grammatica di Ollama, quindi il modello non può superarli.
- Prompt con istruzioni più brevi e concrete per ogni campo.
- Codice condiviso estratto in [src/foto/webcam.ts](src/foto/webcam.ts) (trovare la fotocamera, scattare) e [src/foto/importazione.ts](src/foto/importazione.ts) (importare una foto): li usano `scatta`, `importa` e la registrazione.

### Corretto
- Le migrazioni ora fanno `DROP VIEW` + `CREATE VIEW`: prima, rilanciare la 001 dopo la 002 falliva ("non puoi togliere colonne a una vista").

### Misurato
| | Prima | Dopo |
|---|---|---|
| Accuratezza (12 foto, 24 etichette) | 63% | **38%** |
| Token generati a foto | 424 | 363 (−14%) |

### Problemi noti
- **Il calo di accuratezza viene dagli esempi nel prompt**: "becco tra le piume dell'ala", messo come esempio di postura, viene copiato dal modello e lo spinge verso "si pulisce" o "dorme". Da sistemare togliendo gli esempi suggestivi.
- Lo stato della registrazione vive nel processo del server: se il server si riavvia (anche in modalità watch), la registrazione si ferma.

---

## [0.8.0] — 2026-10-13 · Correzioni dalla galleria, nuove card e header (`a0915ec`)

### Aggiunto
- **Correzioni human-in-the-loop**: per ogni uccellino un menu per correggere l'azione, ✓ per confermare, ↺ per annullare. Aggiornamento ottimistico: la card cambia subito e torna com'era se il salvataggio fallisce.
- **Migrazione 001**: colonne `azione_umana` e `controllato_il`. La previsione del modello non viene mai sovrascritta.
- **Vista `eventi_effettivi`**: l'azione umana se c'è, altrimenti quella del modello. Galleria, archivio e agente leggono tutti da qui.
- `PATCH /api/eventi/:id` e `DELETE /api/eventi/:id/correzione`, che **ricalcolano l'embedding** (il suo testo contiene l'azione).
- `npm run db:migra` per applicare le migrazioni.
- `npm run valuta` usa anche le etichette della galleria; **`--salvate`** mostra la matrice di confusione delle previsioni salvate, l'accuratezza per azione e il confronto tra confidenza alta e bassa, senza chiamare il modello.
- **Etichette verdi e rosse sulla foto**: verde se il modello aveva ragione, rossa se l'hai corretto.
- **Foto grande** al click, in un `<dialog>` nativo (Esc, click fuori, ✕).

### Modificato
- **Card della galleria ridisegnate**: ombra morbida, ora e livelli di acqua e cibo come chip sulla foto, avatar colorato con l'iniziale, azione come chip con menu, barretta di confidenza, riga colorata dopo il controllo, barra "N/M controllati".
- **Header "corporate"**: barra fissa a tutta larghezza, logo SVG (anche come favicon), navigazione a schede, indicatore di stato dell'API, font Inter.

---

## [0.7.0] — 2026-10-13 · Chat in streaming (`e4bd058`)

### Aggiunto
- **`POST /api/chat/stream`** in Server-Sent Events: ragionamento, tool e risposta arrivano al browser man mano.
- Chiamata all'agente con `stream: true` verso Ollama (NDJSON, un pezzo per token).
- Nella chat: **"Sto pensando…"** che pulsa insieme alla traccia, e sparisce quando arriva la prima parola della risposta.

### Modificato
- La risposta va in streaming **solo dopo che è stato usato un tool**. Una risposta senza tool resta trattenuta finché il guardrail non l'ha controllata, così una risposta inventata non compare mai.
- Lato React, ogni evento passa da un reducer puro dentro un `setState` funzionale: sicuro anche con la doppia invocazione di StrictMode.

---

## [0.6.0] — 2026-10-13 · Traccia dell'agente (`59aea4e`)

### Aggiunto
- L'agente restituisce la **traccia** dei passaggi: 🧠 ragionamento (quando c'è), 🔧 tool con argomenti, ↳ risultato abbreviato, 🛡️ interventi del guardrail.
- La chat la mostra in grigio sopra la risposta; `npm run chiedi` la stampa da terminale.

---

## [0.5.0] — 2026-10-13 · L'agente della chat (`d14da93`)

### Aggiunto
- **Agente con 4 tool**: `eventi_del_giorno`, `conta_eventi`, `cerca_momenti` (pgvector + filtri SQL: ricerca ibrida), `stato_gabbia`.
- **Argomenti dei tool validati con Zod** prima di toccare il database; `""` e `null` vengono trattati come "non specificato".
- **Episodi** ([src/agente/episodi.ts](src/agente/episodi.ts)): eventi consecutivi con la stessa azione diventano un solo episodio.
- **Guardrail**: una risposta con numeri senza aver usato un tool viene scartata e la domanda ripetuta con il ragionamento acceso; se fallisce di nuovo, l'agente dice che non è riuscito a consultare il diario.
- Chat web con la storia della conversazione (domande successive tipo "e Sky?").
- `npm run chiedi` per interrogare l'agente da terminale.
- `npm run importa` accetta file singoli e `--lista lista.txt`.

### Modificato
- **Agente su `qwen3.5:9b`** invece di `qwen3:4b`: quest'ultimo ha il ragionamento sempre acceso (~600 token per scegliere un tool, 45–110 secondi a domanda). Ora un solo modello in memoria fa visione e chat.
- Il giorno nei tool è facoltativo, con oggi come default: il modello sbagliava data su domande come "c'è abbastanza acqua?".
- `stato_gabbia` restituisce un riassunto già calcolato (`ultimo_livello_visto`, foto per livello): il modello piccolo sbagliava a dedurlo da una lista lunga.

### Corretto
- Il markdown delle risposte viene tolto nell'interfaccia invece che chiesto nel prompt: la regola "non usare markdown" aveva fatto smettere l'agente di usare i tool.

---

## [0.4.0] — 2026-10-13 · Webcam e valutazione del classificatore (`6d01b89`)

### Aggiunto
- **`npm run scatta`**: una foto dalla webcam ogni N secondi con `imagesnap`, Mac tenuto sveglio con `caffeinate`. La fotocamera si sceglie per parte del nome, gestendo gli spazi speciali (`MacBook Air`).
- **`npm run valuta`**: accuratezza del classificatore sulle foto etichettate a mano ([eval/classificazione.json](eval/classificazione.json)), anche a risoluzioni diverse (`--lato`).
- Nel prompt, **indizi visivi** per ogni azione basati sulla posizione di testa e becco.

### Misurato
| Configurazione | Accuratezza (4 etichette) |
|---|---|
| `qwen3.5:9b`, 1024px | 1/4 (25%) |
| `qwen3.5:9b`, 1536px | nessun miglioramento, più lento |
| `qwen3-vl:8b` | peggiore, ~8× più lento (loop di ripetizione, ~4000 token) |

---

## [0.3.0] — 2026-10-13 · Import, backend e dati veri (`466aeb3`)

### Aggiunto
- **`npm run importa`**: converte le foto di `photos/` (anche HEIC dall'iPhone) in JPG da 1024px, legge l'**ora di scatto dall'EXIF** e salta le foto già importate.
- **API Hono**: uccellini, giorni, foto del giorno, immagini, chat (ancora solo ricerca semantica).
- Interfaccia sui **dati veri**: galleria con un evento per uccellino e i livelli di acqua e cibo, archivio dal database. I mock sono stati tolti.
- [eval/ricerca.json](eval/ricerca.json) e **`npm run confronta-embedding`** per confrontare modelli di embedding.

### Misurato
| Modello di embedding | hit@1 | MRR | Tempo |
|---|---|---|---|
| **nomic-embed-text** (scelto) | 3/4 | 0.88 | 0.2s |
| bge-m3 | 3/4 | 0.88 | 1.5–7s |
| qwen3-embedding:0.6b | 2/4 | 0.75 | 5.5s |

---

## [0.2.0] — 2026-10-13 · Postgres, pgvector e due uccellini (`ea1006c`)

### Aggiunto
- **Postgres 17 + pgvector** in Docker; tabelle `uccellini`, `foto`, `eventi`, con `embedding_testo` (indice HNSW) e `embedding_immagine` già prevista per CLIP.
- **Due uccellini, Cippi (giallo) e Sky (celeste)**, configurabili in [config/uccellini.json](config/uccellini.json).
- **Stato della gabbia**: livelli di acqua e cibo, con avviso se scarsi o vuoti.
- Embedding delle descrizioni con `nomic-embed-text` e **`npm run cerca`** per la ricerca semantica.

### Modificato
- Lo schema produce **un evento per uccellino** invece di uno per foto.
- **Il modello indica il colore, il nome lo assegna il codice**: prima scambiava Cippi e Sky pur vedendo bene i colori.
- **Campi descrittivi prima di azione e confidenza**: con l'output strutturato il modello "osserva" prima di classificare.

---

## [0.1.0] — 2026-10-13 · Primo classificatore e interfaccia (`a943bc7`)

### Aggiunto
- **Classificatore** ([src/comandi/classify.ts](src/comandi/classify.ts)): manda la foto a `qwen3.5:9b` in Ollama con output strutturato (`format` = JSON Schema generato da Zod), valida la risposta con Zod e misura i tempi (caricamento, lettura della foto, generazione).
- Contesto alzato a 8192 token: la foto da sola ne occupava circa 4000.
- **Interfaccia React** (Vite + React Router) con le pagine Oggi, Archivio, Configurazione (locale/AWS) e Credits, ancora su dati di prova.
