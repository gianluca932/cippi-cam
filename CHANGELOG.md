# Changelog

All notable changes to Cippi Cam, newest first.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/). Each version is one commit tagged `vX.Y.Z`; for the versions up to 0.10.0, reconstructed afterwards, the hash is also given in brackets. Commit and tag messages before 0.18.0 are in Italian.

The **Measured** sections report the results of `npm run valuta`, `npm run valuta-agente` and `npm run confronta-embedding` at the time of the change.

---

## [0.18.1] — 2026-10-16 · The first page shows the latest day with photos

### Fixed
- **The first page was empty online**: it only showed today's photos, and the diary on AWS stops at 14 October. Now, if there are no photos today, it shows the latest day that has some, titled "Latest day · Wednesday 14 October". The dates in the database stay the real ones (changing them would also break the agent evaluation, whose questions name 14 October).
- `useApi` accepts `null` as the path ("not yet"), so the page asks for the photos only once it knows which day.

## [0.18.0] — 2026-10-16 · English interface, docs and agent answers

### Added
- **The agent answers in the language of the question** (Italian or English). The language is decided **in code** ([src/agente/lingua.ts](src/agente/lingua.ts)) by counting common words, and passed through the agent context to the system prompt: "answer in English" for English questions, the original Italian rule for Italian ones. The guardrail's fallback answer follows the same language.
- [eval/agente-en.json](eval/agente-en.json): the 14 agent questions in English, with English regexes. `valuta-agente --file …` picks the file; the LangSmith dataset is named after it (`cippi-cam-agente-en`).
- Interface labels for the Italian values of the API (`nomeAzione`, `nomeLivello` in [web/src/api.ts](web/src/api.ts)): *eating, resting, preening, refill, not seen…*. The database keeps the schema values.

### Changed
- **Interface in English**: navigation, pages, gallery, chat, Live page, Configuration; dates and times in `en-GB` ("Wednesday 14 October", "16:43"); `<html lang="en">`.
- **Chat suggestions point to the latest day with photos**: "today" if it's today, otherwise the date. Online the diary stops at 14 October, and "today" questions found an empty day.
- **Credits** updated: both birds and the current stack (AWS, Bedrock, MCP, LangSmith).
- Guardrail messages shown in the chat trace are in English.
- **README, CHANGELOG and CLAUDE.md in English**, for the people coming from the demo video. The README gained a glossary of the Italian names in the code; CLAUDE.md now states the language split (chat with the user in Italian; UI and docs in English; code, prompts and data in Italian) and that commit messages are in English from this version on.

### Measured
`npm run valuta-agente`, Qwen3 235B on Bedrock, diary on RDS (right tools · right answers):

| | Italian (14) | English (14) |
|---|---|---|
| before (0.17.0, "rispondi in italiano") | 14 · 12 | — |
| "answer in the language of the question" in the prompt | 14 · 12 | 14 · 12 |
| same, with the rule made more emphatic | 14 · 13 | 14 · **11** |
| **language decided in code** | 14 · **13** | 13 · **14** |

- With the rule only in the prompt, English questions about a day with no data got answers **in Italian** (1, then 2 of 14): the prompt and the tool data are in Italian, and with little to say the model slipped back. Making the rule more emphatic made it worse. Deciding the language in code fixed it: 14/14 English answers, all in English.
- The Italian prompt for Italian questions is identical to 0.17.0; 12 vs 13 is the model's variance on the "late afternoon" question.
- The English ❌ on tools: "while Cippi was eating, what was Sky doing?" used `eventi_del_giorno` twice instead of `momenti_insieme`, and answered correctly by crossing the times itself. The dataset is not changed after the fact.

### Known issues
- The model's free-text descriptions (scene, posture, notes) stay in Italian: they come from the vision prompt, which wasn't changed.
- Still open from 0.17.0: `stato_gabbia` with a time after the last check, and `momenti_insieme` without a "when one bird does X" filter.

## [0.17.0] — 2026-10-16 · LangSmith: agent traces and valuta-agente

### Added
- **Traces on LangSmith** (project `cippi-cam`): with `LANGSMITH_TRACING=true` in `.env`, LangChain and LangGraph send every agent run with model calls, tools, arguments, results, tokens and timings. No code needed, just configuration.
- **`npm run valuta-agente`** ([src/comandi/valuta-agente.ts](src/comandi/valuta-agente.ts)): `valuta` for the chat, as golden rule no. 2 requires. The 14 questions live in [eval/agente.json](eval/agente.json), versioned in git: counts, cage, moments together, exact moments, search by meaning and two trick questions about a day with no data. The command syncs them into the `cippi-cam-agente` dataset (recreated only if the file changes) and creates an experiment on LangSmith.
- **Evaluators in code**: `tool_giusti` (were the expected tools called? `a|b` = either one) and `risposta_giusta` (regular expressions the answer must and must not contain). Deterministic and free; an LLM judge can be added later for what regexes can't see.
- `langsmith` as a direct dependency.

