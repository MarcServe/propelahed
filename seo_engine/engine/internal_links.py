"""Resolve [LINK: slug] placeholders to real Markdown links using site URL and published titles."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

from seo_engine.engine.state import ClientConfig

LINK_PLACEHOLDER = re.compile(r"\[LINK:\s*([^\]]+?)\s*\]", re.IGNORECASE)
# Markdown links [text](url)
MD_LINK = re.compile(r"\[([^\]]+)\]\((https?://[^)]+)\)", re.IGNORECASE)


def effective_public_base(cfg: ClientConfig) -> str:
    """Canonical site origin for internal URLs (no trailing slash)."""
    raw = (cfg.public_base_url or "").strip()
    if raw:
        return raw.rstrip("/")
    d = (cfg.domain or "").strip()
    if not d:
        return "https://example.invalid"
    if "://" in d:
        return d.rstrip("/")
    return f"https://{d}".rstrip("/")


def _path_prefix(cfg: ClientConfig) -> str:
    p = (cfg.url_path_prefix or "").strip()
    if not p:
        return ""
    return p if p.startswith("/") else f"/{p}"


def slug_title_map_from_articles(rows: list[dict[str, Any]]) -> dict[str, str]:
    """Lowercased slug -> display title for anchors."""
    out: dict[str, str] = {}
    for row in rows:
        slug = str(row.get("slug") or "").strip()
        title = str(row.get("title") or "").strip()
        if slug and title:
            out[slug.lower()] = title
    return out


def _anchor_for_slug(slug: str, slug_to_title: dict[str, str]) -> str:
    key = slug.strip().strip("/").split("/")[-1].lower()
    if key in slug_to_title:
        return slug_to_title[key]
    return slug.replace("-", " ").replace("_", " ").strip().title() or slug


def resolve_link_placeholders(
    body: str,
    cfg: ClientConfig,
    slug_to_title: dict[str, str],
) -> str:
    """
    Replace each [LINK: some-slug] with [Title](https://site/prefix/some-slug).
    Slug may include path segments; last segment is used for lookup and URL path.
    """
    base = effective_public_base(cfg)
    prefix = _path_prefix(cfg)

    def repl(m: re.Match[str]) -> str:
        raw = m.group(1).strip()
        segment = raw.strip("/").split("/")[-1] if raw else ""
        if not segment:
            return m.group(0)
        title = _anchor_for_slug(segment, slug_to_title)
        url = f"{base}{prefix}/{segment}"
        return f"[{title}]({url})"

    return LINK_PLACEHOLDER.sub(repl, body)


def body_has_internal_link_signal(body: str, cfg: ClientConfig) -> bool:
    """True if body still has placeholders or contains markdown links to this site's origin."""
    if "[LINK:" in body:
        return True
    base = effective_public_base(cfg)
    try:
        want_host = urlparse(base).netloc.lower()
    except Exception:
        return False
    if not want_host:
        return False
    for m in MD_LINK.finditer(body):
        u = m.group(2)
        try:
            got = urlparse(u).netloc.lower()
        except Exception:
            continue
        if got == want_host:
            return True
    return False


def internal_link_targets_for_scoring(body: str, cfg: ClientConfig) -> set[str]:
    """
    Distinct internal link targets: slugs from [LINK: slug] and path tails from markdown URLs
    pointing at this site.
    """
    out: set[str] = set()
    for m in LINK_PLACEHOLDER.finditer(body):
        s = m.group(1).strip().strip("/").split("/")[-1]
        if s:
            out.add(s.lower())
    base = effective_public_base(cfg)
    try:
        want_host = urlparse(base).netloc.lower()
    except Exception:
        return out
    prefix = _path_prefix(cfg)
    base_path = prefix.rstrip("/") or ""

    for m in MD_LINK.finditer(body):
        u = m.group(2)
        try:
            p = urlparse(u)
        except Exception:
            continue
        if p.netloc.lower() != want_host:
            continue
        path = (p.path or "").rstrip("/")
        if base_path and path.startswith(base_path):
            tail = path[len(base_path) :].lstrip("/")
        else:
            tail = path.lstrip("/")
        if tail:
            out.add(tail.split("/")[-1].lower())
    return out


def score_internal_linking_body(body: str, cfg: ClientConfig) -> float:
    """0..10 matching stage4_evaluate logic (distinct targets)."""
    distinct = internal_link_targets_for_scoring(body, cfg)
    if not distinct:
        return 0.0
    if len(distinct) >= 2:
        return 10.0
    return 5.0
