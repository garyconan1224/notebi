#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$ROOT_DIR"

export VITE_PRODUCT_MODE="notebi"
export BACKEND_PORT="${BACKEND_PORT:-8001}"
export VITE_PORT="${VITE_PORT:-5181}"
export VITE_BACKEND_PORT="$BACKEND_PORT"
export VITE_BACKEND_BASE_URL="http://127.0.0.1:$BACKEND_PORT"

"$ROOT_DIR/start-notebi.command" --prepare-only >/dev/null
exec "$ROOT_DIR/dev.sh"