### Changed
- **Photos don't end up in the traces**: vision calls on Bedrock pass their own tracer ([src/modelli/tracce.ts](src/modelli/tracce.ts)) that replaces base64 images with `[immagine]`. LangChain adds the environment tracer only if the call doesn't already have one. On Ollama the vision call doesn't go through LangChain and isn't traced.

### Measured
- First experiment, Qwen3 235B on Bedrock, diary on RDS: **right tools 14/14, right answers 12/14**, 1–3 s per question. The three questions that failed before 0.14.0 (water and food low together, playing together, "at 16:26") now pass.
- The two wrong answers come from two **tools**, not from the model:
  - "when did the water need a refill in the late afternoon?": the model asks `stato_gabbia` for 18:00 and 20:00, and the tool answers with the last check (16:43) **without saying there's no data after it**. The model then writes "at 18:00 it was ok", which is made up.
  - "while Cippi was eating, what was Sky doing?": `momenti_insieme` with `azione` means "both are doing it", so the result is empty. A "when **one** bird does X" filter is missing.
- Vision traces without photos: checked on LangSmith (1,800–4,600 characters per call, `[immagine]` instead of base64). Predictions don't change: the change only touches tracing (tried on one photo with `valuta --foto`).

### Known issues
- LangSmith's "agent" destination (`LANGSMITH_AGENT_ID` / `LANGSMITH_AGENT_ENVIRONMENT`) doesn't work with LangChain: `@langchain/core` 1.2.17 always sends runs to a project, and both destinations together raise an error. `LANGSMITH_PROJECT` is used instead.
- For some cage checks `stato_gabbia` returns `cibo: null`: to be understood together with the tool fix.
- The expected answers in `eval/agente.json` hold for the diary on RDS: local Postgres has different analyses (qwen3.5:9b).
- Tracing is not active on the chat Lambda yet.

## [0.16.0] — 2026-10-15 · Remote MCP on AWS with a private link

