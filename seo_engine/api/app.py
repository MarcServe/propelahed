from __future__ import annotations

import logging
from dataclasses import replace
import re
import tempfile
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

import yaml
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from seo_engine.engine.gate import GateFailException
from seo_engine.engine.keywords import fetch_keyword_gaps
from seo_engine.engine.orchestrator import REPO_ROOT, run_loop
from seo_engine.engine.stage1_research import (
    build_manual_content_brief,
    list_topic_candidates,
    validate_manual_target_keyword,
)
from seo_engine.engine.state import ClientConfig, ContentBrief
from seo_engine.engine.store import KnowledgeStore

CONFIG_DIR = REPO_ROOT / "seo_engine" / "config"

_jobs_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}

_autopilot_lock = threading.Lock()
_autopilot_last_fired_day: dict[str, str] = {}
logger = logging.getLogger("seo_engine.api")


def _normalize_hhmm(raw: str) -> str | None:
    s = (raw or "").strip()
    if not s:
        return None
    m = re.match(r"^(\d{1,2}):(\d{2})$", s)
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    if h > 23 or mi > 59:
        return None
    return f"{h:02d}:{mi:02d}"


def _spawn_autopilot_run(config_path: Path) -> None:
    """Background auto loop (same behaviour as POST /run mode=auto)."""

    def worker() -> None:
        try:
            run_loop(config_path, prefilled_brief=None)
        except GateFailException as e:
            logger.info(
                "Autopilot run quality gate failed for %s: %s",
                config_path.stem,
                e.gate_result.hard_failures,
            )
        except Exception as e:
            logger.exception("Autopilot run failed for %s: %s", config_path.stem, e)

    threading.Thread(target=worker, daemon=True, name=f"autopilot-{config_path.stem}").start()


def _autopilot_scheduler_loop() -> None:
    while True:
        time.sleep(30)
        try:
            now = datetime.now()
            hm = now.strftime("%H:%M")
            today = now.strftime("%Y-%m-%d")
            if not CONFIG_DIR.is_dir():
                continue
            for ypath in sorted(CONFIG_DIR.glob("*.yaml")):
                try:
                    cfg = ClientConfig.from_yaml(ypath)
                except Exception:
                    continue
                if not cfg.autopilot_enabled:
                    continue
                slot = _normalize_hhmm(cfg.autopilot_time)
                if not slot or hm != slot:
                    continue
                cid = cfg.client_id
                with _autopilot_lock:
                    if _autopilot_last_fired_day.get(cid) == today:
                        continue
                    _autopilot_last_fired_day[cid] = today
                logger.info("Autopilot starting daily run for client_id=%s", cid)
                _spawn_autopilot_run(ypath)
        except Exception:
            logger.exception("Autopilot scheduler tick failed")


class YamlUpdate(BaseModel):
    yaml: str


class ResearchHintUpdate(BaseModel):
    hint: str


class RunRequest(BaseModel):
    mode: Literal["auto", "manual"] = "auto"
    target_keyword: str = ""
    title_suggestion: str = ""
    angle: str = ""
    secondary_keywords: list[str] = Field(default_factory=list)


def _config_path_for_client(client_id: str) -> Path:
    p = CONFIG_DIR / f"{client_id}.yaml"
    if not p.is_file():
        raise HTTPException(status_code=404, detail=f"No config for client_id={client_id!r}")
    return p


_MAX_ARTICLE_PREVIEW_BYTES = 5_000_000  # ~5 MB cap for in-browser preview


def _safe_publish_path(publish_path: str) -> Path:
    """Resolve a draft path from the DB; must live under the repo root on disk."""
    raw = Path(publish_path.strip())
    if not str(raw):
        raise HTTPException(status_code=404, detail="No draft file path stored")
    repo = REPO_ROOT.resolve()
    resolved = raw.resolve() if raw.is_absolute() else (REPO_ROOT / raw).resolve()
    try:
        resolved.relative_to(repo)
    except ValueError as e:
        raise HTTPException(status_code=403, detail="Draft path is outside the project directory") from e
    if not resolved.is_file():
        raise HTTPException(status_code=404, detail="Draft file is not on disk (moved or deleted)")
    return resolved


