# cippi-cam

Diario di Cippi e Sky (due pappagallini): modello di visione → eventi validati con Zod → Postgres/pgvector → agente.

Tutto gira in locale: Ollama per i modelli, Postgres in Docker.

## Avvio

```bash
npm install && (cd web && npm install)
ollama pull qwen3.5:9b && ollama pull nomic-embed-text
npm run db:up            # Postgres 17 + pgvector
npm run db:migra         # applica db/migrazioni/ (si può rilanciare)
```

## Comandi

| Comando | Cosa fa |
|---|---|
| `npm run importa` | converte le foto nuove di `photos/` (anche HEIC), legge l'ora di scatto, classifica e salva |
| `npm run classify -- data/foto/X.jpg --dry-run` | analizza una foto senza salvarla |
| `npm run chiedi -- "quante volte ha mangiato Cippi?"` | chiede all'agente da terminale |
| `npm run cerca -- "Sky nascosto"` | ricerca semantica sul diario |
| `npm run scatta -- --ogni 20 --durata 60` | foto dalla webcam in `photos/` |
| `npm run valuta` | riclassifica le foto etichettate (file + galleria) e misura l'accuratezza |
| `npm run valuta -- --salvate` | matrice di confusione: previsioni salvate vs correzioni in galleria, senza modello |
| `npm run confronta-embedding -- nomic-embed-text bge-m3` | confronta modelli di embedding su `eval/ricerca.json` |
| `npm run server` | API su http://localhost:3001/api |
| `cd web && npm run dev` | interfaccia su http://localhost:5173 |
| `npm run db:psql` | console SQL |

## Come funziona

- `config/uccellini.json`: chi vive nella gabbia. Il modello riconosce il **colore**, il nome lo assegna il codice.
- `src/schema.ts`: il contratto Zod. I campi descrittivi vengono prima di azione e confidenza, così il modello osserva prima di classificare.
- `db/init.sql`: `foto` (con stato di acqua e cibo) → `eventi` (uno per uccellino, con `embedding_testo`).
- Gli eventi sotto confidenza 0.6 si salvano ma vengono mostrati come incerti.
- Correzioni in galleria: `azione_umana` accanto alla previsione del modello (che non si tocca); la vista `eventi_effettivi` dà l'azione giusta a galleria e agente, e l'embedding si ricalcola.
- `src/agente.ts`: l'agente della chat. Sceglie tra 4 tool (eventi, conteggi, ricerca semantica, gabbia), gli argomenti passano da Zod. Se risponde con numeri senza aver usato tool, la risposta viene scartata e riprova con il ragionamento acceso.
