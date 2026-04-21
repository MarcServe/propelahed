#!/usr/bin/env bash
# Run one full autonomous loop (research → generate → publish → evaluate → learn).
# Schedule with cron, e.g. daily at 06:00:
#   0 6 * * * /path/to/Propelhed/scripts/run_loop_once.sh >>/tmp/propelhed-loop.log 2>&1
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
exec python3 main.py --config "${PROPELHED_CONFIG:-$ROOT/seo_engine/config/talkweb.yaml}"
