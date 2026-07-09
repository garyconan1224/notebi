#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$ROOT_DIR"

export VITE_PRODUCT_MODE="notebi"
export VITE_BACKEND_BASE_URL="${VITE_BACKEND_BASE_URL:-http://127.0.0.1:8001}"

if ! command -v pnpm >/dev/null 2>&1; then
    if ! command -v npm >/dev/null 2>&1; then
        echo "Node.js/npm not found. Run ./start-notebi.command once to install dependencies first." >&2
        exit 1
    fi
    npm install -g pnpm
fi

if [[ ! -d "$ROOT_DIR/frontend/node_modules" ]]; then
    pnpm --dir "$ROOT_DIR/frontend" install
fi

echo "$(uname -m)" > "$ROOT_DIR/frontend/node_modules/.arch_stamp"

pnpm --dir "$ROOT_DIR/frontend" build
echo "NoteBi build output: $ROOT_DIR/frontend/dist"
