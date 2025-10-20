# LeetCode Assistant

Productivity assistant for LeetCode that lives directly inside the browser. A Chrome extension observes the active problem, syncs structured context to a FastAPI backend, runs retrieval-augmented generation (RAG) with vector search + LLMs, and returns curated guidance in a side panel chat.

---

## ✨ Features

- **In-browser coaching** – context-aware chat panel that understands the LeetCode problem you currently have open.
- **Automatic problem scraping** – DOM + GraphQL scrapers populate description, constraints, and examples with millisecond latency.
- **RAG pipeline** – LangGraph orchestrates pgvector similarity search, Redis caching, and an LLM prompt that returns JSON summaries.
- **Streaming answers + syntax highlighting** – responses arrive token-by-token and render rich Markdown with Prism-powered code blocks.
- **Theme toggle built in** – switch between light and dark modes on the fly; the extension remembers your preference.
- **Modular monorepo** – separate `apps/extension` and `apps/api` packages with shared types and reproducible builds.
- **Developer tooling** – Docker Compose stack, hot-reload Uvicorn server, npm proxy scripts, and detailed setup docs.

---

## 🧱 Architecture

```
├── apps
│   ├── api
│   │   ├── app
│   │   │   ├── api         # FastAPI routers
│   │   │   ├── core        # Settings & logging
│   │   │   ├── db          # SQLAlchemy engine + pgvector models
│   │   │   ├── schemas     # Pydantic request/response models
│   │   │   └── services    # RAG pipeline, caching, embeddings
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   └── .env.example
│   └── extension
│       ├── public
│       ├── src             # React/Tailwind Chrome extension source
│       ├── dist            # Built assets (generated)
│       ├── package.json
│       └── vite.config.ts
├── infra
│   └── docker
│       └── docker-compose.yml
└── package.json            # Root scripts (proxy to extension workspace)
```

---

## 🔑 Tech Stack

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Chrome Extension APIs
- **Backend:** FastAPI, AsyncIO, Pydantic, LangChain, LangGraph, OpenAI API
- **Data Layer:** PostgreSQL 16 (`pgvector`), Redis 7, SQLAlchemy 2.x
- **Infrastructure:** Docker, Docker Compose, uvicorn/gunicorn

---

## 🚀 Quick Start

### 1. Prerequisites

- Node.js 18+
- Docker Desktop (or Docker Engine) + Docker Compose V2
- An OpenAI API key (for both chat + embeddings)

### 2. Clone and install

```bash
git clone https://github.com/<you>/leetcode-assistant.git
cd leetcode-assistant

# Install extension dependencies
npm install --prefix apps/extension
```

### 3. Configure the backend

```bash
cp apps/api/.env.example apps/api/.env
# edit apps/api/.env and set:
# OPENAI_API_KEY=sk-your-secret-key
```

### 4. Run backend services

```bash
docker compose -f infra/docker/docker-compose.yml up -d --build
curl http://localhost:8000/api/v1/health   # → {"status":"healthy"}
```

Services exposed locally:

| Service   | Port | Notes                      |
|-----------|------|----------------------------|
| FastAPI   | 8000 | REST API & docs at `/docs` |
| Postgres  | 5432 | Includes pgvector          |
| Redis     | 6379 | Used for response caching  |

### 5. Build and load the Chrome extension

```bash
npm run build --prefix apps/extension
```

- Open Chrome → `chrome://extensions`
- Enable **Developer mode**
- Click **Load unpacked** and choose `apps/extension/dist/`
- Open the extension’s **Settings** page, confirm the API base URL (`http://localhost:8000/api/v1`), click **Save** and **Test connection**
- Navigate to any LeetCode problem and open the *LeetCode Assistant* side panel

---

## 🛠️ Development Scripts

From repository root:

| Command | Action |
|---------|--------|
| `npm run dev` | Start the Vite dev server for the extension (`apps/extension`) |
| `npm run build` | Type-check + production build of the extension |
| `npm run lint` | ESLint for the extension codebase |
| `python3 -m compileall apps/api/app` | Quick syntax check for backend modules |

Backend container uses live-reload via Uvicorn when `/app/app` changes.

### Tests

- **Backend:** `pytest apps/api/tests`  
- **Extension:** build + lint (no unit tests yet)

### Continuous Integration

GitHub Actions (`.github/workflows/ci.yml`) runs on every push/PR to `main`. The workflow builds the FastAPI service (pip install + `python -m compileall`) and verifies the Chrome extension (`npm ci`, lint, and build). Keep new dependencies declared in `apps/api/requirements.txt` or `apps/extension/package.json` so the pipeline succeeds.

---

## 🧠 RAG Pipeline Overview

1. **Problem ingestion** – extension posts the scraped problem to `/api/v1/documents`.  
2. **Embedding + storage** – FastAPI service chunkifies content, obtains embeddings, and writes vectors to PostgreSQL (`pgvector`).  
3. **Retrieval** – when a chat question arrives, LangGraph queries pgvector for top-k chunks, enriched with metadata.  
4. **LLM response** – LangChain `ChatOpenAI` consumes a structured prompt and returns JSON containing `answer` + `summary`.  
5. **Caching** – Redis stores chat responses keyed by slug + normalized conversation history to avoid repeated LLM calls.

---

## 🧪 API Reference

- `GET /api/v1/health` – readiness probe
- `GET /api/v1/docs` – Swagger UI
- `POST /api/v1/documents` – ingest problem context (handled by extension)
- `POST /api/v1/chat` – accepts `question`, `problem`, and `history`, returns answer + summary + source snippets

---

## 🛡️ Troubleshooting

| Symptom | Fix |
|---------|-----|
| Extension shows “Backend unreachable” | Ensure Docker stack is running and API URL is `http://localhost:8000/api/v1`; click **Test connection** in Settings. |
| “Context sync failed” | The `/documents` endpoint rejected the request. Check logs (`docker compose … logs api`) for authentication or schema errors. |
| “Failed to fetch” after sending a chat | Inspect API logs for 500 errors (often due to invalid JSON shape or missing API key). |
| Permission denied to Docker socket | On macOS, grant Terminal/CLI access to Docker Desktop or rerun with elevated privileges. |

---

## 🗺️ Roadmap Ideas

- Streaming responses for richer UX
- Persistent user chat history
- Multi-user authentication / rate limiting
- LangSmith or OpenTelemetry tracing for prompt evaluation
- Gemini or other provider fallbacks

---

With the backend running and the extension loaded, open any LeetCode problem and launch the side panel—LeetCode Assistant will ingest the context, surface relevant snippets, and deliver actionable guidance tailored to your question. Happy grinding! 🙌
