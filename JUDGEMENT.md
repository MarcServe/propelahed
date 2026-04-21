# JUDGEMENT.md — Pre-build answers

This file mirrors the specification’s pre-build judgement section. It will be updated after production use with observed behaviour.

**Economics / architecture:** The product target is **affordable, internal SEO** for SMEs—not a stack that **requires** paid cloud warehouses for production. Core state lives in **SQLite** and Markdown on disk; scale-out data platforms are optional integrations, not prerequisites.

## Core product requirement: closed loop

The **primary** behaviour the app must deliver is a **single invocation that runs the full pipeline** end to end whenever it succeeds:

| Stage | Role |
| --- | --- |
| Research | Builds the brief; consumes **prior** learning snapshot from SQLite (`learning_store` merge). |
| Generate | Draft + **quality gate** (hard fails abort before publish). |
| Publish | Writes artifact (e.g. `LOCAL_MARKDOWN`); records article row. |
| Evaluate | Scores draft vs brief. |
| Learn | Merges evaluator output into **persistent** learning (priorities, avoid lines, quality patterns, keywords) in SQLite. |

Implementation: **`seo_engine/engine/orchestrator.py`** — `run_loop()` calls `run_research` → `run_generate` → `run_publish` → `run_evaluate` → `run_learn`. UI, CLI, and autopilot all call this same entry point so the **closed loop** is not a separate code path. A failed gate or earlier error ends that attempt **without** learn for that run (by design).

## Q1: What would break your quality gate? What kind of content would slip through?

The gate checks structure and keyword placement, not meaning. Content that is structurally perfect but factually wrong will pass. An article with the right keyword density, correct header count, and a valid meta description — but which misrepresents the topic, hallucinates statistics, or gives harmful advice — passes every hard fail criterion.

The gate also does not catch semantic duplication across different titles. The Research stage plus the knowledge store are the primary defence.

Finally, the gate does not assess tone consistency with brand voice.

## Q2: What does the learning layer know after one loop that it did not before?

After one complete loop, the learning store accumulates covered topics (via articles), priority topics, do-not-repeat hints, quality patterns from evaluator findings, and a keyword registry. Research prompts read this snapshot on every run so the next brief is materially influenced.

It does not yet know search rankings, on-site analytics, or commercial outcome quality.

## Q3: Biggest risk at scale — 500 posts, 10 clients simultaneously

SQLite write concurrency across processes is the main production risk; Postgres migration is the straightforward mitigation.

Long prompts (very large learning snapshots) increase cost and latency; summarisation before prompt injection is a future optimisation.

## Q4: What was cut to hit the timebox (and what exists today)?

**Intentionally not “production SaaS”**

- **Auth / tenancy:** FastAPI + Vite are **local-operator tools** only—**no** multi-tenant SaaS authentication, billing, or hosted admin. Do not expose the API to the public internet without a reverse proxy and auth you add yourself.
- **Fact-checking:** **No** dedicated fact-check or grounding agent; the quality gate is structural/SEO-oriented, not truth verification (see Q1).

**Optional vs not implemented in the publish path**

- **Keyword source:** YAML can set `MOCK` (no external API) or **`SERPER`** for live Google-via-Serper gaps when a key is set in **Settings → Length & data** or `SERPER_API_KEY` in `.env`. Keys must be from **[serper.dev](https://serper.dev)**—**not** SerpApi (serpapi.com). This is wired for **research**; it is not a full rank-tracker product.
- **Publishing:** Only **`LOCAL_MARKDOWN`** is implemented end-to-end (`stage3_publish`). **Ghost** and **webhook** destinations are validated in client YAML/UI but **raise `NotImplementedError`** if selected—drafts are not pushed to those systems in this repo.

**Scheduling**

- **In-app autopilot:** If **`autopilot_enabled`** and **`autopilot_time`** (`HH:MM` on the host computer’s clock) are set in the client YAML (see **Settings → Schedule & autopilot**), the running backend process runs **one automatic loop per calendar day** at that minute (typically the machine where **Content workspace** / `uvicorn` is left running).
- **OS cron** is still an option: use **`scripts/run_loop_once.sh`** or `python main.py --config …` without relying on the running API.

**Why this scope**

A **single loop that completes** (research → generate → gate → publish → evaluate → learn) with **SQLite + learning_store that persists** beats half-built “enterprise” surfaces. Per-client **`seo_engine/config/{client}.yaml`** + **`data/{client}.db`** keep **marginal cost per agency client** low: copy config, run the same binary.