### Added
- **Remote MCP** (Streamable HTTP) on the `/api/mcp/<token>` route of the API Lambda, for claude.ai custom connectors (web and phone). *Stateless*: on Lambda each request can land on a different instance, so no sessions, and server and transport are created per request. JSON responses instead of SSE, because the tools answer in one go.
- **Private link** as protection, a demo choice: a 40-character token generated by Terraform (`random_password.mcp`, output `mcp_url`) sits in the URL. The route skips Basic Auth (connectors don't send it), compares the token in constant time and answers 404 to a wrong one. The tools are read-only. To revoke it: `terraform apply -replace=random_password.mcp`.
- `npm run mcp:prova -- --url URL`: the same test client, over HTTP.
- Locally the remote MCP is switched on with `MCP_TOKEN` in `.env`.

### Changed
- Creating the MCP server moved to [src/server/mcp.ts](src/server/mcp.ts), used by both stdio ([src/comandi/mcp.ts](src/comandi/mcp.ts)) and HTTP ([app.ts](src/server/app.ts)).

### Measured
- On AWS: wrong token → 404; API and site without password → 401; with the right link `tools/list` returns the 5 tools, and `conta_eventi`, `stato_gabbia` and `cerca_momenti` (which calls Titan from the Lambda) answer with RDS data. Full test client in ~4.6 s, cold start included.

### Known issues
- The link is the only protection: whoever has it can read the diary and trigger searches on Bedrock (fractions of a cent each). Beyond a demo it would need OAuth, MCP's intended authentication.

## [0.15.0] — 2026-10-15 · MCP server with the diary tools

### Added
- **MCP server** ([src/comandi/mcp.ts](src/comandi/mcp.ts)): the agent's five tools exposed through the Model Context Protocol over stdio, usable from Claude Desktop, Claude Code or any MCP client. LangChain tools already have a name, a description and a Zod schema: the server registers them in a loop, so a change to a tool applies to both the chat and MCP. All marked `readOnlyHint`; errors go back to the model as text.
- [src/comandi/mcp-avvio.ts](src/comandi/mcp-avvio.ts), imported first: sends logs to stderr (stdout is the protocol channel, one log line would break the JSON-RPC) and moves the working directory to the project root, because the client starts it from anywhere.
- `npm run mcp:prova` ([src/comandi/mcp-prova.ts](src/comandi/mcp-prova.ts)): a minimal MCP client that starts the server, asks `tools/list` and calls two tools. With `DB_PROVIDER=rds` it works on the diary on AWS.
- [.mcp.json](.mcp.json): Claude Code finds the server by itself when opening the project. The README has the Claude Desktop configuration, including the diary on AWS.

### Measured
- Protocol tests, not model tests: `tools/list` returns the 5 tools, and `conta_eventi`, `stato_gabbia` and `momenti_insieme` give the same summaries as the chat, on both local Postgres and RDS. The server also answers when started from `/` with an empty environment, as Claude Desktop does.

### Known issues
- The server runs on the Mac (stdio): it can't be used from claude.ai on the web. That needs a remote MCP over HTTP (next version).
- The tools treat "today" as the current date: the diary on AWS only has 14 October, so questions need to state the date.

## [0.14.0] — 2026-10-15 · Online on AWS with Terraform, Qwen on Bedrock and an agent that knows when

### Added
- **AWS infrastructure in Terraform** ([infra/](infra/), region `eu-south-1`), state on S3. The pipeline: the Mac uploads JPGs to S3 (`npm run carica`) → notification → SQS (3 attempts, then a dead letter queue for 14 days) → `analizza-foto` Lambda → Bedrock → RDS. The site: CloudFront in front of S3 (frontend) and of a Lambda with a Function URL and response streaming (API, the same `app.ts` as the local server).
- **[src/server/app.ts](src/server/app.ts)**: the routes shared by the local server and the Lambda; the local server only adds the Live page. **[src/aws/](src/aws/)**: the two handlers. **[src/foto/s3.ts](src/foto/s3.ts)**: keys and metadata (the capture time travels as object metadata).
- **`DB_PROVIDER=pg|rds`** in [src/db/connessione.ts](src/db/connessione.ts): on RDS the `diario` user logs in without a password, with a signed IAM token over SSL, verifying the RDS certificate ([config/rds-ca-eu-south-1.pem](config/rds-ca-eu-south-1.pem)). The queries in `db.ts` don't change.
- Commands: `carica`, `build:lambda` (esbuild), `db:migra:aws` (schema, migrations, birds and the `diario` user, with the master password read from Secrets Manager), `deploy:web`, `copia-correzioni` (gallery corrections from local Postgres to RDS, matched by path and bird, with embeddings recomputed).
- **Password on the whole site**, checked by a CloudFront Function. With the password only on the API, the browser didn't show the login prompt (it doesn't for `fetch`) and the page saw the API as "offline". The API also checks it on its own.
- **Agent: the "when"** ([src/agente/episodi.ts](src/agente/episodi.ts), [strumenti.ts](src/agente/strumenti.ts)). The agent said water and food were never missing together (both were low from 16:23 to 16:30) and answered "did they play together?" once yes and once no. The problem was the tools, which had no times:
  - `stato_gabbia` and `eventi_del_giorno` return precomputed intervals (`acqua_scarsa`, `cibo_scarso`, `acqua_e_cibo_scarsi_insieme`) and, with `ora`, what the cage was like at that moment;
  - new tool `momenti_insieme`: the overlaps of the two birds' episodes, computed by the code.

### Changed
- **Bedrock models chosen by measuring** (see Measured): Qwen3-VL 235B for vision, Qwen3 235B for the chat (calls tools through Converse), Titan Text Embeddings v2 at 1024 dimensions.
- **Database: RDS Postgres `db.t4g.micro` instead of Aurora Serverless v2 + Data API.** On the AWS free plan Aurora can only be created in "express configuration", which the Terraform provider (6.69) doesn't support; the free plan also limits backups to 1 day. RDS is public on 5432 because the Lambdas live outside the VPC (inside they'd need a NAT, ~35 $/month); getting in requires SSL and the IAM token. Fixed cost: ~3.6 $/month for the public IPv4.
- Lambda zips go through S3: with a direct upload the provider failed with `bufio.Scanner: token too long`.
- Vision prompt: removed the posture example "head turned, beak in the wing feathers", which the model copied (see Known issues).

