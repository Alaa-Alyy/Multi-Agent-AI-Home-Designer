# Roomly AI — AI Room Redecoration Platform

**Roomly AI** is an autonomous AI-native interior redesign platform featuring Vision analysis, RAG interior design knowledge retrieval, deterministic budget allocation, credential-ready multi-provider product search, mandatory Human-in-the-loop (HITL) product selection, realistic OpenAI DALL-E 3 image generation, and synthesized redesign delivery.

---

## 🏗️ Architecture & State Flow

```
INTAKE
  ↓
VISION_ANALYSIS
  ↓
PREFERENCE_ANALYSIS
  ↓
RAG_LOOKUP
  ↓
BUDGET_ALLOCATION
  ↓
PRODUCT_SEARCH
  ↓
RANK_AND_PRESENT
  ↓
USER_SELECTION (HITL Mandatory Pause)
  ↓
IMAGE_GENERATION (OpenAI DALL-E 3)
  ↓
FINAL_RESULT
```

---

## 📂 Project Structure

```
roomly-ai/
├── n8n-workflows/                               # Complete n8n Workflow JSON Exports
│   ├── 01_roomly_master_orchestrator.json       # Master state orchestrator with HITL wait node
│   ├── 02_vision_agent_subworkflow.json         # Vision analysis subworkflow
│   ├── 03_rag_knowledge_base_seeding_and_retrieval.json # RAG & vector retrieval subworkflow
│   ├── 04_budget_allocation_agent.json          # Deterministic budget calculation subworkflow
│   ├── 05_product_search_and_ranking_agent.json # Search provider & ranking subworkflow
│   ├── 06_human_in_the_loop_selection.json      # HITL pause & webhook selection subworkflow
│   ├── 07_image_generation_agent.json           # DALL-E 3 image generation subworkflow
│   ├── 08_final_designer_agent.json             # Final package assembly subworkflow
│   └── 09_price_restock_watcher.json            # Scheduled price/restock monitor
├── src/
│   ├── server.js                                # Express API & n8n webhook bridge
│   ├── orchestrator.js                          # State-machine controlling the 10-step flow
│   ├── agents/
│   │   ├── intakeAgent.js                       # Guided chat & multi-turn intake
│   │   ├── visionAgent.js                       # GPT-4o Vision structured room analyzer
│   │   ├── preferenceAgent.js                   # Preference tracking & deduplication
│   │   ├── ragAgent.js                          # Interior design vector retrieval engine
│   │   ├── budgetAgent.js                       # Deterministic category budget allocator
│   │   ├── searchAgent.js                       # Provider-agnostic search adapter (SerpAPI/Rainforest/RapidAPI)
│   │   ├── rankingAgent.js                      # Multi-criteria product ranking engine
│   │   ├── hitlManager.js                       # Human-in-the-loop pause & resume manager
│   │   ├── imageGenAgent.js                     # OpenAI DALL-E 3 architectural prompt composer
│   │   ├── finalDesigner.js                     # Final redesign package synthesizer
│   │   └── priceWatcher.js                      # Price & inventory watchlist agent
│   ├── knowledge/
│   │   ├── knowledgeBase.json                   # Comprehensive interior design knowledge base
│   │   ├── seedKnowledgeBase.js                 # Seeding & index builder
│   │   └── vectorIndex.json                     # Precomputed semantic vector index
│   └── storage/
│       └── database.js                          # Atomic persistence layer & audit log
├── public/                                      # Interactive Glassmorphic Web App
│   ├── index.html                               # Responsive interface
│   ├── style.css                                # Design system & micro-animations
│   └── app.js                                   # Client-side state & interactive HITL modal
├── tests/
│   └── test-pipeline.js                         # End-to-end automated verification harness
├── .env.example                                 # Environment variable template
└── package.json
```

---

## ⚡ Getting Started

### 1. Install & Seed Knowledge Base
```bash
npm install
npm run seed
```

### 2. Configure Credentials (`.env`)
```env
PORT=3000

# OpenAI API Key (Vision & DALL-E 3 Image Generation)
OPENAI_API_KEY=your_openai_api_key_here

# Product Search Provider Keys (Optional - Search Agent is credential-ready)
SERPAPI_API_KEY=
RAINFOREST_API_KEY=
RAPIDAPI_KEY=
```

### 3. Run the Platform
```bash
npm start
```
Open **`http://localhost:3000`** in your browser to interact with the platform.

### 4. Run Automated Test Verification
```bash
npm run test-pipeline
```

---

## 🚀 Deploy on Render

This repository includes a Render Blueprint at the repository root. It builds the app from `roomly-ai/roomly-ai`, runs it in Docker, and mounts persistent storage at `/var/data` for session data and uploaded images.

1. Commit and push the deployment files to GitHub. Do not commit `.env` or the `data/` runtime directory.
2. In Render, choose **New → Blueprint**, connect this repository, and select a paid web-service plan (persistent disks are not available on Render's free web services).
3. Enter `OPENAI_API_KEY` when Render prompts for secret values. Add a product-search key only if you want live retailer results.
4. Deploy and verify `https://<your-service>.onrender.com/api/health` returns `"status":"HEALTHY"`.

The app works without third-party keys using its built-in fallback analysis and product data, but OpenAI-powered room analysis and image generation require `OPENAI_API_KEY`.

---

## 🔌 n8n Workflow Integration

To use with an existing n8n instance:
1. Open your n8n dashboard (`http://localhost:5678`).
2. Go to **Workflows → Import from File**.
3. Import the files from `n8n-workflows/` starting with `01_roomly_master_orchestrator.json`.
4. Point the webhook / HTTP request nodes to `http://localhost:3000` (or your deployment URL).
