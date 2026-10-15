# Changelog

Tutte le modifiche rilevanti di Cippi Cam, dalla più recente alla più vecchia.
Il formato segue [Keep a Changelog](https://keepachangelog.com/it/1.1.0/) e le versioni [Semantic Versioning](https://semver.org/lang/it/). Ogni versione corrisponde a un commit con il tag `vX.Y.Z`; per le versioni fino alla 0.10.0, ricostruite a posteriori, tra parentesi c'è anche l'hash.

Le sezioni **Misurato** riportano i risultati di `npm run valuta` e `npm run confronta-embedding` al momento della modifica.

---

## [0.17.0] — 2026-10-16 · LangSmith: tracce dell'agente e valuta-agente

### Aggiunto
- **Tracce su LangSmith** (progetto `cippi-cam`): con `LANGSMITH_TRACING=true` nel `.env`, LangChain e LangGraph mandano ogni esecuzione dell'agente con chiamate al modello, tool, argomenti, risultati, token e tempi. Non serve codice: basta la configurazione.
- **`npm run valuta-agente`** ([src/comandi/valuta-agente.ts](src/comandi/valuta-agente.ts)): `valuta` per la chat, come chiede la regola d'oro n. 2. Le 14 domande stanno in [eval/agente.json](eval/agente.json), versionato in git: conteggi, gabbia, momenti insieme, momenti precisi, ricerca per significato e due trabocchetti su un giorno senza dati. Il comando le sincronizza nel dataset `cippi-cam-agente` (si ricrea solo se il file cambia) e crea un esperimento su LangSmith.
- **Valutatori in codice**: `tool_giusti` (sono stati chiamati i tool attesi? `a|b` = basta uno dei due) e `risposta_giusta` (espressioni regolari che la risposta deve contenere e non deve contenere). Sono deterministici e gratuiti; un giudice LLM può aggiungersi dopo, per quello che le regex non vedono.
- `langsmith` tra le dipendenze dirette.

### Modificato
- **Le foto non finiscono nelle tracce**: le chiamate di visione su Bedrock passano un tracer suo ([src/modelli/tracce.ts](src/modelli/tracce.ts)) che sostituisce le immagini base64 con `[immagine]`. LangChain aggiunge il tracer dell'ambiente solo se la chiamata non ne ha già uno. Su Ollama la visione non passa da LangChain e non è tracciata.

### Misurato
- Primo esperimento, Qwen3 235B su Bedrock, diario su RDS: **tool giusti 14/14, risposte giuste 12/14**, 1-3 s a domanda. Le tre domande sbagliate prima della 0.14.0 (acqua e cibo insieme, giocare insieme, le 16:26) ora passano.
- Le due risposte sbagliate dipendono da due **tool**, non dal modello:
  - "quando era da rifornire l'acqua nel pomeriggio tardi?": il modello chiede `stato_gabbia` alle 18:00 e alle 20:00, e il tool risponde con l'ultimo controllo (16:43) **senza dire che dopo non ci sono dati**. Il modello allora scrive "alle 18:00 era ok", un'informazione inventata.
  - "mentre Cippi mangiava, cosa faceva Sky?": `momenti_insieme` con `azione` vuol dire "lo fanno tutti e due", e la risposta è vuota. Manca un filtro "quando **uno** fa X".
- Tracce della visione senza foto: verificato su LangSmith (1.800-4.600 caratteri a chiamata, `[immagine]` al posto del base64). Le previsioni non cambiano: la modifica tocca solo il tracing (provata su una foto con `valuta --foto`).

### Problemi noti
- La destinazione "agente" di LangSmith (`LANGSMITH_AGENT_ID` / `LANGSMITH_AGENT_ENVIRONMENT`) non funziona con LangChain: `@langchain/core` 1.2.17 manda sempre le esecuzioni a un progetto, e le due destinazioni insieme danno errore. Si usa `LANGSMITH_PROJECT`.
- In alcuni controlli della gabbia `stato_gabbia` restituisce `cibo: null`: da capire insieme alla correzione del tool.
- Le risposte attese di `eval/agente.json` valgono per il diario su RDS: il Postgres locale ha analisi diverse (qwen3.5:9b).
- Sulla Lambda della chat il tracing non è ancora attivo.

## [0.16.0] — 2026-10-15 · MCP remoto su AWS con link unico

### Aggiunto
- **MCP remoto** (Streamable HTTP) sulla route `/api/mcp/<token>` della Lambda dell'API, per i connettori personalizzati di claude.ai (web e telefono). *Stateless*: su Lambda ogni richiesta può arrivare a un'istanza diversa, quindi niente sessioni, e server e trasporto si creano a ogni richiesta. Risposte JSON invece di SSE, perché i tool rispondono in un colpo solo.
- **Link unico** come protezione, una scelta da demo: un token di 40 caratteri generato da Terraform (`random_password.mcp`, output `mcp_url`) sta nell'URL. La route salta la Basic Auth (i connettori non la mandano), confronta il token in tempo costante e con un token sbagliato risponde 404. I tool sono in sola lettura. Per revocarlo: `terraform apply -replace=random_password.mcp`.
- `npm run mcp:prova -- --url URL`: lo stesso client di prova, sul trasporto HTTP.
- In locale l'MCP remoto si accende con `MCP_TOKEN` nel `.env`.

### Modificato
- La creazione del server MCP è passata in [src/server/mcp.ts](src/server/mcp.ts), usata sia da stdio ([src/comandi/mcp.ts](src/comandi/mcp.ts)) sia da HTTP ([app.ts](src/server/app.ts)).

### Misurato
- Su AWS: token sbagliato → 404; API e sito senza password → 401; con il link giusto `tools/list` restituisce i 5 tool, e `conta_eventi`, `stato_gabbia` e `cerca_momenti` (che chiama Titan dalla Lambda) rispondono con i dati di RDS. Client di prova completo in ~4,6 s, compreso l'avvio a freddo.

### Problemi noti
- Il link è l'unica protezione: chi lo ha può leggere il diario e far fare ricerche su Bedrock (frazioni di centesimo ciascuna). Per un uso non da demo servirebbe OAuth, l'autenticazione prevista da MCP.

## [0.15.0] — 2026-10-15 · Server MCP con i tool del diario

### Aggiunto
- **Server MCP** ([src/comandi/mcp.ts](src/comandi/mcp.ts)): i cinque tool dell'agente esposti con il Model Context Protocol su stdio, usabili da Claude Desktop, Claude Code o qualunque client MCP. I tool di LangChain hanno già nome, descrizione e schema Zod: il server li registra in un ciclo, quindi una modifica a un tool vale per la chat e per MCP. Tutti segnati `readOnlyHint`; gli errori tornano al modello come testo.
- [src/comandi/mcp-avvio.ts](src/comandi/mcp-avvio.ts), importato per primo: manda i log su stderr (stdout è il canale del protocollo, una riga di log romperebbe il JSON-RPC) e sposta la cartella di lavoro nella radice del progetto, perché il client lo avvia da dove vuole.
- `npm run mcp:prova` ([src/comandi/mcp-prova.ts](src/comandi/mcp-prova.ts)): un client MCP minimo che avvia il server, chiede `tools/list` e chiama due tool. Con `DB_PROVIDER=rds` lavora sul diario su AWS.
- [.mcp.json](.mcp.json): Claude Code trova il server da solo aprendo il progetto. Nel README la configurazione per Claude Desktop, anche sul diario su AWS.

### Misurato
- Prove del protocollo, non del modello: `tools/list` restituisce i 5 tool, e `conta_eventi`, `stato_gabbia` e `momenti_insieme` danno gli stessi riassunti della chat, sia sul Postgres locale sia su RDS. Il server risponde anche avviato da `/` con l'ambiente vuoto, come lo avvia Claude Desktop.

### Problemi noti
- Il server gira sul Mac (stdio): da claude.ai sul web non si usa. Serve un MCP remoto su HTTP (prossima versione).
- I tool considerano "oggi" la data corrente: sul diario su AWS c'è solo il 14 ottobre, quindi nelle domande va indicata la data.

## [0.14.0] — 2026-10-15 · Online su AWS con Terraform, Qwen su Bedrock e agente con gli orari

### Aggiunto
- **Infrastruttura su AWS in Terraform** ([infra/](infra/), regione `eu-south-1`), stato su S3. La pipeline: il Mac carica i JPG su S3 (`npm run carica`) → notifica → SQS (3 tentativi, poi dead letter queue per 14 giorni) → Lambda `analizza-foto` → Bedrock → RDS. Il sito: CloudFront davanti a S3 (frontend) e a una Lambda con Function URL e response streaming (API, la stessa `app.ts` del server locale).
- **[src/server/app.ts](src/server/app.ts)**: le route comuni a server locale e Lambda; il server locale aggiunge solo la pagina Live. **[src/aws/](src/aws/)**: i due handler. **[src/foto/s3.ts](src/foto/s3.ts)**: chiavi e metadati (l'ora di scatto viaggia come metadato dell'oggetto).
- **`DB_PROVIDER=pg|rds`** in [src/db/connessione.ts](src/db/connessione.ts): su RDS l'utente `diario` entra senza password, con un token IAM firmato e in SSL verificando il certificato di RDS ([config/rds-ca-eu-south-1.pem](config/rds-ca-eu-south-1.pem)). Le query di `db.ts` non cambiano.
- Comandi: `carica`, `build:lambda` (esbuild), `db:migra:aws` (schema, migrazioni, uccellini e utente `diario`, con la password del master letta da Secrets Manager), `deploy:web`, `copia-correzioni` (le correzioni della galleria dal Postgres locale a RDS, abbinate per percorso e uccellino, con gli embedding ricalcolati).
- **Password su tutto il sito**, controllata da una CloudFront Function. Con la password solo sull'API il browser non mostrava il riquadro di login (non lo fa per le `fetch`) e la pagina vedeva l'API "offline". L'API la controlla anche per conto suo.
- **Agente: i "quando"** ([src/agente/episodi.ts](src/agente/episodi.ts), [strumenti.ts](src/agente/strumenti.ts)). L'agente diceva che acqua e cibo non erano mai mancati insieme (erano scarsi tutti e due dalle 16:23 alle 16:30) e rispondeva a "hanno giocato insieme?" una volta sì e una volta no. Il problema erano i tool, che non avevano gli orari:
  - `stato_gabbia` ed `eventi_del_giorno` restituiscono gli intervalli già calcolati (`acqua_scarsa`, `cibo_scarso`, `acqua_e_cibo_scarsi_insieme`) e, con `ora`, com'era la gabbia in quel momento;
  - nuovo tool `momenti_insieme`: le sovrapposizioni degli episodi dei due uccellini, calcolate dal codice.

### Modificato
- **Modelli su Bedrock scelti misurando** (vedi Misurato): Qwen3-VL 235B per la visione, Qwen3 235B per la chat (chiama i tool via Converse), Titan Text Embeddings v2 a 1024 dimensioni.
- **Database: RDS Postgres `db.t4g.micro` invece di Aurora Serverless v2 + Data API.** Sul piano free di AWS Aurora si crea solo in "express configuration", che il provider Terraform (6.69) non supporta; il piano free limita anche i backup a 1 giorno. RDS è pubblico sulla 5432 perché le Lambda stanno fuori dalla VPC (dentro servirebbe una NAT, ~35 $/mese); per entrare servono SSL e il token IAM. Costo fisso: ~3,6 $/mese di IPv4 pubblico.
- Gli zip delle Lambda passano da S3: con l'upload diretto il provider falliva con `bufio.Scanner: token too long`.
- Prompt della visione: tolto l'esempio di postura "testa girata, becco tra le piume dell'ala", che il modello copiava (vedi Problemi noti).

### Corretto
- **La Lambda `analizza-foto` non partiva**: esbuild incorporava l'`import()` dinamico di CLIP e il suo import (external) finiva in cima a `index.mjs`. Con `splitting` resta un file a parte; il file principale passa da 2,4 a 0,4 MB.
- L'API rispondeva 500 invece di 401 senza password: `onError` era registrato due volte e trasformava anche le `HTTPException` di Hono.
- Su RDS la tabella `uccellini` era vuota (in locale la riempie il server all'avvio) e ogni evento falliva sulla chiave esterna: ora la riempie `db:migra:aws`.
- `db:migra:aws` creava `embedding_testo` a 768 dimensioni se nella shell mancava `LLM_PROVIDER=bedrock`: ora lo imposta lo script e, a tabella vuota, la colonna si corregge da sola.

### Misurato
`npm run valuta` sulle 57 foto etichettate, stesso prompt, modelli su Bedrock:

| | qwen3.5:9b locale (0.13.0) | **Qwen3-VL 235B** | Nova 2 Lite |
|---|---|---|---|
| azioni (101) | 66 (65%) | **57 (56%)** | 51 (50%) |
| acqua (36) | 15/27 (56%) | 14 (39%) | 14 (39%) |
| cibo (31) | 28 (90%) | **29 (94%)** | 23 (74%) |
| tempo a foto | ~40 s | ~4 s | ~3 s |

- Qwen3-VL: l'errore più frequente è "mangia" dove l'etichetta dice "riposa" (19 su 44), probabilmente perché l'uccellino è vicino alla mangiatoia. Nova 2 Lite vede uccellini che l'etichetta segna come non visibili (19 volte) e dice "ok" quando il cibo è da rifornire (7 su 8).
- Acqua: errori quasi simmetrici con tutti e due i modelli, cioè tirano a indovinare. Sembra un limite dell'inquadratura più che del modello.
- Online, `valuta --salvate` con le correzioni copiate: azioni 56/101 (55%), coerente con la misura sopra.
- Claude Haiku 4.5 non misurato: Bedrock lo blocca finché non si compila il modulo sul caso d'uso di Anthropic.

### Problemi noti
- **Il confronto con il modello locale non è del tutto alla pari**: rispetto alla misura della 0.13.0 il prompt ha perso l'esempio di postura, e le etichette dell'acqua sono passate da 27 a 36. Manca un `valuta` di `qwen3.5:9b` con il prompt attuale.
- **Le modifiche all'agente non sono ancora state misurate con `npm run chiedi`**, né in locale né con Qwen3 235B su Bedrock.
- Su AWS il controllo della gabbia gira ogni 20 minuti come in locale: sulle foto caricate in blocco ce ne sono pochi, quindi acqua e cibo si vedono su poche foto.
- L'SDK di AWS avvisa che dal 2027 non supporterà più Node 20: le Lambda sono già su Node 22, il Mac va aggiornato.

## [0.13.0] — 2026-10-14 · Prompt separato per la gabbia, esperimenti CLIP e classificatori

### Aggiunto
- **Un prompt solo per la gabbia** (`classifyGabbia` in [src/modelli/modelli.ts](src/modelli/modelli.ts), schema `AnalisiGabbia`). Una regola sul cibo nel prompt unico aveva peggiorato le azioni (17/21 → 12/21): le regole della gabbia ora stanno in un prompt a parte, e quello delle azioni non parla più di gabbia.
  - cibo: "da_rifornire" se **anche una sola** delle due mangiatoie è vuota o quasi;
  - acqua: "da_rifornire" solo se nella bottiglia ce n'è **meno di 1/5** o è finita.
- **Controllo della gabbia a tempo** ([src/foto/importazione.ts](src/foto/importazione.ts)): i livelli non cambiano in un minuto, quindi il secondo prompt (~16 s) gira ogni `GABBIA_OGNI_MIN` minuti (20) e, se l'ultimo controllo diceva "da_rifornire", di nuovo dopo `GABBIA_RICONTROLLO_MIN` (5): un avviso futuro partirà solo su un problema confermato. Conta l'ora dello scatto, quindi funziona anche importando foto vecchie. Vale per `importa` e per la pagina Live; `classify` controlla sempre.
- Migrazione 006: `acqua` e `cibo` possono essere `NULL` (foto senza controllo), indice parziale sui controlli.
- **Esperimenti** (solo lettura, sulle impronte CLIP già salvate):
  - `npm run clip-zero-shot` (`-- --gabbia`): classificare con frasi in inglese, senza addestramento;
  - `npm run classificatore` (`-- --blocco N`): k-NN e regressione logistica scritti a mano, addestrati sulle etichette della galleria, con leave-one-out e leave-one-block-out.

### Modificato
- `classify` ha la stessa grafica di `importa` (una riga per fase con spinner, riassunto, dettagli); riassunto e nomi delle fasi in [src/foto/pipeline.ts](src/foto/pipeline.ts), condivisi.
- `importa` mostra "gabbia non controllata" sulle foto saltate dal timer.
- `valuta` usa i due prompt separatamente: un errore su uno non conta sull'altro.
- Galleria: pillole e riga "Gabbia" solo sulle foto controllate.
- Agente: `stato_gabbia` parla di controlli e dice l'ora dell'ultimo.

### Misurato
`npm run valuta` (riclassificando, webcam nuova), ricontato con le etichette corrette dopo la misura:

| | prima (previsioni salvate, prompt unico) | dopo (riclassificando, due prompt) |
|---|---|---|
| azioni | 82/101 (81%) | 66/101 (65%) |
| acqua | 22/27 (81%) | 15/27 (56%) |
| cibo | 23/31 (74%) | **28/31 (90%)** |

⚠️ Il "prima" non è una misura alla pari: sono previsioni salvate, prodotte da versioni diverse del prompt, ed etichettate partendo da quelle (le conferme tendono a dare ragione al modello). Manca un `valuta` del prompt unico sulle stesse foto per sapere quanto del calo delle azioni è reale.

Esperimenti:
- CLIP zero-shot: azioni 28% (almeno uno dei due faceva quell'azione); acqua 73% contro 69% rispondendo sempre la classe più frequente; cibo 35% contro 68%. CLIP sulla foto intera non vede gesti né livelli.
- Classificatori su CLIP: cibo 84% con leave-one-out, ma 52–55% togliendo le foto entro ±10 min e 19–32% entro ±20 min. Le foto consecutive sono quasi identiche: il leave-one-out semplice era gonfiato (data leakage temporale).

### Problemi noti
- Azioni: l'errore principale resta **si_pulisce invece di riposa** (×12). Nella postura il modello scrive spesso "becco tra le piume dell'ala", che è l'esempio del prompt: lo sta copiando, va tolto e rimisurato.
- Acqua: sbaglia in tutte e due le direzioni (da_rifornire invece di ok ×5, ok invece di da_rifornire ×3, non_visibile ×4): la bottiglia trasparente dalla webcam è difficile; la regola dell'1/5 non ha aiutato.

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
