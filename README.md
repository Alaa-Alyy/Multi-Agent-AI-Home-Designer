# 🏠 Multi-Agent AI Home Design & Renovation Assistant

> An orchestrated multi-agent AI system that transforms a room photo, user preferences, and a fixed EGP budget into a practical, purchase-ready home redesign.

## 📌 Overview

Designing and renovating a room from a photo can be challenging. Users often struggle to visualize how a new design will look, while many AI-generated design proposals fail to consider real-world product availability and local prices.

**Multi-Agent AI Home Design & Renovation Assistant** addresses both challenges by combining:

* 🧠 AI-powered room understanding
* 🎨 Personalized interior design generation
* 💰 Budget-aware planning
* 🛒 Semantic product retrieval from Egyptian catalogs
* 🖼️ Photorealistic room redesign previews
* 🔄 An iterative Design–Budget optimization loop

The system takes a room image, design preferences, and a maximum budget in EGP and produces a complete redesign proposal with recommended products and an itemized budget.

---

## 🎯 Problem & Motivation

### Visual Planning is Difficult

Users often cannot visualize how a redesigned room will look based only on descriptions, furniture choices, and color preferences.

### Budget Realism is Missing

Many design solutions focus on aesthetics without considering actual local product prices. This can result in unrealistic recommendations and unexpected costs.

### Our Goal

Build an integrated AI pipeline that generates:

1. A realistic redesigned room preview
2. A personalized design proposal
3. A detailed budget breakdown
4. Real product recommendations
5. Direct purchase links where available

—all while respecting a fixed Egyptian Pound (**EGP**) budget.

---

# 🚀 Key Features

### 📷 Room Understanding

The Vision Agent analyzes the uploaded room image and extracts:

* Room type
* Existing furniture
* Furniture positions
* Doors and windows
* Fixed architectural elements
* Lighting conditions
* Dominant colors
* Spatial information

The result is converted into a structured room schema that can be consumed by the other agents.

---

### 🎨 AI Interior Design

The Design Agent uses the detected room structure and user preferences to generate a personalized redesign proposal.

Users can specify:

* Interior style
* Preferred colors
* Furniture preferences
* Items to keep
* Items to replace
* Design priorities
* Budget constraints

The Design Agent generates:

* Furniture recommendations
* Decor recommendations
* Placement suggestions
* Color palette
* Lighting plan
* Layout adjustments
* Design priorities

---

### 💰 Budget-Aware Planning

The Budget Agent evaluates the proposed design against real product prices retrieved from the shopping system.

It:

* Calculates estimated costs in EGP
* Identifies expensive items
* Detects budget overruns
* Prioritizes essential items
* Suggests cheaper alternatives
* Provides targeted revision feedback

---

### 🛒 Intelligent Product Retrieval

The Shopping Agent retrieves semantically relevant products from a localized Egyptian catalog.

The catalog can contain:

* Product names
* Product descriptions
* Categories
* Dimensions
* Images
* Prices in EGP
* Product URLs
* Seller information
* Availability information

The system uses:

**Embeddings + PostgreSQL + pgvector**

to perform semantic similarity search rather than relying only on exact keyword matching.

---

# 🤖 Multi-Agent Architecture

The system is built around four specialized AI agents coordinated by a deterministic orchestrator.

```text
                         ┌──────────────────────┐
                         │       User Input     │
                         │                      │
                         │ Room Photo           │
                         │ Preferences          │
                         │ Max Budget (EGP)     │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │   LangGraph          │
                         │   Orchestrator       │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │   Vision Agent       │
                         │                      │
                         │ Room Understanding   │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │   Design Agent       │
                         │                      │
                         │ Personalized Design  │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │   Shopping Agent     │
                         │                      │
                         │ Semantic Retrieval   │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │    Budget Agent      │
                         │                      │
                         │ Cost Evaluation      │
                         └──────────┬───────────┘
                                    │
                         ┌──────────┴───────────┐
                         │                      │
                    Within Budget?          Over Budget
                         │                      │
                         ▼                      ▼
                   Final Result         Targeted Revision
                                                │
                                                └──────► Design Agent
```

---

# 🧩 Agents

## 1. Vision Agent

### Responsibility

