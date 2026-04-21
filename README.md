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

## Dependencies (what the repo installs)

Versions are pinned in the repo; install from those files, not ad hoc.

**Python — [`requirements.txt`](requirements.txt)** (used by `pip install -r requirements.txt`)

| Package | Role in this project |
|--------|------------------------|
| `anthropic` | LLM client (research, generation, evaluation) |
| `pyyaml` | Load/save per-client YAML configs |
| `textstat` | Readability / length signals for the quality gate |
| `python-slugify` | Safe filenames and slugs for drafts |
| `python-dotenv` | Load `.env` at repo root (`orchestrator`, API) |
| `pytest` | Test runner |
| `fastapi` | Operator HTTP API |
| `uvicorn[standard]` | ASGI server for local API |
| `httpx` | HTTP client (e.g. Serper when enabled) |

**Web UI — [`web/package.json`](web/package.json)** (`cd web && npm install`)

| Area | Main libs |
|------|-----------|
| UI | React 18, React Router, Recharts (dashboard charts) |
| Build | Vite 5, TypeScript, `@vitejs/plugin-react` |
| Config | `js-yaml` (read/write client YAML from the browser via API) |

There is no `pyproject.toml` or root `package.json`; Python deps live in **`requirements.txt`**, frontend deps in **`web/package.json`**.

## Environment variables

Create **`.env`** from **[`.env.example`](.env.example)** at the **repository root** (same directory as `main.py`). The engine loads it via `python-dotenv` when you run the CLI or API.

| Variable | Required | Purpose |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | Yes (for real runs) | Anthropic API access for the pipeline |
| `SERPER_API_KEY` | No | Google search via [Serper](https://serper.dev) when `keyword_data_source` is `SERPER` in YAML/Settings |

Secrets are **not** committed; **`.env`** is gitignored.

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

**`PROPELHED_CONFIG`** — optional env var used by [`scripts/run_loop_once.sh`](scripts/run_loop_once.sh): path to the client YAML. Defaults to `seo_engine/config/talkweb.yaml` under the repo root.

## Pipeline (one closed loop)

Entry point: **`run_loop()`** in [`seo_engine/engine/orchestrator.py`](seo_engine/engine/orchestrator.py) — loads **`.env`**, reads client YAML, opens **`data/{client_id}.db`**, then runs stages in order:

| Stage | Module | What it does |
|-------|--------|----------------|
| 1 — Research | [`stage1_research.py`](seo_engine/engine/stage1_research.py) | Topic cluster + gaps + brief; reads prior learning from SQLite |
| 2 — Generate (+ gate) | [`stage2_generate.py`](seo_engine/engine/stage2_generate.py) | Draft article; quality gate can fail the loop |
| 3 — Publish | [`stage3_publish.py`](seo_engine/engine/stage3_publish.py) | Writes Markdown when `publish_destination` is `LOCAL_MARKDOWN` |
| 4 — Evaluate | [`stage4_evaluate.py`](seo_engine/engine/stage4_evaluate.py) | Scores the draft (structured result used by learn) |
| 5 — Learn | [`stage5_learn.py`](seo_engine/engine/stage5_learn.py) | Merges evaluation into learning store in SQLite |

Shared pieces: **[`state.py`](seo_engine/engine/state.py)** (config + run state), **[`store.py`](seo_engine/engine/store.py)** (SQLite `KnowledgeStore`), **[`gate.py`](seo_engine/engine/gate.py)** (quality gate), **[`prompts/`](seo_engine/prompts/)** (templates). Prompts and YAML under **`seo_engine/config/`** define behavior per client.

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
| `web/` | Operator dashboard (Vite: `vite.config.ts`, `src/`) |
| `main.py` | CLI entry (`--config` path to client YAML) |
| `requirements.txt` | Python dependencies |
| `scripts/run_loop_once.sh` | Example one-shot runner for cron / automation |
| [`JUDGEMENT.md`](JUDGEMENT.md) | Scope, risks, and what was cut (see also [`seo_engine/JUDGEMENT.md`](seo_engine/JUDGEMENT.md)) |

**Suggested reading order for a new contributor**

1. This README → **[`JUDGEMENT.md`](JUDGEMENT.md)** (product intent and tradeoffs).
2. **[`seo_engine/engine/orchestrator.py`](seo_engine/engine/orchestrator.py)** (`run_loop`) → stage modules `stage1_*` … `stage5_*`.
3. Example client config **[`seo_engine/config/talkweb.yaml`](seo_engine/config/talkweb.yaml)**.
4. Checked-in output shapes **[`examples/README.md`](examples/README.md)** (no need for local `data/` or `seo_engine/output/` to understand artifacts).

**What stays local (gitignored)**  
**`.env`**, **`data/*.db`**, **`seo_engine/output/`**, **`node_modules/`**, **`web/dist/`** — see [`.gitignore`](.gitignore). Use **`examples/`** for committed samples of the same shapes (see below).

## Example output (one complete loop)

**Architecture decision (submission artifact):** runtime drafts and SQLite live under `seo_engine/output/` and `data/` (gitignored so secrets and huge DBs stay local). To satisfy “show it working” without cloning private data, **[`examples/`](examples/)** holds a **fixed sample** of the same shapes: a **generated article** ([`examples/article-sample.md`](examples/article-sample.md)), **evaluation** scores + findings ([`examples/evaluation-sample.json`](examples/evaluation-sample.json)), and **learning store** merge ([`examples/learning-store-sample.json`](examples/learning-store-sample.json)). See [`examples/README.md`](examples/README.md) for how to reproduce on your machine.

## Publish destinations

**Implemented:** **`LOCAL_MARKDOWN`** only—drafts are written under the configured output directory (`stage3_publish`).  
**Not implemented:** **`GHOST_API`** and **`WEBHOOK`** are accepted in client YAML / Settings for forward compatibility but **will error at publish time** if selected (`NotImplementedError`). Use local Markdown until those destinations are implemented.