### Fixed
- **The `analizza-foto` Lambda didn't start**: esbuild inlined CLIP's dynamic `import()` and its (external) import ended up at the top of `index.mjs`. With `splitting` it stays a separate file; the main file goes from 2.4 to 0.4 MB.
- The API answered 500 instead of 401 without a password: `onError` was registered twice and also turned Hono's `HTTPException`s into errors.
- On RDS the `uccellini` table was empty (locally the server fills it at start-up) and every event failed on the foreign key: `db:migra:aws` now fills it.
- `db:migra:aws` created `embedding_testo` with 768 dimensions if `LLM_PROVIDER=bedrock` was missing from the shell: the script now sets it and, on an empty table, the column fixes itself.

### Measured
`npm run valuta` on the 57 labelled photos, same prompt, models on Bedrock:

| | qwen3.5:9b local (0.13.0) | **Qwen3-VL 235B** | Nova 2 Lite |
|---|---|---|---|
| actions (101) | 66 (65%) | **57 (56%)** | 51 (50%) |
| water (36) | 15/27 (56%) | 14 (39%) | 14 (39%) |
| food (31) | 28 (90%) | **29 (94%)** | 23 (74%) |
| time per photo | ~40 s | ~4 s | ~3 s |

- Qwen3-VL: the most common error is "eating" where the label says "resting" (19 of 44), probably because the bird is next to the feeder. Nova 2 Lite sees birds that the label marks as not visible (19 times) and says "ok" when the food needs a refill (7 of 8).
- Water: almost symmetric errors with both models, i.e. they're guessing. It looks like a framing limit more than a model limit.
- Online, `valuta --salvate` with the copied corrections: actions 56/101 (55%), consistent with the measurement above.
- Claude Haiku 4.5 not measured: Bedrock blocks it until the Anthropic use-case form is filled in.

### Known issues
- **The comparison with the local model isn't fully like for like**: compared with the 0.13.0 measurement, the prompt lost the posture example, and the water labels went from 27 to 36. A `valuta` of `qwen3.5:9b` with the current prompt is missing.
- **The agent changes haven't been measured with `npm run chiedi` yet**, neither locally nor with Qwen3 235B on Bedrock. (Done in 0.17.0 with `valuta-agente`.)
- On AWS the cage check runs every 20 minutes as locally: photos uploaded in bulk get few checks, so water and food show on few photos.
- The AWS SDK warns it won't support Node 20 from 2027: the Lambdas are already on Node 22, the Mac needs upgrading.

## [0.13.0] — 2026-10-14 · Separate prompt for the cage, CLIP and classifier experiments

### Added
- **A prompt just for the cage** (`classifyGabbia` in [src/modelli/modelli.ts](src/modelli/modelli.ts), schema `AnalisiGabbia`). A food rule in the single prompt had made the actions worse (17/21 → 12/21): the cage rules now live in a separate prompt, and the actions prompt no longer mentions the cage.
  - food: "da_rifornire" (needs refill) if **even one** of the two feeders is empty or nearly so;
  - water: "da_rifornire" only if the bottle has **less than 1/5** left or is empty.
- **Timed cage check** ([src/foto/importazione.ts](src/foto/importazione.ts)): levels don't change in a minute, so the second prompt (~16 s) runs every `GABBIA_OGNI_MIN` minutes (20) and, if the last check said "da_rifornire", again after `GABBIA_RICONTROLLO_MIN` (5): a future alert will only fire on a confirmed problem. It uses the capture time, so it also works when importing old photos. Applies to `importa` and the Live page; `classify` always checks.
- Migration 006: `acqua` and `cibo` can be `NULL` (photos without a check), partial index on the checks.
- **Experiments** (read-only, on the stored CLIP fingerprints):
  - `npm run clip-zero-shot` (`-- --gabbia`): classifying with English sentences, without training;
  - `npm run classificatore` (`-- --blocco N`): hand-written k-NN and logistic regression, trained on the gallery labels, with leave-one-out and leave-one-block-out.

### Changed
- `classify` has the same look as `importa` (one line per phase with a spinner, summary, details); summary and phase names in [src/foto/pipeline.ts](src/foto/pipeline.ts), shared.
- `importa` shows "cage not checked" on the photos skipped by the timer.
- `valuta` uses the two prompts separately: an error on one doesn't count against the other.
- Gallery: cage pills and the "Cage" row only on checked photos.
- Agent: `stato_gabbia` talks about checks and gives the time of the last one.

### Measured
`npm run valuta` (re-classifying, new webcam), recounted with the labels corrected after the measurement:

| | before (saved predictions, single prompt) | after (re-classifying, two prompts) |
|---|---|---|
| actions | 82/101 (81%) | 66/101 (65%) |
| water | 22/27 (81%) | 15/27 (56%) |
| food | 23/31 (74%) | **28/31 (90%)** |