Convert the uploaded room image into a structured representation.

### Input

```text
Room Image
```

### Output

```json
{
  "room_type": "living_room",
  "furniture": [],
  "structural_elements": [],
  "lighting": {},
  "color_palette": [],
  "spatial_information": {}
}
```

The Vision Agent provides the structured information required by the downstream design and image-generation pipeline.

---

## 2. Design Agent

### Responsibility

Generate a personalized redesign based on:

* Room schema
* User preferences
* Style
* Colors
* Keep/replace rules
* Budget constraints

### Output

A structured design proposal containing:

* Furniture
* Decor
* Placement
* Colors
* Lighting
* Priorities
* Replacement suggestions

The Design Agent is powered by Llama through Groq for constrained multi-step reasoning and creative design generation.

---

## 3. Shopping Agent

### Responsibility

Map design requirements to real products available in the Egyptian market.

### Retrieval Pipeline

```text
Design Requirement
       │
       ▼
Text Embedding
       │
       ▼
pgvector Similarity Search
       │
       ▼
Candidate Products
       │
       ▼
Ranking
       │
       ▼
Product + Price + Image + URL
```

The Shopping Agent returns ranked product candidates based on semantic similarity and catalog information.

---

## 4. Budget Agent

### Responsibility

Ensure that the generated design is financially feasible.

The Budget Agent:

1. Receives the proposed design
2. Gets product candidates and prices
3. Calculates the total estimated cost
4. Compares it with the user's maximum budget
5. Identifies expensive contributors
6. Generates targeted revision instructions when necessary

---

# 🔄 Core Innovation: Design–Budget Loop

One of the core ideas of the system is the iterative **Design–Budget Loop**.

Instead of generating a design once and simply showing the user an unrealistic price, the system can revise the design when it exceeds the user's budget.

### Example

```text
Design Proposal
      │
      ▼
Product Retrieval
      │
      ▼
Cost Calculation
      │
      ▼
Within Budget?
   ┌──┴──┐
  YES    NO
   │      │
   ▼      ▼
 Final   Identify
 Design  Expensive Items
          │
          ▼
       Targeted
        Revision
          │
          ▼
      Design Agent
          │
          └──────────► Shopping Agent
```

The revision process focuses on minimal changes rather than regenerating the entire design.

Possible revisions include:

* Swap an expensive SKU
* Replace a non-essential item
* Remove unnecessary decor
* Simplify the design
* Postpone lower-priority purchases

This allows the system to preserve the user's main design preferences while adapting the proposal to the available budget.

---

# 🧠 Shared State

All agents communicate through a shared structured state managed by the orchestrator.

A simplified representation is:

```json
{
  "room_schema": {},
  "user_preferences": {},
  "design_proposal": {},
  "product_candidates": [],
  "budget": {
    "max_budget": 0,
    "estimated_total": 0,
    "status": "within_budget"
  },
  "revision_feedback": [],
  "final_result": {}
}
```

This shared state allows each agent to operate independently while maintaining a consistent view of the current design iteration.

---

# 🛍️ Product Catalog

The product retrieval layer is designed around localized Egyptian product data.

Potential catalog sources include:

* IKEA Egypt
* Jumia Egypt

The catalog stores information such as:

| Field       | Description                       |
| ----------- | --------------------------------- |
| SKU         | Product identifier                |
| Name        | Product name                      |
| Category    | Furniture / Lighting / Decor etc. |
| Description | Product description               |
| Dimensions  | Product dimensions                |
| Price       | Current price in EGP              |
| Image       | Product image                     |
| URL         | Direct product link               |
| Embedding   | Semantic representation           |

> Product prices and availability can change over time. The system should treat catalog information as time-sensitive.

---

# 🖼️ Visual Output

The final user experience combines the generated design with a purchase-ready shopping plan.

### Before / After Preview

The system generates a redesigned version of the uploaded room while preserving the important structural characteristics of the original space.

### Shopping Recommendations

Each recommended item can include:

* Product name
* Product image
* Similarity score
* Price in EGP
* Availability
* Direct purchase link

---

# 💰 Budget Breakdown

The final budget can be presented as an itemized breakdown:

| Category  | Estimated Cost |
| --------- | -------------: |
| Furniture |        EGP ... |
| Lighting  |        EGP ... |
| Decor     |        EGP ... |
| Labor     |        EGP ... |
| Shipping  |        EGP ... |
| **Total** |    **EGP ...** |

The exact values depend on the retrieved products and the current catalog data.

---

# 👤 User Revision Path

After receiving the initial design, the user can request targeted changes such as:

* Change the interior style
* Change colors
* Increase the budget
* Decrease the budget
* Keep a specific item
* Replace a specific item
* Remove non-essential items

These requests are routed back into the appropriate stage of the orchestration pipeline.

---

# 🏗️ Technology Stack

### AI / LLM

* Llama
* Groq

### Agent Orchestration

* LangGraph

### Retrieval

* Embeddings
* PostgreSQL
* pgvector
* Semantic similarity search

### Computer Vision

* Vision LLM
* Image segmentation / masks

### Image Generation

* Image-to-image generation pipeline

### Backend

* Python

### Data

* Localized Egyptian product catalog
* EGP pricing
* Product metadata

---

# 📂 Project Structure

```text
.
├── src/
│   ├── agents/
│   │   ├── vision_agent.py
│   │   ├── design_agent.py
│   │   ├── budget_agent.py
│   │   └── shopping_agent.py
│   │
│   ├── orchestrator/
│   │   └── graph.py
│   │
│   ├── retrieval/
│   │   ├── embeddings.py
│   │   └── vector_search.py
│   │
│   ├── state/
│   │   └── shared_state.py
│   │
│   └── main.py
│
├── data/
├── tests/
├── notebooks/
├── assets/
├── docs/
│
├── .env.example
├── .gitignore
├── requirements.txt
├── LICENSE
└── README.md
```

---

# ⚙️ Installation

## 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/multi-agent-ai-home-design.git
cd multi-agent-ai-home-design
```

## 2. Create a virtual environment

### Windows

```bash
python -m venv .venv
.venv\Scripts\activate
```

### macOS / Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
```

## 3. Install dependencies

```bash
pip install -r requirements.txt
```

## 4. Configure environment variables

Create a `.env` file based on `.env.example`.

Example:

```env
GROQ_API_KEY=your_groq_api_key
DATABASE_URL=your_postgresql_connection_string
```

Never commit real API keys or credentials to GitHub.

---

# ▶️ Running the Project

```bash
python src/main.py
```

If the project uses a web interface, start the application using the project's configured entry point.

---

# 🔐 Environment Variables

| Variable        | Description                               |
| --------------- | ----------------------------------------- |
| `GROQ_API_KEY`  | API key used for Llama/Groq               |
| `DATABASE_URL`  | PostgreSQL database connection            |
| `PGVECTOR...`   | Vector database configuration             |
| `IMAGE_API_KEY` | Image generation service key, if required |

Only include variables that are actually used by the project.

---

# 🧪 Evaluation

The system can be evaluated across several dimensions:

### Vision

* Room-type classification
* Furniture detection
* Structural-element preservation

### Design

* Preference adherence
* Layout consistency
* Design quality

### Budget

* Budget compliance
* Cost estimation accuracy
* Number of revision iterations

### Shopping

* Semantic retrieval quality
* Product relevance
* Price correctness
* Link validity

### End-to-End

* Visual quality
* Budget feasibility
* Product relevance
* User satisfaction

---

# 🔒 Privacy & Security

* Do not commit API keys.
* Do not commit private user images.
* Do not commit personal information.
* Use `.env` for secrets.
* Use `.env.example` to document required variables.
* Treat product prices and availability as dynamic data.

---

# 🎓 Graduation Project

This project was developed as a **Graduation Project** focused on applying multi-agent AI systems to practical interior design and renovation planning.

### Main Concept

> **From Room Photo → AI Design → Real Products → Budget Validation → Purchase-Ready Redesign**

---

# 👥 Team

Add your team members here:

| Name        | Role                    |
| ----------- | ----------------------- |
| Your Name   | AI / Multi-Agent System |
| Team Member | ...                     |
| Team Member | ...                     |
| Team Member | ...                     |

---

# 📜 License

This project is licensed under the MIT License.

See the `LICENSE` file for details.
