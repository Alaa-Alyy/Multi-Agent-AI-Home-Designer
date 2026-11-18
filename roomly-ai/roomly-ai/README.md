# Roomly AI app

The Node.js app. See the [main README](../../README.md) for how it works, the agents, and the free plan limits.

## Quick start

```bash
npm install
cp .env.example .env     # then add CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and optionally SERPAPI_API_KEY
npm start                # http://localhost:3000
```

## Commands

| Command | What it does |
|---|---|
| `npm start` | Runs the web app and API |
| `npm test` | Offline tests (no keys, no internet) |
| `npm run smoke` | Full live run with the real APIs: photo → conversation → products → image |
| `npm run seed` | Rebuilds the RAG embeddings after editing `src/knowledge/knowledgeBase.json` |

## API

| Endpoint | Purpose |
|---|---|
| `POST /api/upload` | Upload the room photo (`image`, `lang`); returns the room analysis and the first question |
| `POST /api/chat` | `{ sessionId, message, lang }`; returns the reply, the brief so far and `readyToDesign` |
| `POST /api/pipeline/start` | `{ sessionId }`; runs RAG, budget, search and ranking, then pauses for the user's choice |
| `POST /api/hitl/confirm` | `{ sessionId, selectedProductIds, lang }`; renders the room and builds the final package |
| `POST /api/image/retry` | `{ sessionId }`; retries only the image (e.g. after the daily limit resets) |
| `GET /api/session/:id` | Everything stored for a session |
| `GET /api/health` | Which keys are configured and which stores are searched |
| `POST /api/nodes/*` | Single-agent endpoints used by the n8n workflows |

## n8n

Import the files in `n8n-workflows/` starting with `01_roomly_master_orchestrator.json`, and point the HTTP nodes at `http://localhost:3000` (or your deployment URL). Every AI call goes through the app, so n8n needs no AI credentials.