⚠️ The "before" isn't a like-for-like measurement: they are saved predictions, produced by different prompt versions, and labelled starting from them (confirmations tend to side with the model). A `valuta` of the single prompt on the same photos is missing to know how much of the drop in actions is real.

Experiments:
- CLIP zero-shot: actions 28% (at least one of the two birds was doing that action); water 73% vs 69% always answering the most frequent class; food 35% vs 68%. CLIP on the whole photo sees neither gestures nor levels.
- Classifiers on CLIP: food 84% with leave-one-out, but 52–55% leaving out the photos within ±10 min and 19–32% within ±20 min. Consecutive photos are almost identical: the plain leave-one-out was inflated (temporal data leakage).

### Known issues
- Actions: the main error is still **preening instead of resting** (×12). In the posture the model often writes "beak in the wing feathers", which is the prompt's example: it's copying it, it needs removing and re-measuring.
- Water: wrong in both directions (refill instead of ok ×5, ok instead of refill ×3, not visible ×4): the transparent bottle is hard to read from the webcam; the 1/5 rule didn't help.

---

## [0.12.1] — 2026-10-14 · Code split into folders

### Changed
- `src/` split by job: `comandi/` (one file per `npm run …`), `server/`, `foto/`, `modelli/`, `agente/`, `db/`, `comune/`. Moves only (with `git mv`, file history is kept): no logic changed, the `npm run …` commands are the same.
- Imports recomputed automatically (69), paths to `config/` and `eval/`, scripts in `package.json`, frontend types, README and CLAUDE.md updated.

---

## [0.12.0] — 2026-10-14 · Image search, water and food corrections, new webcam

### Added
- **CLIP fingerprints of the photos** ([src/modelli/immagini.ts](src/modelli/immagini.ts)): `Xenova/clip-vit-base-patch32` from Hugging Face with transformers.js, in Node on the CPU, without Ollama. 512 numbers per photo in ~30 ms, in the `embedding_immagine` column that existed since the first schema.
  - computed automatically on every import; `npm run embedding-immagini` for existing photos;
  - migration 003: HNSW index;
  - `npm run cerca -- --immagini "…"` (text → photo search, in English) and `--simili <id>` (similar photos).
- **Water and food corrections in the gallery**: a "Cage" row with two pills; ✓ confirms, ↺ undoes. Migration 004: `acqua_umana`, `cibo_umano`, view `foto_effettive`; `PATCH /api/foto/:id/gabbia`. The model's value is never overwritten.
- **`valuta` also measures the cage**, both on saved predictions (`--salvate`) and re-classifying.
- **`importa` with visual progress**: bar, time estimate, one line per phase (conversion, vision, embedding, saving, fingerprint) with spinner and timings, per-photo summary. No libraries ([src/comune/terminale.ts](src/comune/terminale.ts)); without a terminal, plain lines.

