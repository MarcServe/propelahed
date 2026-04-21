from __future__ import annotations

import os
from typing import Any

import httpx

from seo_engine.engine.state import ClientConfig

SERPER_SEARCH_URL = "https://google.serper.dev/search"
# One Serper search per topic in cluster; cap to control spend.
_SERPER_MAX_TOPIC_QUERIES = 8
_MAX_GAPS = 50


def _serper_api_key(config: ClientConfig) -> str:
    k = (config.serper_api_key or "").strip()
    if k:
        return k
    return (os.environ.get("SERPER_API_KEY") or "").strip()


def _serper_search_google(api_key: str, query: str, num: int = 10) -> dict[str, Any]:
    headers = {
        "X-API-KEY": api_key,
        "Content-Type": "application/json",
    }
    payload: dict[str, Any] = {"q": query, "num": num}
    with httpx.Client(timeout=45.0) as client:
        r = client.post(SERPER_SEARCH_URL, headers=headers, json=payload)
    if r.status_code == 401:
        raise ValueError(
            "Serper API rejected the key (401). Check serper_api_key in Settings or SERPER_API_KEY in .env."
        )
    if r.status_code == 403:
        raise ValueError("Serper API denied access (403). Verify your account and remaining credits.")
    r.raise_for_status()
    return r.json()


def _extract_gap_candidates(data: dict[str, Any], seed_topic: str) -> list[str]:
    """Pull related searches, people also ask, then a few organic titles; always include seed."""
    out: list[str] = []
    seen: set[str] = set()

    def add(phrase: str) -> None:
        t = phrase.strip()
        if not t:
            return
        key = t.lower()
        if key in seen:
            return
        seen.add(key)
        out.append(t[:200])

    add(seed_topic)

    for item in data.get("relatedSearches") or []:
        if isinstance(item, dict) and item.get("query"):
            add(str(item["query"]))
        elif isinstance(item, str):
            add(item)

    for item in data.get("peopleAlsoAsk") or []:
        if isinstance(item, dict) and item.get("question"):
            add(str(item["question"])[:200])

    for i, org in enumerate(data.get("organic") or []):
        if i >= 5:
            break
        if isinstance(org, dict) and org.get("title"):
            add(str(org["title"])[:120])

    return out


def _fetch_serper_keyword_gaps(config: ClientConfig) -> dict[str, Any]:
    api_key = _serper_api_key(config)
    if not api_key:
        raise ValueError(
            "Serper is selected but no API key was found. Add serper_api_key under Length & data in Settings "
            "or set SERPER_API_KEY in your environment."
        )

    topics = [str(t).strip() for t in (config.topic_cluster or []) if str(t).strip()]
    if not topics:
        raise ValueError("Serper keyword mode needs at least one topic in topic_cluster (Settings → Topics & voice).")

    merged: list[str] = []
    seen_lower: set[str] = set()

    def push_text(text: str) -> None:
        t = text.strip()
        if not t:
            return
        key = t.lower()
        if key in seen_lower:
            return
        seen_lower.add(key)
        merged.append(t)
        if len(merged) >= _MAX_GAPS:
            return

    for topic in topics[:_SERPER_MAX_TOPIC_QUERIES]:
        try:
            raw = _serper_search_google(api_key, topic)
        except httpx.HTTPStatusError as e:
            raise ValueError(
                f"Serper HTTP error for query {topic!r}: {e.response.status_code} {e.response.text[:200]}"
            ) from e
        except httpx.RequestError as e:
            raise ValueError(f"Could not reach Serper API: {e}") from e

        for phrase in _extract_gap_candidates(raw, topic):
            push_text(phrase)
            if len(merged) >= _MAX_GAPS:
                break
        if len(merged) >= _MAX_GAPS:
            break

    if not merged:
        merged = topics[:3]

    gaps: list[dict[str, str]] = []
    for i, kw in enumerate(merged):
        gaps.append(
            {
                "keyword": kw[:200],
                "volume_band": ["low", "medium", "high"][i % 3],
                "intent": "informational",
            }
        )

    return {"source": "SERPER", "gaps": gaps}


def fetch_keyword_gaps(config: ClientConfig) -> dict[str, Any]:
    """
    Keyword gap data for research. MOCK uses topic_cluster only.
    SERPER / SERPER_API call google.serper.dev and derive candidates from related searches, PAA, and titles.
    """
    source = (config.keyword_data_source or "MOCK").strip()
    if source == "MOCK":
        gaps = []
        for i, topic in enumerate(config.topic_cluster):
            gaps.append(
                {
                    "keyword": topic.lower().replace(" ", " ")[:80],
                    "volume_band": ["low", "medium", "high"][i % 3],
                    "intent": "informational",
                }
            )
        return {"source": "MOCK", "gaps": gaps}
    if source in ("SERPER", "SERPER_API"):
        return _fetch_serper_keyword_gaps(config)
    raise ValueError(f"Unknown keyword_data_source: {config.keyword_data_source!r}")
