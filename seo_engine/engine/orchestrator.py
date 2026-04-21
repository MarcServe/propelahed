from __future__ import annotations

import uuid
from pathlib import Path

from dotenv import load_dotenv

from seo_engine.engine.gate import GateFailException
from seo_engine.engine.state import ClientConfig, ContentBrief, State
from seo_engine.engine.stage1_research import run_research
from seo_engine.engine.stage2_generate import run_generate
from seo_engine.engine.stage3_publish import run_publish
from seo_engine.engine.stage4_evaluate import run_evaluate
from seo_engine.engine.stage5_learn import run_learn
from seo_engine.engine.store import KnowledgeStore

REPO_ROOT = Path(__file__).resolve().parents[2]


def run_loop(config_path: str | Path, *, prefilled_brief: ContentBrief | None = None) -> State:
    """
    Main product path: one **closed loop** per invocation —

    **research → generate (includes quality gate) → publish → evaluate → learn** —

    with SQLite (`KnowledgeStore`) persistence for articles, evaluations, loop_runs,
    and the learning_store merge (priority topics, avoid lines, quality patterns,
    keyword registry). Research reads the prior learning snapshot on each run.

    On research errors, returns State with errors set (later stages skipped).
    On gate failure, raises GateFailException after logging.
    Each attempt is recorded in loop_runs for dashboard / audit.
    """
    load_dotenv(REPO_ROOT / ".env")
    config_path = Path(config_path).resolve()
    cfg = ClientConfig.from_yaml(config_path)

    db_path = REPO_ROOT / "data" / f"{cfg.client_id}.db"
    store = KnowledgeStore(db_path)

    state = State(
        loop_id=str(uuid.uuid4()),
        client_id=cfg.client_id,
        config=cfg,
    )

    op_hint = (store.get_research_hint(cfg.client_id).get("hint") or "").strip()
    store.insert_research_hint_snapshot(cfg.client_id, state.loop_id, op_hint)

    def _log(
        status: str,
        *,
        error_message: str | None = None,
        gate_failures: list[str] | None = None,
    ) -> None:
        store.log_loop_run(
            client_id=cfg.client_id,
            loop_id=state.loop_id,
            status=status,
            stage_reached=state.stage_reached,
            error_message=error_message,
            publish_path=state.publish_path,
            gate_failures=gate_failures,
        )

    try:
        try:
            run_research(state, store, prefilled_brief=prefilled_brief)
            if state.errors:
                _log("failed", error_message="; ".join(state.errors))
                return state

            run_generate(state, store)
            run_publish(state, store, config_path=config_path)
            run_evaluate(state)
            run_learn(state, store)
            _log("succeeded")
        except GateFailException as e:
            _log(
                "failed",
                error_message="Quality gate failed",
                gate_failures=e.gate_result.hard_failures,
            )
            raise
        except Exception as e:
            _log("failed", error_message=str(e) or type(e).__name__)
            raise
    finally:
        store.close()

    return state
