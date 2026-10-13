# cippi-cam

Diario di Cippi e Sky (due pappagallini): modello di visione → eventi validati con Zod → Postgres/pgvector → agente.

Tutto gira in locale: Ollama per i modelli, Postgres in Docker.

## Avvio

```bash
npm install && (cd web && npm install)
ollama pull qwen3.5:9b && ollama pull nomic-embed-text
npm run db:up            # Postgres 17 + pgvector
```

## Comandi

| Comando | Cosa fa |
|---|---|
| `npm run importa` | converte le foto nuove di `photos/` (anche HEIC), legge l'ora di scatto, classifica e salva |
| `npm run classify -- data/foto/X.jpg --dry-run` | analizza una foto senza salvarla |
| `npm run cerca -- "Sky nascosto"` | ricerca semantica sul diario |
| `npm run confronta-embedding -- nomic-embed-text bge-m3` | confronta modelli di embedding su `eval/ricerca.json` |
| `npm run server` | API su http://localhost:3001/api |
| `cd web && npm run dev` | interfaccia su http://localhost:5173 |
| `npm run db:psql` | console SQL |

## Come funziona

- `config/uccellini.json`: chi vive nella gabbia. Il modello riconosce il **colore**, il nome lo assegna il codice.
- `src/schema.ts`: il contratto Zod. I campi descrittivi vengono prima di azione e confidenza, così il modello osserva prima di classificare.
- `db/init.sql`: `foto` (con stato di acqua e cibo) → `eventi` (uno per uccellino, con `embedding_testo`).
- Gli eventi sotto confidenza 0.6 si salvano ma vengono mostrati come incerti.
