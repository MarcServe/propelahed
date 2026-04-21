from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml


@dataclass
class ClientConfig:
    client_id: str
    domain: str
    topic_cluster: list[str]
    target_audience: str
    tone: str
    publish_destination: str
    output_dir: str
    ghost_api_url: str | None = None
    ghost_api_key: str | None = None
    webhook_url: str | None = None
    min_word_count: int = 600
    max_word_count: int = 4000
    target_word_count: int = 1200
    keyword_data_source: str = "MOCK"
    serper_api_key: str | None = None
    brand_voice_notes: str | None = None
    excluded_topics: list[str] = field(default_factory=list)
    autopilot_enabled: bool = False
    autopilot_time: str = ""  # Server-local HH:MM (24h) for one automatic run per day
    # Optional: override origin for resolved internal links (default https://{domain})
    public_base_url: str | None = None
    # Path segment before slug, e.g. "/blog" -> https://site/blog/my-slug
    url_path_prefix: str = ""

    @staticmethod
    def from_yaml(path: str | Path) -> ClientConfig:
        path = Path(path)
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        required = [
            "client_id",
            "domain",
            "topic_cluster",
            "target_audience",
            "tone",
            "publish_destination",
            "output_dir",
        ]
        missing = [k for k in required if k not in raw or raw[k] in (None, "", [])]
        if missing:
            raise ValueError(f"Missing required config fields: {', '.join(missing)}")

        dest = raw["publish_destination"]
        if dest == "GHOST_API" and not raw.get("ghost_api_url"):
            raise ValueError("ghost_api_url required when publish_destination is GHOST_API")
        if dest == "GHOST_API" and not raw.get("ghost_api_key"):
            raise ValueError("ghost_api_key required when publish_destination is GHOST_API")
        if dest == "WEBHOOK" and not raw.get("webhook_url"):
            raise ValueError("webhook_url required when publish_destination is WEBHOOK")
        if dest not in ("LOCAL_MARKDOWN", "GHOST_API", "WEBHOOK"):
            raise ValueError(
                f"publish_destination must be LOCAL_MARKDOWN, GHOST_API, or WEBHOOK; got {dest!r}"
            )

        return ClientConfig(
            client_id=str(raw["client_id"]),
            domain=str(raw["domain"]),
            topic_cluster=list(raw["topic_cluster"]),
            target_audience=str(raw["target_audience"]),
            tone=str(raw["tone"]),
            publish_destination=str(raw["publish_destination"]),
            output_dir=str(raw["output_dir"]),
            ghost_api_url=raw.get("ghost_api_url"),
            ghost_api_key=raw.get("ghost_api_key"),
            webhook_url=raw.get("webhook_url"),
            min_word_count=int(raw.get("min_word_count", 600)),
            max_word_count=int(raw.get("max_word_count", 4000)),
            target_word_count=int(raw.get("target_word_count", 1200)),
            keyword_data_source=str(raw.get("keyword_data_source", "MOCK")),
            serper_api_key=raw.get("serper_api_key"),
            brand_voice_notes=raw.get("brand_voice_notes"),
            excluded_topics=list(raw.get("excluded_topics") or []),
            autopilot_enabled=bool(raw.get("autopilot_enabled", False)),
            autopilot_time=str(raw.get("autopilot_time") or "").strip(),
            public_base_url=raw.get("public_base_url"),
            url_path_prefix=str(raw.get("url_path_prefix") or "").strip(),
        )


@dataclass
class ContentBrief:
    target_keyword: str
    secondary_keywords: list[str]
    title_suggestion: str
    angle: str
    target_word_count: int
    audience_note: str
    internal_link_candidates: list[str]
    avoid_topics: list[str]
    rationale: str


@dataclass
class InternalLinkRef:
    slug: str
    anchor: str


@dataclass
class GeneratedPost:
    title: str
    meta_description: str
    slug: str
    body_markdown: str
    word_count: int
    keywords_used: list[str]
    internal_links: list[dict[str, Any]]
    generated_at: datetime

    def to_json_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["generated_at"] = self.generated_at.isoformat()
        return d


@dataclass
class EvaluationResult:
    overall_score: float
    semantic_coverage: float
    keyword_usage: float
    readability: float
    structural_completeness: float
    internal_linking: float
    findings: list[str]
    flags: list[str]


@dataclass
class LearningDelta:
    topic_added: str
    keywords_logged: list[str]
    quality_score_logged: float
    patterns_observed: list[str]
    next_priority_topics: list[str]
    do_not_repeat: list[str]


@dataclass
class GateResult:
    result: str  # PASS | FAIL
    hard_failures: list[str]
    warnings: list[str]
    gate_log: dict[str, Any]
    checked_at: datetime


@dataclass
class State:
    loop_id: str
    client_id: str
    config: ClientConfig
    brief: ContentBrief | None = None
    post: GeneratedPost | None = None
    publish_path: str | None = None
    evaluation: EvaluationResult | None = None
    learning_delta: LearningDelta | None = None
    gate_result: GateResult | None = None
    stage_reached: int = 0
    errors: list[str] = field(default_factory=list)
    article_row_id: int | None = None