### Changed
- **Cage levels reduced** to a decision: water and food `ok` / `da_rifornire` / `non_visibile` (previously 5 levels). "da_rifornire" includes "running out": the alert must come before it's empty. Migration 005 converts the stored values.
- **Cage cleanliness removed** from schema, prompt, agent and interface: it couldn't be judged from the photos. The database columns stay.
- **New USB webcam**, close to the cage; photos and diary restarted from scratch (previous day's backup in `data/archivio/`).

### Fixed
- `valuta` crashed on photos that were labelled but archived: it now skips them with a warning.

### Measured
| | Result |
|---|---|
| **Actions**, saved predictions, new webcam (101 labels) | **82/101 = 81%** (yesterday, far webcam: 57%) · eating 14/14 · preening 6/6 · resting 34/43 · playing 5/10 |
| **Water** (25 labels) | **20/25 = 80%** |
| **Food** (29 labels) | **21/29 = 72%**: 8 errors, all missed "needs refill" |
| Experiment: two-feeders rule in the prompt (14 photos) | food 6/14 → **11/14**, but **actions 17/21 → 12/21** → **discarded** |
| CLIP | ~30 ms per photo · "a yellow budgie with ruffled feathers preening" finds first the photo where Cippi is preening |

### Known issues
- **Food**: for the user it's "needs refill" if even one of the two feeders is empty; the model looks at the whole. The rule in the single prompt makes the actions worse: to be solved with a separate cage prompt (every 15–30 minutes) or a classifier on fixed crops of the feeders.
- **The USB webcam gets darker after a while** (in Photo Booth too) and only recovers by unplugging it; exposure can't be adjusted (CameraController has no effect). Fine for short sessions.
- The labels were given while looking at the model's predictions: a possible "anchoring" effect that inflates accuracy a bit.
- After the change to the `stato_gabbia` tool the agent wasn't re-tested with `npm run chiedi`.

---

## [0.11.0] — 2026-10-14 · Agent on LangChain/LangGraph and provider via env

### Added
- **Agent on LangChain + LangGraph** ([src/agente/](src/agente/)): `createAgent` builds the model ↔ tool graph instead of a hand-written `for` loop.
  - `strumenti.ts`: the 4 tools with `tool()` and Zod schemas (the equivalent of Python's `@tool`);
  - `middleware.ts`: the rules as middleware. `promptDelGiorno` (system prompt with the date, on every call), `guardrailRisposteInventate` (`wrapModelCall`: answer with numbers but no tool → same call with the "reasoning" model), `argomentiPuliti` (`wrapToolCall`: drops `""` and `null`, errors returned to the model);
  - `index.ts`: the LangGraph stream with `streamMode: ["messages", "updates"]` translated into chat events. The signature of `chiediAllAgente` doesn't change: server and chat don't notice.
- **Model factory** ([src/modelli/llm.ts](src/modelli/llm.ts)): `LLM_PROVIDER=ollama|bedrock` picks the provider for agent, vision and embeddings (`ChatOllama`/`ChatBedrockConverse`, `OllamaEmbeddings`/`BedrockEmbeddings`). For Bedrock the models must be given: if a variable is missing, a clear error.
- **Configuration from `.env`** ([src/comune/env.ts](src/comune/env.ts), [.env.example](.env.example)), loaded with `process.loadEnvFile()` without libraries.
- **Embedding check** (`controllaEmbedding`): at server and import start-up it compares the model's dimensions with the `embedding_testo` column, and stops with a clear message if a migration is needed.
- The chat trace now also shows the **reasoning** (🧠) when the guardrail retries.

### Changed
- `src/ollama.ts` became [src/modelli/modelli.ts](src/modelli/modelli.ts): no more direct Ollama calls for chat and embeddings.
- **Vision on Ollama with a native call** (one text + image message), on Bedrock with `withStructuredOutput`.

### Measured
| | Before | After |
|---|---|---|
| Agent, 8 questions | tools, arguments and answers | **identical**; guardrail on the same 2 questions; same timings (8–30 s) |
| Vision, previous code (one message), 31 photos · 60 labels | **57%** (34/60) | — |
| Vision via `@langchain/ollama` (two messages), same 32 labels | 15/32 | **8/32** → discarded for Ollama |

### Known issues
- `@langchain/ollama` 1.3.0 splits text and image into two Ollama messages (`convertHumanGenericMessagesToOllama`). No report found: a candidate for an upstream issue.
- The AWS SDK warns that versions published from January 2027 will require Node 22.
- New USB webcam ("CAMERA - UAC"): automatic exposure can't be adjusted (CameraController has no effect) and some photos come out dark.

---

## [0.10.1] — 2026-10-13 · Changelog, CLAUDE.md and versioning

### Added
- **CHANGELOG.md**: the project history reconstructed from the commits, with the numbers of every experiment (**Measured**) and the **Known issues**.
- **CLAUDE.md**: the rules for working on the repo with Claude Code. Versioning, environment, architecture, rules on prompts and models, Node and React best practices, evaluation, pre-commit checklist.
- **Git tags** `v0.1.0` … `v0.10.0` on the existing commits, and from here on one tag per commit.

### Changed
- `version` in `package.json` and `web/package.json` aligned with the changelog (it had stayed at `0.1.0`).

---

## [0.10.0] — 2026-10-13 · README and one-command start-up (`cf18cf4`)

### Added
- **Full README**: architecture with Mermaid diagrams, the technical choices, the evaluation numbers, the lessons learned and the roadmap to AWS.
- **`npm run dev`** ([scripts/dev.mjs](scripts/dev.mjs)): starts Postgres if it's off, runs API and interface with prefixed output (`[api]`, `[web]`); Ctrl+C stops everything, children included. Plain Node, no dependencies.
- **`npm run valuta -- --foto NAME`**: evaluates only the given photos, to try a prompt change in seconds.

---

## [0.9.0] — 2026-10-13 · Live page and more concrete descriptions (`d2744f6`)

### Added
- **Live page**:
  - live webcam video in the browser (`getUserMedia`), with a LIVE badge, clock and camera choice;
  - **Start / Stop recording**: the server takes a photo every N seconds and analyses each one **in a queue**, one at a time. Capturing never waits for the analysis;
  - photos and status (REC, duration, photos, analysed, queued) updated in real time via SSE with `EventSource`;
  - each photo shows "queued" → "the model is looking…" → the result.
- `POST /api/registrazione/avvia` and `/ferma`, with options validated by Zod; `GET /api/scatti`, `/api/scatti/:nome/immagine`, `/api/scatti/stream`.
- New fields in the analysis: **`con_cosa`** (the object the bird interacts with) and the cage's **`pulizia`** (cleanliness).
- **Migration 002**: `con_cosa` and `pulizia` columns, index on `con_cosa`.
- The agent reports the objects in the episodes and the cleanliness in the cage status.
- In the gallery: "with bell" under the action, a 🧹 chip if the cage is dirty, full details in the large photo.

### Changed
- **Length limits** (`.max()`) on every text field of the schema: they end up in Ollama's grammar, so the model can't exceed them.
- Shorter, more concrete instructions for each field in the prompt.
- Shared code extracted into [src/foto/webcam.ts](src/foto/webcam.ts) (finding the camera, taking a photo) and [src/foto/importazione.ts](src/foto/importazione.ts) (importing a photo): used by `scatta`, `importa` and the recording.

### Fixed
- Migrations now do `DROP VIEW` + `CREATE VIEW`: before, re-running 001 after 002 failed ("cannot drop columns from a view").

### Measured
| | Before | After |
|---|---|---|
| Accuracy (12 photos, 24 labels) | 63% | **38%** |
| Tokens generated per photo | 424 | 363 (−14%) |

### Known issues
- **The accuracy drop comes from the examples in the prompt**: "beak in the wing feathers", given as a posture example, is copied by the model and pushes it towards "preening" or "sleeping". To be fixed by removing suggestive examples.
- The recording state lives in the server process: if the server restarts (watch mode included), the recording stops.

---

## [0.8.0] — 2026-10-13 · Corrections from the gallery, new cards and header (`a0915ec`)

### Added
- **Human-in-the-loop corrections**: for each bird a menu to correct the action, ✓ to confirm, ↺ to undo. Optimistic update: the card changes immediately and rolls back if saving fails.
- **Migration 001**: `azione_umana` and `controllato_il` columns. The model's prediction is never overwritten.
- **View `eventi_effettivi`**: the human action if there is one, otherwise the model's. Gallery, archive and agent all read from here.
- `PATCH /api/eventi/:id` and `DELETE /api/eventi/:id/correzione`, which **recompute the embedding** (its text contains the action).
- `npm run db:migra` to apply the migrations.
- `npm run valuta` also uses the gallery labels; **`--salvate`** shows the confusion matrix of the saved predictions, per-action accuracy and high vs low confidence, without calling the model.
- **Green and red tags on the photo**: green if the model was right, red if you corrected it.
- **Large photo** on click, in a native `<dialog>` (Esc, click outside, ✕).

### Changed
- **Gallery cards redesigned**: soft shadow, time and water/food levels as chips on the photo, coloured avatar with the initial, action as a chip with a menu, confidence bar, coloured row after review, "N/M reviewed" bar.
- **"Corporate" header**: full-width sticky bar, SVG logo (also as favicon), tab navigation, API status indicator, Inter font.

---

## [0.7.0] — 2026-10-13 · Streaming chat (`e4bd058`)

### Added
- **`POST /api/chat/stream`** with Server-Sent Events: reasoning, tools and answer reach the browser as they happen.
- Agent call with `stream: true` to Ollama (NDJSON, one chunk per token).
- In the chat: **"Thinking…"** pulsing together with the trace, disappearing when the first word of the answer arrives.

### Changed
- The answer is streamed **only after a tool has been used**. An answer without tools is held back until the guardrail has checked it, so a made-up answer never shows up.
- On the React side every event goes through a pure reducer inside a functional `setState`: safe even with StrictMode's double invocation.

---

## [0.6.0] — 2026-10-13 · Agent trace (`59aea4e`)

### Added
- The agent returns the **trace** of its steps: 🧠 reasoning (when present), 🔧 tools with arguments, ↳ shortened result, 🛡️ guardrail interventions.
- The chat shows it in grey above the answer; `npm run chiedi` prints it in the terminal.

---

## [0.5.0] — 2026-10-13 · The chat agent (`d14da93`)

### Added
- **Agent with 4 tools**: `eventi_del_giorno`, `conta_eventi`, `cerca_momenti` (pgvector + SQL filters: hybrid search), `stato_gabbia`.
- **Tool arguments validated with Zod** before touching the database; `""` and `null` are treated as "not given".
- **Episodes** ([src/agente/episodi.ts](src/agente/episodi.ts)): consecutive events with the same action become one episode.
- **Guardrail**: an answer with numbers but no tool call is discarded and the question repeated with reasoning on; if it fails again, the agent says it couldn't look up the diary.
- Web chat with conversation history (follow-up questions like "and Sky?").
- `npm run chiedi` to ask the agent from the terminal.
- `npm run importa` accepts single files and `--lista list.txt`.

### Changed
- **Agent on `qwen3.5:9b`** instead of `qwen3:4b`: the latter always reasons (~600 tokens to choose a tool, 45–110 seconds per question). Now a single model in memory does vision and chat.
- The day in the tools is optional, with today as default: the model got the date wrong on questions like "is there enough water?".
- `stato_gabbia` returns a precomputed summary (`ultimo_livello_visto`, photos per level): the small model got it wrong when inferring it from a long list.

### Fixed
- Markdown in the answers is stripped in the interface instead of being forbidden in the prompt: the rule "don't use markdown" had made the agent stop using tools.

---

## [0.4.0] — 2026-10-13 · Webcam and classifier evaluation (`6d01b89`)

### Added
- **`npm run scatta`**: one webcam photo every N seconds with `imagesnap`, the Mac kept awake with `caffeinate`. The camera is chosen by part of its name, handling special spaces (`MacBook Air`).
- **`npm run valuta`**: accuracy of the classifier on hand-labelled photos ([eval/classificazione.json](eval/classificazione.json)), also at different resolutions (`--lato`).
- **Visual cues** in the prompt for each action, based on the position of head and beak.

### Measured
| Configuration | Accuracy (4 labels) |
|---|---|
| `qwen3.5:9b`, 1024px | 1/4 (25%) |
| `qwen3.5:9b`, 1536px | no improvement, slower |
| `qwen3-vl:8b` | worse, ~8× slower (repetition loops, ~4000 tokens) |

---

## [0.3.0] — 2026-10-13 · Import, backend and real data (`466aeb3`)

### Added
- **`npm run importa`**: converts the photos in `photos/` (HEIC from the iPhone too) into 1024px JPGs, reads the **capture time from EXIF** and skips photos already imported.
- **Hono API**: birds, days, photos of the day, images, chat (semantic search only, for now).
- Interface on **real data**: gallery with one event per bird and water/food levels, archive from the database. Mocks removed.
- [eval/ricerca.json](eval/ricerca.json) and **`npm run confronta-embedding`** to compare embedding models.

### Measured
| Embedding model | hit@1 | MRR | Time |
|---|---|---|---|
| **nomic-embed-text** (chosen) | 3/4 | 0.88 | 0.2s |
| bge-m3 | 3/4 | 0.88 | 1.5–7s |
| qwen3-embedding:0.6b | 2/4 | 0.75 | 5.5s |

---

## [0.2.0] — 2026-10-13 · Postgres, pgvector and two birds (`ea1006c`)

### Added
- **Postgres 17 + pgvector** in Docker; tables `uccellini`, `foto`, `eventi`, with `embedding_testo` (HNSW index) and `embedding_immagine` already planned for CLIP.
- **Two birds, Cippi (yellow) and Sky (light blue)**, configurable in [config/uccellini.json](config/uccellini.json).
- **Cage status**: water and food levels, with a warning when low or empty.
- Description embeddings with `nomic-embed-text` and **`npm run cerca`** for semantic search.

### Changed
- The schema produces **one event per bird** instead of one per photo.
- **The model gives the colour, the code assigns the name**: before, it swapped Cippi and Sky even while seeing the colours correctly.
- **Descriptive fields before action and confidence**: with structured output the model "observes" before classifying.

---

## [0.1.0] — 2026-10-13 · First classifier and interface (`a943bc7`)

### Added
- **Classifier** ([src/comandi/classify.ts](src/comandi/classify.ts)): sends the photo to `qwen3.5:9b` in Ollama with structured output (`format` = JSON Schema generated by Zod), validates the answer with Zod and measures the timings (loading, reading the photo, generation).
- Context raised to 8192 tokens: the photo alone took about 4000.
- **React interface** (Vite + React Router) with the Today, Archive, Configuration (local/AWS) and Credits pages, still on mock data.
