from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from seo_engine.engine.state import LearningDelta


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


class KnowledgeStore:
    def __init__(self, db_path: str | Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._init_schema()
        self._migrate_schema()

    def close(self) -> None:
        self._conn.close()

    def _init_schema(self) -> None:
        cur = self._conn.cursor()
        cur.executescript(
            """
            CREATE TABLE IF NOT EXISTS articles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                loop_id TEXT NOT NULL,
                client_id TEXT NOT NULL,
                slug TEXT NOT NULL,
                title TEXT NOT NULL,
                primary_keyword TEXT NOT NULL,
                secondary_keywords TEXT,
                word_count INTEGER,
                publish_path TEXT,
                published_at TEXT,
                gate_result TEXT,
                gate_failures TEXT,
                underperforming INTEGER DEFAULT 0,
                UNIQUE(client_id, slug)
            );

            CREATE TABLE IF NOT EXISTS evaluations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                article_id INTEGER NOT NULL REFERENCES articles(id),
                loop_id TEXT NOT NULL,
                overall_score REAL,
                semantic_coverage REAL,
                keyword_usage REAL,
                readability REAL,
                structural_completeness REAL,
                internal_linking REAL,
                findings TEXT,
                flags TEXT,
                evaluated_at TEXT
            );

            CREATE TABLE IF NOT EXISTS learning_store (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id TEXT NOT NULL,
                loop_id TEXT NOT NULL,
                priority_topics TEXT,
                do_not_repeat TEXT,
                quality_patterns TEXT,
                keyword_registry TEXT,
                updated_at TEXT
            );

            CREATE TABLE IF NOT EXISTS gate_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id TEXT NOT NULL,
                loop_id TEXT NOT NULL,
                hard_failures TEXT,
                warnings TEXT,
                logged_at TEXT,
                draft_snapshot TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_articles_client ON articles(client_id);
            CREATE INDEX IF NOT EXISTS idx_learning_client ON learning_store(client_id);
            CREATE INDEX IF NOT EXISTS idx_gate_client ON gate_events(client_id);

            CREATE TABLE IF NOT EXISTS operator_research_hints (
                client_id TEXT PRIMARY KEY,
                hint TEXT NOT NULL DEFAULT '',
                updated_at TEXT
            );

            CREATE TABLE IF NOT EXISTS loop_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id TEXT NOT NULL,
                loop_id TEXT NOT NULL,
                status TEXT NOT NULL,
                stage_reached INTEGER NOT NULL DEFAULT 0,
                error_message TEXT,
                publish_path TEXT,
                gate_failures TEXT,
                finished_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_loop_runs_client ON loop_runs(client_id);

            CREATE TABLE IF NOT EXISTS research_hint_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id TEXT NOT NULL,
                loop_id TEXT NOT NULL,
                hint_text TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                UNIQUE(client_id, loop_id)
            );

            CREATE INDEX IF NOT EXISTS idx_hint_snap_client ON research_hint_snapshots(client_id);
            """
        )
        self._conn.commit()

    def _migrate_schema(self) -> None:
        """Add columns on existing DBs without full rebuild."""
        cur = self._conn.execute("PRAGMA table_info(gate_events)")
        cols = {row[1] for row in cur.fetchall()}
        if "draft_snapshot" not in cols:
            self._conn.execute("ALTER TABLE gate_events ADD COLUMN draft_snapshot TEXT")
            self._conn.commit()

        cur2 = self._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='research_hint_snapshots'"
        )
        if cur2.fetchone() is None:
            self._conn.executescript(
                """
                CREATE TABLE research_hint_snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    client_id TEXT NOT NULL,
                    loop_id TEXT NOT NULL,
                    hint_text TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    UNIQUE(client_id, loop_id)
                );
                CREATE INDEX IF NOT EXISTS idx_hint_snap_client ON research_hint_snapshots(client_id);
                """
            )
            self._conn.commit()

    def get_covered_topics(self, client_id: str) -> list[dict[str, Any]]:
        cur = self._conn.execute(
            "SELECT title, primary_keyword, slug FROM articles WHERE client_id = ? ORDER BY id",
            (client_id,),
        )
        return [dict(row) for row in cur.fetchall()]

    def get_published_titles_and_slugs(self, client_id: str) -> list[tuple[str, str]]:
        cur = self._conn.execute(
            "SELECT title, slug FROM articles WHERE client_id = ?",
            (client_id,),
        )
        return [(row["title"], row["slug"]) for row in cur.fetchall()]

    def get_learning_state(self, client_id: str) -> dict[str, Any] | None:
        cur = self._conn.execute(
            """
            SELECT * FROM learning_store
            WHERE client_id = ?
            ORDER BY id DESC LIMIT 1
            """,
            (client_id,),
        )
        row = cur.fetchone()
        if not row:
            return None
        d = dict(row)
        for key in ("priority_topics", "do_not_repeat", "quality_patterns", "keyword_registry"):
            if d.get(key):
                d[key] = json.loads(d[key])
            else:
                d[key] = []
        return d

    def get_do_not_repeat(self, client_id: str) -> list[str]:
        st = self.get_learning_state(client_id)
        if not st:
            return []
        return list(st.get("do_not_repeat") or [])

    def get_priority_topics(self, client_id: str) -> list[str]:
        st = self.get_learning_state(client_id)
        if not st:
            return []
        return list(st.get("priority_topics") or [])

    def log_article(self, article_data: dict[str, Any]) -> int:
        cur = self._conn.execute(
            """
            INSERT INTO articles (
                loop_id, client_id, slug, title, primary_keyword, secondary_keywords,
                word_count, publish_path, published_at, gate_result, gate_failures, underperforming
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                article_data["loop_id"],
                article_data["client_id"],
                article_data["slug"],
                article_data["title"],
                article_data["primary_keyword"],
                json.dumps(article_data.get("secondary_keywords") or []),
                article_data.get("word_count"),
                article_data.get("publish_path"),
                article_data.get("published_at") or _utc_now(),
                article_data.get("gate_result", "PASS"),
                json.dumps(article_data.get("gate_failures") or []),
                1 if article_data.get("underperforming") else 0,
            ),
        )
        self._conn.commit()
        return int(cur.lastrowid)

    def log_evaluation(self, eval_data: dict[str, Any]) -> None:
        self._conn.execute(
            """
            INSERT INTO evaluations (
                article_id, loop_id, overall_score, semantic_coverage, keyword_usage,
                readability, structural_completeness, internal_linking, findings, flags, evaluated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                eval_data["article_id"],
                eval_data["loop_id"],
                eval_data["overall_score"],
                eval_data["semantic_coverage"],
                eval_data["keyword_usage"],
                eval_data["readability"],
                eval_data["structural_completeness"],
                eval_data["internal_linking"],
                json.dumps(eval_data.get("findings") or []),
                json.dumps(eval_data.get("flags") or []),
                eval_data.get("evaluated_at") or _utc_now(),
            ),
        )
        self._conn.commit()

    def update_learning(self, client_id: str, loop_id: str, delta: LearningDelta) -> None:
        prev = self.get_learning_state(client_id)
        priorities = _merge_unique(prev.get("priority_topics") if prev else [], delta.next_priority_topics)
        do_not = _merge_unique(prev.get("do_not_repeat") if prev else [], delta.do_not_repeat)
        patterns = _merge_unique(
            prev.get("quality_patterns") if prev else [],
            delta.patterns_observed,
            max_len=100,
        )
        keywords = _merge_unique(
            prev.get("keyword_registry") if prev else [],
            delta.keywords_logged,
            max_len=500,
        )

        self._conn.execute(
            """
            INSERT INTO learning_store (
                client_id, loop_id, priority_topics, do_not_repeat, quality_patterns, keyword_registry, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                client_id,
                loop_id,
                json.dumps(priorities),
                json.dumps(do_not),
                json.dumps(patterns),
                json.dumps(keywords),
                _utc_now(),
            ),
        )
        self._conn.commit()

    def log_gate_failure(
        self,
        client_id: str,
        loop_id: str,
        failures: list[str],
        warnings: list[str] | None = None,
        draft_snapshot: dict[str, Any] | None = None,
    ) -> None:
        snap = json.dumps(draft_snapshot) if draft_snapshot else None
        self._conn.execute(
            """
            INSERT INTO gate_events (client_id, loop_id, hard_failures, warnings, logged_at, draft_snapshot)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                client_id,
                loop_id,
                json.dumps(failures),
                json.dumps(warnings or []),
                _utc_now(),
                snap,
            ),
        )
        self._conn.commit()

    def list_gate_failures(self, client_id: str, limit: int = 50) -> list[dict[str, Any]]:
        cur = self._conn.execute(
            """
            SELECT id, client_id, loop_id, hard_failures, warnings, logged_at, draft_snapshot
            FROM gate_events WHERE client_id = ? ORDER BY id DESC LIMIT ?
            """,
            (client_id, limit),
        )
        out: list[dict[str, Any]] = []
        for row in cur.fetchall():
            d = dict(row)
            d["hard_failures"] = json.loads(d["hard_failures"] or "[]")
            d["warnings"] = json.loads(d["warnings"] or "[]")
            raw_snap = d.get("draft_snapshot")
            if raw_snap:
                try:
                    d["draft_snapshot"] = json.loads(raw_snap)
                except json.JSONDecodeError:
                    d["draft_snapshot"] = None
            else:
                d["draft_snapshot"] = None
            out.append(d)
        return out

    def list_articles(self, client_id: str, limit: int = 100) -> list[dict[str, Any]]:
        cur = self._conn.execute(
            """
            SELECT id, loop_id, client_id, slug, title, primary_keyword, secondary_keywords,
                   word_count, publish_path, published_at, gate_result, gate_failures, underperforming
            FROM articles WHERE client_id = ? ORDER BY id DESC LIMIT ?
            """,
            (client_id, limit),
        )
        rows = []
        for row in cur.fetchall():
            d = dict(row)
            d["secondary_keywords"] = json.loads(d["secondary_keywords"] or "[]")
            d["gate_failures"] = json.loads(d["gate_failures"] or "[]")
            rows.append(d)
        return rows

    def list_evaluations(self, client_id: str, limit: int = 100) -> list[dict[str, Any]]:
        cur = self._conn.execute(
            """
            SELECT e.id, e.article_id, e.loop_id, e.overall_score, e.semantic_coverage,
                   e.keyword_usage, e.readability, e.structural_completeness, e.internal_linking,
                   e.findings, e.flags, e.evaluated_at, a.slug, a.title
            FROM evaluations e
            JOIN articles a ON a.id = e.article_id
            WHERE a.client_id = ?
            ORDER BY e.id DESC LIMIT ?
            """,
            (client_id, limit),
        )
        rows = []
        for row in cur.fetchall():
            d = dict(row)
            d["findings"] = json.loads(d["findings"] or "[]")
            d["flags"] = json.loads(d["flags"] or "[]")
            rows.append(d)
        return rows

    def set_article_underperforming(self, article_id: int, underperforming: bool) -> None:
        self._conn.execute(
            "UPDATE articles SET underperforming = ? WHERE id = ?",
            (1 if underperforming else 0, article_id),
        )
        self._conn.commit()

    def list_learning_history(self, client_id: str, limit: int = 20) -> list[dict[str, Any]]:
        cur = self._conn.execute(
            """
            SELECT * FROM learning_store WHERE client_id = ? ORDER BY id DESC LIMIT ?
            """,
            (client_id, limit),
        )
        out = []
        for row in cur.fetchall():
            d = dict(row)
            for key in ("priority_topics", "do_not_repeat", "quality_patterns", "keyword_registry"):
                d[key] = json.loads(d[key] or "[]")
            out.append(d)
        return out

    def get_research_hint(self, client_id: str) -> dict[str, str]:
        cur = self._conn.execute(
            "SELECT hint, updated_at FROM operator_research_hints WHERE client_id = ?",
            (client_id,),
        )
        row = cur.fetchone()
        if not row:
            return {"hint": "", "updated_at": ""}
        return {"hint": str(row["hint"] or ""), "updated_at": str(row["updated_at"] or "")}

    def set_research_hint(self, client_id: str, hint: str) -> None:
        self._conn.execute(
            """
            INSERT INTO operator_research_hints (client_id, hint, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(client_id) DO UPDATE SET
                hint = excluded.hint,
                updated_at = excluded.updated_at
            """,
            (client_id, hint, _utc_now()),
        )
        self._conn.commit()

    def insert_research_hint_snapshot(self, client_id: str, loop_id: str, hint_text: str) -> None:
        """Record operator research notes (dashboard save or pipeline run start)."""
        self._conn.execute(
            """
            INSERT INTO research_hint_snapshots (client_id, loop_id, hint_text, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (client_id, loop_id, hint_text, _utc_now()),
        )
        self._conn.commit()

    def list_research_hint_history(self, client_id: str, limit: int = 50) -> list[dict[str, Any]]:
        """Snapshots per run, with linked article title/slug when a draft was saved."""
        cur = self._conn.execute(
            """
            SELECT s.id, s.loop_id, s.hint_text, s.created_at,
                   a.id AS article_id, a.title AS article_title, a.slug AS article_slug
            FROM research_hint_snapshots s
            LEFT JOIN articles a ON a.loop_id = s.loop_id AND a.client_id = s.client_id
            WHERE s.client_id = ?
            ORDER BY s.id DESC
            LIMIT ?
            """,
            (client_id, limit),
        )
        return [dict(row) for row in cur.fetchall()]

    def get_article(self, client_id: str, article_id: int) -> dict[str, Any] | None:
        cur = self._conn.execute(
            """
            SELECT id, loop_id, client_id, slug, title, primary_keyword, secondary_keywords,
                   word_count, publish_path, published_at, gate_result, gate_failures, underperforming
            FROM articles WHERE client_id = ? AND id = ?
            """,
            (client_id, article_id),
        )
        row = cur.fetchone()
        if not row:
            return None
        d = dict(row)
        d["secondary_keywords"] = json.loads(d["secondary_keywords"] or "[]")
        d["gate_failures"] = json.loads(d["gate_failures"] or "[]")
        return d

    def log_loop_run(
        self,
        *,
        client_id: str,
        loop_id: str,
        status: str,
        stage_reached: int,
        error_message: str | None = None,
        publish_path: str | None = None,
        gate_failures: list[str] | None = None,
    ) -> None:
        self._conn.execute(
            """
            INSERT INTO loop_runs (
                client_id, loop_id, status, stage_reached, error_message,
                publish_path, gate_failures, finished_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                client_id,
                loop_id,
                status,
                stage_reached,
                error_message,
                publish_path,
                json.dumps(gate_failures or []),
                _utc_now(),
            ),
        )
        self._conn.commit()

    def list_loop_runs(self, client_id: str, limit: int = 20) -> list[dict[str, Any]]:
        """List recent pipeline runs, with article headline / topic / slug when a draft was saved for that loop."""
        cur = self._conn.execute(
            """
            SELECT r.id, r.client_id, r.loop_id, r.status, r.stage_reached, r.error_message,
                   r.publish_path, r.gate_failures, r.finished_at,
                   a.title AS article_title, a.slug AS article_slug,
                   a.primary_keyword AS article_primary_keyword,
                   (
                       SELECT e.overall_score FROM evaluations e
                       WHERE e.article_id = a.id
                       ORDER BY e.id DESC
                       LIMIT 1
                   ) AS evaluation_overall_score
            FROM loop_runs r
            LEFT JOIN articles a ON a.client_id = r.client_id AND a.loop_id = r.loop_id
                AND a.id = (
                    SELECT MAX(b.id) FROM articles b
                    WHERE b.loop_id = r.loop_id AND b.client_id = r.client_id
                )
            WHERE r.client_id = ?
            ORDER BY r.id DESC
            LIMIT ?
            """,
            (client_id, limit),
        )
        rows: list[dict[str, Any]] = []
        for row in cur.fetchall():
            d = dict(row)
            d["gate_failures"] = json.loads(d["gate_failures"] or "[]")
            rows.append(d)
        return rows

    def delete_loop_run(self, client_id: str, run_id: int) -> bool:
        cur = self._conn.execute(
            "DELETE FROM loop_runs WHERE client_id = ? AND id = ?",
            (client_id, run_id),
        )
        self._conn.commit()
        return cur.rowcount > 0

    def delete_research_snapshot(self, client_id: str, snapshot_id: int) -> bool:
        cur = self._conn.execute(
            "DELETE FROM research_hint_snapshots WHERE client_id = ? AND id = ?",
            (client_id, snapshot_id),
        )
        self._conn.commit()
        return cur.rowcount > 0

    def delete_gate_event(self, client_id: str, event_id: int) -> bool:
        cur = self._conn.execute(
            "DELETE FROM gate_events WHERE client_id = ? AND id = ?",
            (client_id, event_id),
        )
        self._conn.commit()
        return cur.rowcount > 0

    def delete_learning_row(self, client_id: str, learning_id: int) -> bool:
        cur = self._conn.execute(
            "DELETE FROM learning_store WHERE client_id = ? AND id = ?",
            (client_id, learning_id),
        )
        self._conn.commit()
        return cur.rowcount > 0

    def delete_evaluation(self, client_id: str, evaluation_id: int) -> bool:
        cur = self._conn.execute(
            """
            DELETE FROM evaluations
            WHERE id = ? AND article_id IN (SELECT id FROM articles WHERE client_id = ?)
            """,
            (evaluation_id, client_id),
        )
        self._conn.commit()
        return cur.rowcount > 0

    def delete_article(self, client_id: str, article_id: int) -> dict[str, Any] | None:
        """Remove article row and dependent evaluations. Returns row meta if it existed."""
        cur = self._conn.execute(
            "SELECT publish_path FROM articles WHERE client_id = ? AND id = ?",
            (client_id, article_id),
        )
        row = cur.fetchone()
        if not row:
            return None
        pub = row["publish_path"]
        self._conn.execute("DELETE FROM evaluations WHERE article_id = ?", (article_id,))
        self._conn.execute("DELETE FROM articles WHERE client_id = ? AND id = ?", (client_id, article_id))
        self._conn.commit()
        return {"publish_path": pub}


