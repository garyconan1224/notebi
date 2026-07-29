#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
ENV_FILE="$ROOT_DIR/.env"

set_env_value() {
    local key="$1"
    local value="$2"
    local tmp

    mkdir -p "$ROOT_DIR/.local"
    if [[ ! -f "$ENV_FILE" ]]; then
        if [[ -f "$ROOT_DIR/.env.example" ]]; then
            cp "$ROOT_DIR/.env.example" "$ENV_FILE"
        else
            touch "$ENV_FILE"
        fi
    fi

    tmp="$(mktemp "$ROOT_DIR/.local/env.XXXXXX")"
    awk -v key="$key" -v value="$value" '
        BEGIN { done = 0 }
        $0 ~ "^[[:space:]]*" key "=" {
            if (!done) {
                print key "=\"" value "\""
                done = 1
            }
            next
        }
        { print }
        END {
            if (!done) {
                print key "=\"" value "\""
            }
        }
    ' "$ENV_FILE" > "$tmp"
    mv "$tmp" "$ENV_FILE"
}

BACKEND_PORT="${BACKEND_PORT:-8001}"
VITE_PORT="${VITE_PORT:-5181}"

set_env_value "BACKEND_PORT" "$BACKEND_PORT"
set_env_value "VITE_PORT" "$VITE_PORT"
set_env_value "VITE_BACKEND_BASE_URL" "http://127.0.0.1:$BACKEND_PORT"

export BACKEND_PORT
export VITE_PORT
export VITE_BACKEND_PORT="$BACKEND_PORT"
export VITE_BACKEND_BASE_URL="http://127.0.0.1:$BACKEND_PORT"

if [[ "${1:-}" == "--prepare-only" ]]; then
    echo "NoteBi environment prepared: frontend http://localhost:$VITE_PORT, backend http://localhost:$BACKEND_PORT"
    exit 0
fi

cd "$ROOT_DIR"
exec "$ROOT_DIR/start.sh"