def create_app() -> FastAPI:
    # So SERPER_API_KEY and other secrets in repo-root .env are visible to research-context / runs
    # without exporting them in the shell before uvicorn.
    load_dotenv(REPO_ROOT / ".env")
    app = FastAPI(title="SEO Content Engine API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    def _start_autopilot_scheduler() -> None:
        threading.Thread(target=_autopilot_scheduler_loop, daemon=True, name="autopilot-scheduler").start()

    @app.get("/api/clients")
    def list_clients() -> list[dict[str, str]]:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        out: list[dict[str, str]] = []
        for f in sorted(CONFIG_DIR.glob("*.yaml")):
            stem = f.stem
            try:
                cfg = ClientConfig.from_yaml(f)
                cid = cfg.client_id
            except Exception:
                cid = stem
            out.append({"client_id": cid, "filename": f.name})
        return out

    @app.get("/api/clients/{client_id}/config")
    def get_config(client_id: str) -> dict[str, str]:
        path = _config_path_for_client(client_id)
        return {"client_id": client_id, "yaml": path.read_text(encoding="utf-8")}

    @app.put("/api/clients/{client_id}/config")
    def put_config(client_id: str, payload: YamlUpdate) -> dict[str, str]:
        yaml_text = payload.yaml
        try:
            yaml.safe_load(yaml_text)
        except yaml.YAMLError as e:
            raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}") from e

        path = CONFIG_DIR / f"{client_id}.yaml"
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            delete=False,
            dir=str(path.parent),
            prefix=f".{client_id}-",
            suffix=".tmp",
        ) as tmp:
            tmp.write(yaml_text)
            tmp_path = Path(tmp.name)
        try:
            cfg = ClientConfig.from_yaml(tmp_path)
            if cfg.client_id != client_id:
                raise HTTPException(
                    status_code=400,
                    detail=f"client_id in YAML ({cfg.client_id!r}) must match URL ({client_id!r})",
                )
        except ValueError as e:
            tmp_path.unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail=str(e)) from e
        except HTTPException:
            tmp_path.unlink(missing_ok=True)
            raise
        tmp_path.replace(path)
        return {"status": "ok", "client_id": client_id}

    def _open_store(client_id: str) -> KnowledgeStore:
        db = REPO_ROOT / "data" / f"{client_id}.db"
        return KnowledgeStore(db)

    @app.get("/api/clients/{client_id}/articles")
    def list_articles(client_id: str, limit: int = 100) -> list[dict[str, Any]]:
        store = _open_store(client_id)
        try:
            return store.list_articles(client_id, limit=limit)
        finally:
            store.close()

    @app.get("/api/clients/{client_id}/articles/{article_id}/download")
    def download_article_markdown(client_id: str, article_id: int) -> FileResponse:
        _config_path_for_client(client_id)
        store = _open_store(client_id)
        try:
            row = store.get_article(client_id, article_id)
            if not row:
                raise HTTPException(status_code=404, detail="Article not found")
            pp = row.get("publish_path")
            if not pp:
                raise HTTPException(status_code=404, detail="No draft file path stored for this article")
            path = _safe_publish_path(str(pp))
            return FileResponse(
                str(path),
                filename=path.name,
                media_type="text/markdown",
            )
        finally:
            store.close()

    @app.get("/api/clients/{client_id}/research-hint-history")
    def research_hint_history(client_id: str, limit: int = 50) -> list[dict[str, Any]]:
        _config_path_for_client(client_id)
        store = _open_store(client_id)
        try:
            return store.list_research_hint_history(client_id, limit=limit)
        finally:
            store.close()

    @app.get("/api/clients/{client_id}/evaluations")
    def list_evaluations(client_id: str, limit: int = 100) -> list[dict[str, Any]]:
        store = _open_store(client_id)
        try:
            return store.list_evaluations(client_id, limit=limit)
        finally:
            store.close()

    @app.get("/api/clients/{client_id}/learning")
    def list_learning(client_id: str, limit: int = 20) -> list[dict[str, Any]]:
        store = _open_store(client_id)
        try:
            return store.list_learning_history(client_id, limit=limit)
        finally:
            store.close()

    @app.get("/api/clients/{client_id}/gate-failures")
    def list_gate_failures(client_id: str, limit: int = 50) -> list[dict[str, Any]]:
        store = _open_store(client_id)
        try:
            return store.list_gate_failures(client_id, limit=limit)
        finally:
            store.close()

    @app.get("/api/clients/{client_id}/research-hint")
    def get_research_hint(client_id: str) -> dict[str, str]:
        _config_path_for_client(client_id)
        store = _open_store(client_id)
        try:
            return store.get_research_hint(client_id)
        finally:
            store.close()

    @app.put("/api/clients/{client_id}/research-hint")
    def put_research_hint(client_id: str, body: ResearchHintUpdate) -> dict[str, str]:
        _config_path_for_client(client_id)
        store = _open_store(client_id)
        try:
            store.set_research_hint(client_id, body.hint)
            # Same snapshot table as pipeline runs — lets "Run history" show dashboard saves, not only article runs.
            store.insert_research_hint_snapshot(
                client_id,
                f"dashboard-save-{uuid.uuid4().hex}",
                body.hint,
            )
            return store.get_research_hint(client_id)
        finally:
            store.close()

    @app.get("/api/clients/{client_id}/runs")
    def list_loop_runs(client_id: str, limit: int = 20) -> list[dict[str, Any]]:
        store = _open_store(client_id)
        try:
            return store.list_loop_runs(client_id, limit=limit)
        finally:
            store.close()

    @app.get("/api/clients/{client_id}/research-context")
    def research_context(client_id: str) -> dict[str, Any]:
        path = _config_path_for_client(client_id)
        cfg = ClientConfig.from_yaml(path)
        store = _open_store(client_id)
        try:
            rh = store.get_research_hint(client_id)
            return {
                "client_id": client_id,
                "domain": cfg.domain,
                "topic_cluster": cfg.topic_cluster,
                "target_audience": cfg.target_audience,
                "tone": cfg.tone,
                "excluded_topics": cfg.excluded_topics,
                "keyword_data_source": cfg.keyword_data_source,
                "keyword_gaps": fetch_keyword_gaps(cfg),
                "covered_topics": store.get_covered_topics(client_id),
                "learning_state": store.get_learning_state(client_id),
                "operator_hint": rh.get("hint", ""),
                "operator_hint_updated_at": rh.get("updated_at", ""),
            }
        finally:
            store.close()

    @app.get("/api/clients/{client_id}/run-options")
    def run_options(client_id: str) -> dict[str, Any]:
        """Topic candidates and defaults for the Write new article screen."""
        path = _config_path_for_client(client_id)
        cfg = ClientConfig.from_yaml(path)
        store = _open_store(client_id)
        try:
            load_warning: str | None = None
            try:
                candidates = list_topic_candidates(cfg, store)
            except Exception as e:
                # Serper/network/config errors should not brick this screen; fall back to MOCK-style gaps.
                logger.warning("run_options: keyword gap build failed for %s, using MOCK fallback: %s", client_id, e)
                load_warning = str(e)
                cfg_mock = replace(cfg, keyword_data_source="MOCK")
                candidates = list_topic_candidates(cfg_mock, store)
            return {
                "client_id": client_id,
                "candidates": candidates,
                "topic_cluster": cfg.topic_cluster,
                "target_word_count": cfg.target_word_count,
                "load_warning": load_warning,
            }
        finally:
            store.close()

    @app.post("/api/clients/{client_id}/run")
    def trigger_run(client_id: str, body: RunRequest | None = None) -> dict[str, str]:
        req = body if body is not None else RunRequest()
        path = _config_path_for_client(client_id)
        cfg = ClientConfig.from_yaml(path)

        prefilled_brief: ContentBrief | None = None
        if req.mode == "manual":
            store = _open_store(client_id)
            try:
                msg = validate_manual_target_keyword(cfg, store, req.target_keyword)
                if msg:
                    raise HTTPException(status_code=400, detail=msg)
                prefilled_brief = build_manual_content_brief(
                    cfg,
                    target_keyword=req.target_keyword,
                    title_suggestion=req.title_suggestion,
                    angle=req.angle,
                    secondary_keywords=req.secondary_keywords,
                )
            finally:
                store.close()

        job_id = str(uuid.uuid4())
        with _jobs_lock:
            _jobs[job_id] = {
                "status": "pending",
                "client_id": client_id,
                "error": None,
                "loop_id": None,
                "publish_path": None,
                "gate_failures": None,
            }

        def worker() -> None:
            with _jobs_lock:
                _jobs[job_id]["status"] = "running"
            try:
                state = run_loop(path, prefilled_brief=prefilled_brief)
                with _jobs_lock:
                    if state.errors:
                        _jobs[job_id].update(
                            {
                                "status": "failed",
                                "error": "; ".join(state.errors),
                            }
                        )
                    else:
                        _jobs[job_id].update(
                            {
                                "status": "succeeded",
                                "loop_id": state.loop_id,
                                "publish_path": state.publish_path,
                            }
                        )
            except GateFailException as e:
                with _jobs_lock:
                    _jobs[job_id].update(
                        {
                            "status": "failed",
                            "error": "Quality gate failed",
                            "gate_failures": e.gate_result.hard_failures,
                        }
                    )
            except Exception as e:
                with _jobs_lock:
                    _jobs[job_id].update({"status": "failed", "error": str(e)})

        threading.Thread(target=worker, daemon=True).start()
        return {"job_id": job_id, "status": "pending"}

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str) -> dict[str, Any]:
        with _jobs_lock:
            job = _jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Unknown job_id")
        return job

    @app.delete("/api/clients/{client_id}/runs/{run_id}")
    def delete_loop_run(client_id: str, run_id: int) -> dict[str, str]:
        _config_path_for_client(client_id)
        store = _open_store(client_id)
        try:
            if not store.delete_loop_run(client_id, run_id):
                raise HTTPException(status_code=404, detail="Run not found")
            return {"status": "ok"}
        finally:
            store.close()

    @app.delete("/api/clients/{client_id}/research-hint-history/{snapshot_id}")
    def delete_research_snapshot(client_id: str, snapshot_id: int) -> dict[str, str]:
        _config_path_for_client(client_id)
        store = _open_store(client_id)
        try:
            if not store.delete_research_snapshot(client_id, snapshot_id):
                raise HTTPException(status_code=404, detail="Snapshot not found")
            return {"status": "ok"}
        finally:
            store.close()

    @app.get("/api/clients/{client_id}/articles/{article_id}/content")
    def get_article_markdown_content(client_id: str, article_id: int) -> dict[str, str]:
        """Return draft Markdown as JSON for UI preview (same file as download)."""
        _config_path_for_client(client_id)
        store = _open_store(client_id)
        try:
            row = store.get_article(client_id, article_id)
            if not row:
                raise HTTPException(status_code=404, detail="Article not found")
            pp = row.get("publish_path")
            if not pp:
                raise HTTPException(status_code=404, detail="No draft file path stored for this article")
            path = _safe_publish_path(str(pp))
            data = path.read_bytes()
            if len(data) > _MAX_ARTICLE_PREVIEW_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail="Article file is too large to preview; use Download .md instead.",
                )
            text = data.decode("utf-8", errors="replace")
            return {"markdown": text}
        finally:
            store.close()

    @app.delete("/api/clients/{client_id}/articles/{article_id}")
    def delete_article(client_id: str, article_id: int) -> dict[str, str]:
        _config_path_for_client(client_id)
        store = _open_store(client_id)
        try:
            meta = store.delete_article(client_id, article_id)
            if not meta:
                raise HTTPException(status_code=404, detail="Article not found")
        finally:
            store.close()
        pp = meta.get("publish_path") if meta else None
        if pp:
            try:
                path = _safe_publish_path(str(pp))
                path.unlink(missing_ok=True)
            except HTTPException:
                pass
        return {"status": "ok"}

    @app.delete("/api/clients/{client_id}/evaluations/{evaluation_id}")
    def delete_evaluation(client_id: str, evaluation_id: int) -> dict[str, str]:
        _config_path_for_client(client_id)
        store = _open_store(client_id)
        try:
            if not store.delete_evaluation(client_id, evaluation_id):
                raise HTTPException(status_code=404, detail="Evaluation not found")
            return {"status": "ok"}
        finally:
            store.close()

    @app.delete("/api/clients/{client_id}/learning/{learning_id}")
    def delete_learning_row(client_id: str, learning_id: int) -> dict[str, str]:
        _config_path_for_client(client_id)
        store = _open_store(client_id)
        try:
            if not store.delete_learning_row(client_id, learning_id):
                raise HTTPException(status_code=404, detail="Learning row not found")
            return {"status": "ok"}
        finally:
            store.close()

    @app.delete("/api/clients/{client_id}/gate-failures/{event_id}")
    def delete_gate_event(client_id: str, event_id: int) -> dict[str, str]:
        _config_path_for_client(client_id)
        store = _open_store(client_id)
        try:
            if not store.delete_gate_event(client_id, event_id):
                raise HTTPException(status_code=404, detail="Gate event not found")
            return {"status": "ok"}
        finally:
            store.close()

    return app


app = create_app()
