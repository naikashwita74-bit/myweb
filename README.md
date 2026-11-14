# LedgerFlow — Personal Expense Tracker

A modular expense tracker with an **AI Expense Analyzer** that surfaces spending
patterns, anomalies and savings opportunities.

The repository contains two halves that deploy together as one Vercel project:

| Piece | Location | Stack | Role |
|---|---|---|---|
| `app` | repo root | HTML5 + CSS3 + Vanilla ES modules (Vite) | Frontend UI |
| `backend` | `backend/` | Node.js + Express 5 + better-sqlite3 | REST API, SQLite persistence, AI analyzer |

---

## Features

- **Dashboard** — balances, monthly spending, category breakdown, recent activity
- **Transactions** — add/edit/delete, search, filter, sort, CSV export
- **Analytics** — income vs expenses, savings rate, category share (Chart.js)
- **Budget** — monthly limits with 80% warning and exceeded-budget alerts
- **AI Expense Analyzer** — narrative summary, health score, key insights,
  anomaly flags, prioritised recommendations, and a free-form question box

---

## Local development

### Option A — one process (frontend + API on :3000)

```bash
npm start                 # runs backend/src/server.js
# open http://localhost:3000/#ai
```

### Option B — two processes (Vite dev server + API)

```bash
npm run dev:server        # API + static frontend on :3000
npm run dev               # Vite dev server on :5173 (proxies /api -> :3000)
# open http://localhost:5173/#ai
```

### Backend only

```bash
cd backend
npm install
npm run dev               # nodemon
npm test                  # 48 assertions: controllers + AI analyzer
```

### Environment variables

`backend/.env` (copy from `backend/.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Express port |
| `DATABASE_PATH` | `database/expense-tracker.db` | SQLite file location |
| `GEMINI_API_KEY` | _(empty)_ | Enables AI-written insights via Google Gemini |
| `AI_MODEL` | `gemini-flash-latest` | Gemini model id |
| `AI_INCLUDE_DESCRIPTIONS` | `false` | Set `true` to send transaction descriptions to the AI provider |

> Without `GEMINI_API_KEY` the analyzer runs in **built-in analysis mode**: a
> deterministic engine derives the same figures locally and the UI says so.

---

## Deploying to Vercel (multi-service project)

`vercel.json` declares two services in a single project:

```json
{
  "services": {
    "app":     { "root": ".",      "framework": "vite",   "buildCommand": "vite build", "outputDirectory": "dist" },
    "backend": { "root": "backend", "framework": "express", "entrypoint": "src/server.js",
                 "bindings": [{ "type": "service", "service": "app", "format": "url", "env": "APP_SERVICE_URL" }] }
  },
  "rewrites": [
    { "source": "/api/(.*)", "destination": { "service": "backend" } },
    { "source": "/(.*)",     "destination": { "service": "app" } }
  ]
}
```

### How requests flow

| Request | Service | Path the service sees |
|---|---|---|
| `GET /` , `GET /js/*`, `GET /assets/*` | `app` | unchanged |
| `GET /api/transactions` | `backend` | `/api/transactions` |
| `POST /api/ai/analyze` | `backend` | `/api/ai/analyze` |

Services receive the **original request path**, so the Express routes that are
already mounted at `/api/...` work unchanged behind the rewrite. The browser
calls the API on the same origin through the `/api/(.*)` rewrite, so the
frontend uses the relative base URL `/api` — no hostnames are hardcoded.

### Binding

`backend` declares a binding to `app`, so Vercel injects the app service's
internal URL into the backend as `APP_SERVICE_URL`. The backend uses it to hand
any non-API request back to the frontend service instead of failing with a 404.

A binding is only injected into **function runtimes at request time**, which is
why it lives on `backend` (a Node function) and not on `app` (a static build,
where browser code cannot read server-side environment variables).

### Deploy

```bash
npx vercel@latest          # first time: link the project
npx vercel@latest --prod
```

Then add the environment variables in **Project → Settings → Environment Variables**
(they are shared by both services):

```
GEMINI_API_KEY = <your key>       # optional: enables AI-written insights
AI_MODEL = gemini-flash-latest    # optional
AI_INCLUDE_DESCRIPTIONS = false   # optional
```

### Local equivalent

```bash
npx vercel@latest dev --local     # runs both services with bindings injected
```

---

## ⚠️ Storage on Vercel

Vercel function filesystems are **read-only except `/tmp`**, and `/tmp` is wiped
whenever an instance is recycled. The backend therefore:

1. uses `DATABASE_PATH` when it points at a writable location;
2. otherwise falls back to `/tmp/ledgerflow.db` and logs a warning;
3. falls back to `/tmp` even if the configured path cannot be opened.

**Consequence:** on Vercel the ledger is per-instance and ephemeral — data
disappears on cold starts. For production use, point `DATABASE_PATH` at
persistent storage or migrate `backend/src/config/database.js` to a hosted
database (Turso/libSQL, Neon, Vercel Postgres). The rest of the backend only
uses `db.prepare(...)`, so the swap is contained to that one module.

Use the **Reset Sample Data** button in the sidebar to populate a fresh
instance with demo data.

---

## API reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/transactions` | All transactions, newest first |
| `GET` | `/api/transactions/:id` | One transaction |
| `POST` | `/api/transactions` | Create (title, amount, category, type, date, description) |
| `PUT` | `/api/transactions/:id` | Update |
| `DELETE` | `/api/transactions/:id` | Delete |
| `GET` | `/api/budgets/:year/:month` | Monthly budget |
| `POST` | `/api/budgets` | Create monthly budget |
| `PUT` | `/api/budgets/:id` | Update monthly budget |
| `GET` | `/api/ai/status` | AI provider status + recent runs |
| `POST` | `/api/ai/analyze` | Run the analyzer — `{ period, month, refresh }` |
| `POST` | `/api/ai/question` | Ask about spending — `{ question, period, month }` |
| `GET` | `/api/ai/history?limit=8` | Recent analyses |

Responses use `{ success: true, data, meta }` on success and
`{ success: false, error }` on failure.

---

## Project layout

```
.
├── vercel.json              # Vercel multi-service configuration
├── index.html               # App shell
├── css/style.css            # Design system + AI analyzer styles
├── js/
│   ├── app.js               # Router, state, modals, orchestration
│   ├── ai-analyzer.js       # AI Expense Analyzer view
│   ├── dashboard.js         # Dashboard view
│   ├── transactions.js      # Shared constants, validation, table rendering
│   ├── analytics.js         # Analytics view
│   ├── budget.js            # Budget view
│   └── storage.js           # REST client for the backend
├── assets/logo.svg
└── backend/
    ├── src/
    │   ├── server.js                # Express app (Vercel entrypoint)
    │   ├── config/database.js       # SQLite connection (Vercel-aware)
    │   ├── controllers/             # transactions, budgets, ai
    │   ├── routes/                  # transactions, budgets, ai
    │   ├── middleware/errorHandler.js
    │   └── services/
    │       ├── analysisEngine.js    # Deterministic analysis (local fallback)
    │       ├── aiService.js         # Gemini integration
    │       └── analysisStore.js     # SQLite cache for analyses
    ├── database/schema.sql
    ├── test-suite-controllers.js
    └── test-suite-ai.js
```
