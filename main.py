#!/usr/bin/env python3
"""CLI entry: run one full SEO engine loop."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from seo_engine.engine.gate import GateFailException
from seo_engine.engine.orchestrator import REPO_ROOT, run_loop


def main() -> int:
    parser = argparse.ArgumentParser(description="Autonomous SEO Content Engine — one loop")
    parser.add_argument(
        "--config",
        default=str(REPO_ROOT / "seo_engine" / "config" / "talkweb.yaml"),
        help="Path to client YAML config",
    )
    args = parser.parse_args()
    config_path = Path(args.config)
    if not config_path.is_file():
        print(f"Config not found: {config_path}", file=sys.stderr)
        return 2

    try:
        state = run_loop(config_path)
    except GateFailException as e:
        print("Quality gate FAILED:", file=sys.stderr)
        for h in e.gate_result.hard_failures:
            print(f"  - {h}", file=sys.stderr)
        return 1

    if state.errors:
        print("Loop aborted:", file=sys.stderr)
        for err in state.errors:
            print(f"  - {err}", file=sys.stderr)
        return 1

    print("Loop completed OK.")
    print("loop_id:", state.loop_id)
    if state.publish_path:
        print("published:", state.publish_path)
    if state.evaluation:
        print("overall_score:", state.evaluation.overall_score)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
