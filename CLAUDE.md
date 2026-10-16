# CLAUDE.md — Cippi Cam

Rules for working on this repo. They apply to every session. Project context is in the [README](README.md), history in the [CHANGELOG](CHANGELOG.md).

**In short:** a diary of two budgies (Cippi yellow, Sky light blue). Webcam → vision model (`qwen3.5:9b` in Ollama, or Bedrock via env) → structured output validated with Zod → Postgres + pgvector → Hono API → React. A chat with a tool-using LangChain/LangGraph agent queries the diary; the same tools are exposed as an MCP server. It runs locally and on AWS (Terraform in `infra/`). It's an **AI engineering showcase**: choices must be explainable and **measured**.

---

## 1. Golden rules

1. **Every commit has a version.** See [§2](#2-versioning-on-every-commit). No exceptions.
2. **Measure before changing a prompt, a tool or a model.** Every change to `src/modelli/modelli.ts` (vision prompt), `src/modelli/schema.ts`, `src/agente/` or to the models is evaluated before and after — `npm run valuta` for vision, `npm run valuta-agente` for the agent — and the result goes in the CHANGELOG under **Measured**. An "improved" prompt without a measurement already cost us half the accuracy (63% → 38%).
3. **Guardrails live in code, not only in the prompt.** A small model's prompt is fragile: one extra rule ("don't use markdown") made the agent stop using tools. Validation, rejections and fallbacks are written in TypeScript.
4. **The model's prediction is never overwritten.** Human corrections go in `azione_umana`; reads go through the `eventi_effettivi` view.
5. **Zod is the contract.** Every piece of data coming from outside (model output, tool arguments, HTTP bodies, config files) goes through a Zod schema.

---

## 2. Versioning on every commit

We follow [Semantic Versioning](https://semver.org/). We're on `0.x`: the API isn't stable.

| Kind of change | Bump | Example |
|---|---|---|
| New feature, page, tool, migration, prompt or model change | **minor** | 0.10.0 → 0.11.0 |
| Bug fix, refactoring without behaviour change, documentation, style | **patch** | 0.11.0 → 0.11.1 |
| Breaking change (non-backward-compatible DB schema, broken API) — from `1.0.0` on | **major** | 1.4.2 → 2.0.0 |

**On every commit, in the same commit:**

1. Update `"version"` in **both** `package.json` files (root and `web/`): they must always match.
2. Add at the top of [CHANGELOG.md](CHANGELOG.md) a section `## [X.Y.Z] — YYYY-MM-DD · Short title`, in English, with the subsections needed: **Added**, **Changed**, **Fixed**, **Removed**, **Measured**, **Known issues**. Explain the *why*, not just the *what*. Don't write the hash (it doesn't exist yet): the tag carries it.
3. Commit message in English: first line `vX.Y.Z — Title`, then a bullet list, then the attribution line.
4. After the commit, create the annotated tag: `git tag -a vX.Y.Z -m "vX.Y.Z — Title"`.

Commit and push **only when the user asks**. The repo has no remote yet: don't create one unless the user asks (publishing the code is their call).

---

## 3. Environment

- **Node via nvm, not on Claude's shell PATH.** Before `npm`/`npx`/`node`:
  `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`
- **Docker** for local Postgres (`npm run db:up`). If `docker info` fails, Docker Desktop is off: ask the user to open it.
- **Ollama** with `qwen3.5:9b` and `nomic-embed-text`. The Mac has 16 GB: one large model at a time. Don't download heavy models (>1 GB) without saying so, and offer to delete the discarded ones.
- **AWS**: CLI profile `cippi`, region `eu-south-1`. If a command says the session has expired, ask the user to run `aws login --profile cippi`. Any `terraform apply` or resource creation needs the user's explicit OK; `terraform plan` is fine.
- **Ports**: API 3001, interface 5173. The user often already has `npm run server` (watch mode) and Vite running: **don't start** processes on those ports without asking, and don't stop theirs.
- The server in watch mode restarts on every backend change, and **a restart stops the Live page recording**.

---

## 4. Working with the user

- **Reply to the user in Italian.**
- **Languages in the repo**: the interface, the agent's answers, README, CHANGELOG and CLAUDE.md are in **English**. Code (file names, identifiers, comments), prompts, database values and the model's descriptions stay in **Italian**: keep that consistent. User-visible labels for Italian values (actions, levels) go through the maps in `web/src/api.ts`.
- **Before running a non-trivial command, explain in one line what it does and why.** The user wants to follow and understand.
- **The user tests the interface.** After a frontend change: `tsc` + build, then say what they should see, without opening the browser and without starting recordings (they take real webcam photos).
- **Be honest about results.** If a measurement gets worse, say so with numbers and propose the fix.
- **Look and ask before deleting.** `photos/` and `data/` are outside git: what's deleted there can't be recovered. Show what will be deleted and ask for confirmation, unless explicitly asked about a specific file.

---

## 5. Architecture: what goes where

The `src/` folders: `comandi/` (one file per `npm run …`), `server/` (API, MCP server and Live page), `aws/` (Lambda handlers), `foto/` (webcam → diary), `modelli/` (everything that calls a model, plus the Zod schema), `agente/` (the chat), `db/` (queries and connection), `comune/` (env, birds, shared types, terminal). A new file goes in the folder of its job; a new command goes in `comandi/` plus its line in `package.json`.

| Responsibility | File | Rule |
|---|---|---|
| Model output contract | `src/modelli/schema.ts` | Single source; JSON Schema (for Ollama) and types come from here |
| Which provider and models | `src/modelli/llm.ts` | **Only here** is the provider chosen (`LLM_PROVIDER=ollama|bedrock`) and the LangChain models created. The rest of the code doesn't know whether Ollama or Bedrock is underneath |
| Image fingerprints | `src/modelli/immagini.ts` | CLIP (Hugging Face, transformers.js, CPU): photos and English sentences in the same space; model in `data/modelli/`. Off on AWS |
| Vision and embeddings | `src/modelli/modelli.ts` | Vision prompt; on Ollama a **native** call (one text + image message: LangChain splits it in two and accuracy drops), on Bedrock `withStructuredOutput`; embeddings with prefixes; dimension check |
| Traces | `src/modelli/tracce.ts` | Vision calls pass a tracer that hides the base64 photos from LangSmith |
| Database queries | `src/db/db.ts` | **Only here** is there SQL (exceptions: `migra-aws`, `copia-correzioni`, `valuta-agente` read two databases or run DDL). The rest of the code doesn't know it's Postgres |
| Database connection | `src/db/connessione.ts` | `DB_PROVIDER=pg|rds`: password locally, IAM token + SSL on RDS |
| Types shared with the frontend | `src/comune/api-types.ts` | **Types only**, no runtime imports (the browser imports them) |
| A photo into the diary | `src/foto/importazione.ts` | Used by `importa`, the recording and the `analizza-foto` Lambda (`importaJpg`) |
| Webcam | `src/foto/webcam.ts` | The only place that uses `imagesnap` |
| Agent | `src/agente/` | `createAgent` (LangGraph): `strumenti.ts` (tools), `middleware.ts` (guardrail and rules), `prompt.ts`, `index.ts` (stream → chat events) |
| MCP | `src/server/mcp.ts` | Registers the agent's tools; transports in `src/comandi/mcp.ts` (stdio) and `app.ts` (`/api/mcp/:token`) |
| Environment variables | `src/comune/env.ts`, `.env.example` | `.env` loaded first; never secrets in code |
| API | `src/server/app.ts` (shared), `index.ts` (local), `src/aws/api.ts` (Lambda) | Thin: validate, call the modules, respond |
| Birds | `config/uccellini.json` | Name ↔ colour; the model never sees the names |
| Infrastructure | `infra/*.tf` | Terraform; comments explain the *why* of each choice |

---

## 6. Models and prompts

- **The model says the colour, the code assigns the name** (`nomeDaColore`). Don't put the names back in the prompt: the model swapped them.
- **Field order = generation order.** The descriptive fields (posizione, postura, con_cosa, descrizione) stay **before** `azione` and `confidenza`.
- **Every text field has a `.max()`**: it ends up in the grammar and caps tokens (and so time). A new field without a limit doesn't go in.
- **No examples that describe an action** in the prompt (like "beak in the feathers"): the model copies them. Examples must be neutral or about format.
- **In a prompt everything is connected**: a food rule made the actions worse (17/21 → 12/21). That's why there are two prompts: actions and cage (which runs on a timer, not on every photo). A change to one field is measured on the other fields of its prompt too; if a field needs its own rules, a separate prompt is better.
- **The model's `confidenza` is not a probability.** Don't build important logic on it without validating it with `valuta --salvate`.
- **Enums instead of free text** when there are few values: they cost 2–3 tokens and can be filtered in SQL.
- **Agent**: answers in the language of the question. A change to the system prompt is measured with `npm run valuta-agente` on both datasets (`eval/agente.json` and `eval/agente-en.json`) to check it still uses the tools. Formatting and text clean-up happen in the interface, not by asking the model.
- **Tools return precomputed summaries**, not long lists to interpret. When the agent gets an answer wrong, check first whether the tool had the answer.
- **Tool arguments**: Zod schema, `""`/`null` treated as absent, errors returned to the model as JSON so it can correct itself.

---

## 7. LangChain and LangGraph

- **Models only from `src/modelli/llm.ts`** (`modelloChat`, `modelloVisione`, `modelloEmbedding`), reused with `unaVolta`. Never scattered `new ChatOllama(...)`: that's what lets the provider change via env.
- **Tools with `langchain`'s `tool()`** and a Zod schema; `name` and `description` are written for the model, which reads them to choose. Return compact JSON and summaries, not long lists.
- **Agent rules as middleware** (`createMiddleware`): `wrapModelCall` to check or repeat a model call, `wrapToolCall` for tool arguments and errors. The model ↔ tool loop isn't rewritten by hand.
- **The agent stream** uses `streamMode: ["messages", "updates"]`: tokens from "messages", tools and final answers from "updates". The answer is streamed only after a tool (the guardrail holds it back otherwise).
- **After every change to models, tools, middleware or prompt**: `npm run valuta-agente` and compare with the previous experiment on LangSmith (tools chosen, made-up answers, timings).
- **LangSmith**: use `LANGSMITH_PROJECT`, not `LANGSMITH_AGENT_*` (LangChain's tracer always sends to a project and the two together raise an error). Calls with photos must not send the image (see `tracce.ts`).
- If `EMBED_MODEL` changes, `controllaEmbedding()` stops server and import: the column needs a migration, not just the env.

## 8. Backend (Node + TypeScript)

**Language and modules**
- TypeScript `strict`, ESM with `module: NodeNext`: relative imports use the **`.js`** extension even when the file is `.ts`.
- `npx tsc --noEmit -p .` must pass before every commit.
- `async`/`await` everywhere; no nested callbacks. Promises not awaited are marked with `void` and a comment on why.
- No `any`: use `unknown` and narrow with Zod or type guards.

**Input and errors**
- **Validate at the boundaries**: HTTP body, query and params with Zod (`safeParse` → 400 with a clear message). Numeric `id`s are checked with `Number.isInteger`.
- Expected errors → explicit HTTP response (400, 404, 409). Unexpected errors → handled by `app.onError` (log + 500); Hono's `HTTPException`s keep their own response.
- File paths coming from outside are validated with a whitelist (`nomeValido`): never concatenate user input into a path.

**Database**
- **Parameterised queries only** (`$1, $2…`), never concatenated strings.
- Several related writes → **transaction** (`BEGIN`/`COMMIT`/`ROLLBACK`, `client.release()` in `finally`).
- Dates are stored as `timestamptz`; "the day" is computed in the `Europe/Rome` time zone.
- CLI scripts close the pool (`chiudi()`) in `finally`.

**Migrations**
- New numbered files in `db/migrazioni/NNN_name.sql`; don't modify the ones already applied (except fixes to make them re-runnable).
- They must be **re-runnable**: `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and the `eventi_effettivi` view always with `DROP VIEW IF EXISTS` + `CREATE VIEW` (with every column).
- Every new migration is tested with `npm run db:migra` **twice in a row**, and on AWS with `npm run db:migra:aws`.

**Long processes and streaming**
- SSE with Hono's `streamSSE`; loops check `stream.aborted` and send a periodic `ping`.
- Heavy work (photo analysis) **in a queue**, one at a time: never block the HTTP request or the capture.
- `execFileSync` only in CLIs or inside the queue worker, never in an HTTP handler.
- Child processes (`caffeinate`, `imagesnap`) are always closed (`kill` on stop, `-w <pid>` for `caffeinate`).

**Secrets**
- Never in code or commits. Configuration from environment variables, documented in `.env.example` (`DATABASE_URL`, `DB_PROVIDER`, `LLM_PROVIDER`, `*_MODEL`, `AWS_REGION`, `LANGSMITH_*`…); `.env` stays out of git. AWS credentials are found by the SDK (SSO, profile, IAM role). On AWS, passwords and tokens are generated by Terraform or RDS, never typed in. Docker's `cippi` password is for local development only.

---

## 9. Frontend (React + Vite)

**Structure**
- Function components + hooks. Pages in `web/src/pages/`, reused components in `web/src/components/`, API calls **only** in `web/src/api.ts`.
- Response types imported from `src/comune/api-types.ts` (via `api.ts`): don't redefine them by hand.
- `cd web && npx tsc --noEmit` and `npm run build` must pass before every commit.
- User-visible text is in English; Italian values from the API go through `nomeAzione` / `nomeLivello`.

**State**
- **Immutable state**: always create a new object (`{ ...m, text }`), never `m.text += …`.
- **Functional updates** (`setX(prev => …)`) when state is updated from async code (streams, long fetches): avoids closures with stale data.
- **Pure updaters and reducers**: in StrictMode React calls them twice in development; side effects would double the data.
- Optimistic updates with **rollback** and a message if the request fails.

**Effects**
- A `useEffect` **never returns a Promise**: no `useEffect(async () => …)` nor short arrow functions returning a call's value (it happened: `scrollIntoView` returns a Promise in recent Chrome → "destroy is not a function"). Use braces.
- **Always clean up**: `clearInterval`, `EventSource.close()`, `track.stop()` on the webcam, an `attivo = false` flag to ignore responses arriving after unmount. For long fetches prefer `AbortController`.
- `EventSource` for GET streams (it reconnects by itself); `fetch` + `ReadableStream` for POST ones.

**Rendering and accessibility**
- Stable `key`s (ids, file names), not the index if the list can reorder.
- Semantic elements: `<button>` for actions, `<select>`/`<label>` for choices, `<dialog>` with `showModal()` for modals, `aria-label` on controls without text.
- Don't add UI or state libraries without a concrete reason: React, React Router and CSS are enough today.

**Style**
- CSS in `web/src/styles.css`, with **tokens on `:root`** (`--bg`, `--panel`, `--text`, `--muted`, `--accent`, `--giusto`, `--sbagliato`…) and a dark theme in `@media (prefers-color-scheme: dark)`. No scattered colours in components, except the birds' (`COLORE_CSS`).
- Short animations, disabled with `@media (prefers-reduced-motion: reduce)`.
- Layouts that work on narrow screens too (`auto-fill` grids with `minmax(min(Npx, 100%), 1fr)`).
- "Product" tone, not "game": no emoji in the interface structure (header, titles); they're fine as action icons.

---

## 10. Evaluation

| Command | When |
|---|---|
| `npm run valuta` | before and after every change to the vision prompt, schema or model (~40 s per photo locally, ~4 s on Bedrock) |
| `npm run valuta -- --foto NAME` | quick check on one or two hard photos, before the full measurement |
| `npm run valuta -- --salvate` | instant: confusion matrix of saved predictions against the corrections |
| `npm run valuta-agente` (`-- --file eval/agente-en.json`) | before and after every change to the agent (prompt, tools, middleware, model); creates a LangSmith experiment. Expected answers hold for the diary on RDS |
| `npm run confronta-embedding -- A B` | before changing the embedding model |
| `npm run chiedi -- "…"` | to look at a single question with its tool trace |

A measurement on one photo is **not** a result: decisions need the 12+ labelled photos. A loaded Mac stretches the timings: to compare speed look at **tokens**, not seconds. Set `LANGSMITH_TRACING=false` in front of commands you don't want traced.

---

## 11. Pre-commit checklist

- [ ] `npx tsc --noEmit -p .` (backend) and `cd web && npx tsc --noEmit && npm run build` (frontend) pass
- [ ] New migrations applied twice with `npm run db:migra` (and `db:migra:aws` for AWS)
- [ ] If a prompt, schema, tool or model changes: measured with `valuta` / `valuta-agente`, numbers in the CHANGELOG
- [ ] `version` updated in `package.json` **and** `web/package.json`
- [ ] New section in CHANGELOG.md (in English)
- [ ] README updated if commands, architecture or numbers change
- [ ] Message `vX.Y.Z — Title` (in English) and, after the commit, `git tag -a vX.Y.Z`
- [ ] No files from `photos/`, `data/`, `.env` in the commit
