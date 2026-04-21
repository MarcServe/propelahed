# Propelhed — Autonomous SEO Content Engine

Python pipeline (research → generate → quality gate → publish → evaluate → learn) with SQLite persistence, plus a **local operator UI** (Vite + React + FastAPI).

**Scope (what this repo is for)**  
This is a **prototype / operator toolchain**, not a hosted production SaaS. The **main requirement** is the **closed loop**: each successful run walks that full chain in **`run_loop()`** (see **[`JUDGEMENT.md`](JUDGEMENT.md)** — *Core product requirement: closed loop*) so **learning persists** (priorities, avoid hints, quality patterns, keyword registry in SQLite) and research reads it on the next run. See also Q2 and Q4 in **`JUDGEMENT.md`** for risks, cuts, and fit.

**Why this can matter commercially**  
Each **client** is a **YAML config** + **SQLite DB** + output folder—**low marginal cost** for an agency to deploy and demo. The same stack works as a **sales prototype**: run locally, show end-to-end brief → draft → scores → learning.

**Design intent:** make SEO and SME content growth **affordable and internal**—run on hardware you control, with **SQLite** and files on disk instead of paying for third-party **cloud data warehouses** in production to store learning, runs, and drafts. External APIs are optional (LLM, optional Serper); the system does not assume BigQuery, Snowflake, or similar for core operation.

## Requirements

- **Python 3.11+** recommended (3.9+ may work; CI should target 3.11).
- **Node.js 18+** for the web UI.
- An **Anthropic API key** with access to `claude-sonnet-4-20250514`.

## Setup

```bash
cd /path/to/Propelhed
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # add ANTHROPIC_API_KEY (and optional SERPER_API_KEY for live keyword gaps)
```

For **Serper** ([serper.dev](https://serper.dev)): set `keyword_data_source` to `SERPER` under **Settings → Length & data**, add your API key there or set `SERPER_API_KEY` in `.env`. The engine calls Google search via Serper to build related-query “gaps” from your topic cluster (up to eight searches per run configuration).

## CLI — one full loop

```bash
export PYTHONPATH=.
python main.py --config seo_engine/config/talkweb.yaml
```

**Unattended / daily runs**

- **In the UI:** **Settings → Schedule & autopilot** saves `autopilot_enabled` + `autopilot_time` into the client YAML. **Leave Content workspace running** (the backend process, usually started with `uvicorn` as below): the schedule uses the **clock on that computer**, up to **one automatic run per day**, with the same logic as **Write new article** (automatic topic choice).
- **Outside the app:** OS **cron** can still invoke **`scripts/run_loop_once.sh`** or `python main.py` with **`PROPELHED_CONFIG`** pointing at the client YAML.

Artifacts:

- SQLite: `data/{client_id}.db` (includes `loop_runs` for **Dashboard → last run status**, CLI or UI)
- Markdown: under `seo_engine/output/{client_id}/` (paths in YAML are resolved relative to `seo_engine/` for `./output/...`)

Target runtime is **under ~90 seconds** on a typical machine when the LLM responds quickly; cold starts and model latency dominate.

## API + UI (two terminals)

**Terminal A — API (port 8000):**

```bash
export PYTHONPATH=.
uvicorn seo_engine.api.app:app --reload --host 127.0.0.1 --port 8000
```

**Terminal B — web (port 5173):**

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api` to the FastAPI app.

Use the **Research** screen to view what feeds Stage 1 (topic cluster, keyword gaps, learning snapshot fields) and to save an **operator hint** that is appended to the research LLM prompt on the next **Run loop**.

### Security note (MVP)

This API has **no authentication**. Do not expose it to the public internet. It can trigger paid LLM calls and overwrite client YAML on disk.

## Tests

```bash
export PYTHONPATH=.
python -m pytest -q
```

## Project layout

| Path | Role |
|------|------|
| `seo_engine/engine/` | State, store, gate, stages, orchestrator |
| `seo_engine/api/` | FastAPI routes, background jobs |
| `seo_engine/prompts/` | Research / generate prompt templates |
| `seo_engine/config/` | Per-client YAML (`talkweb.yaml` example) |
| `web/` | Operator dashboard |
| `main.py` | CLI entry |
| `scripts/run_loop_once.sh` | Example one-shot runner for cron / automation |
| [`JUDGEMENT.md`](JUDGEMENT.md) | Scope, risks, and what was cut (see also [`seo_engine/JUDGEMENT.md`](seo_engine/JUDGEMENT.md)) |

## Example output (one complete loop)

**Architecture decision (submission artifact):** runtime drafts and SQLite live under `seo_engine/output/` and `data/` (gitignored so secrets and huge DBs stay local). To satisfy “show it working” without cloning private data, **[`examples/`](examples/)** holds a **fixed sample** of the same shapes: a **generated article** ([`examples/article-sample.md`](examples/article-sample.md)), **evaluation** scores + findings ([`examples/evaluation-sample.json`](examples/evaluation-sample.json)), and **learning store** merge ([`examples/learning-store-sample.json`](examples/learning-store-sample.json)). See [`examples/README.md`](examples/README.md) for how to reproduce on your machine.

## Publish destinations

**Implemented:** **`LOCAL_MARKDOWN`** only—drafts are written under the configured output directory (`stage3_publish`).  
**Not implemented:** **`GHOST_API`** and **`WEBHOOK`** are accepted in client YAML / Settings for forward compatibility but **will error at publish time** if selected (`NotImplementedError`). Use local Markdown until those destinations are implemented.