def _merge_unique(
    existing: list[str],
    new_items: list[str],
    max_len: int | None = None,
) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for x in list(existing) + list(new_items):
        s = str(x).strip()
        if not s or s.lower() in seen:
            continue
        seen.add(s.lower())
        out.append(s)
        if max_len is not None and len(out) >= max_len:
            break
    return out


def learning_snapshot_text(store: KnowledgeStore, client_id: str) -> str:
    """Human-readable block for LLM prompts (research + generate).

    Includes: covered catalog, merged priorities / do-not-repeat / quality_patterns / keywords from
    learning_store, and the latest evaluation row (numeric subscores + findings) when present.

    Not included here (by design or pipeline limitation):
    - Failed or gate-aborted runs (no article row → no evaluation/learn merge)
    - Full history of evaluations (only latest snapshot below; full list is the Quality scores UI / API)
    - Raw gate_events rows (use Draft checks / API); soft warnings from the last successful gate are merged into quality_patterns via stage5_learn
    - Operator research notes (handled in research prompts separately, not duplicated here)
    """
    covered = store.get_covered_topics(client_id)
    st = store.get_learning_state(client_id)
    lines = [
        "=== Covered topics (titles / primary keywords) ===",
        json.dumps(covered, indent=2) if covered else "[]",
        "",
        "=== Priority topics (prefer these) ===",
        json.dumps(store.get_priority_topics(client_id), indent=2),
        "",
        "=== Do not repeat (angles / framings) ===",
        json.dumps(store.get_do_not_repeat(client_id), indent=2),
        "",
    ]
    if st:
        lines.extend(
            [
                "=== Recent quality patterns ===",
                json.dumps(st.get("quality_patterns") or [], indent=2),
                "",
                "=== Keyword registry (sample) ===",
                json.dumps((st.get("keyword_registry") or [])[:40], indent=2),
                "",
            ]
        )
    latest_eval = store.list_evaluations(client_id, limit=1)
    if latest_eval:
        ev = latest_eval[0]
        lines.extend(
            [
                "=== Most recent evaluation (database — numeric breakdown + findings) ===",
                json.dumps(
                    {
                        "article_title": ev.get("title"),
                        "slug": ev.get("slug"),
                        "evaluated_at": ev.get("evaluated_at"),
                        "overall_score": ev.get("overall_score"),
                        "semantic_coverage": ev.get("semantic_coverage"),
                        "keyword_usage": ev.get("keyword_usage"),
                        "readability": ev.get("readability"),
                        "structural_completeness": ev.get("structural_completeness"),
                        "internal_linking": ev.get("internal_linking"),
                        "findings": ev.get("findings"),
                        "flags": ev.get("flags"),
                    },
                    indent=2,
                ),
            ]
        )
    return "\n".join(lines)
