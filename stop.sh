#!/bin/bash
# 停止 dev.sh 启动的前后端。
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$SCRIPT_DIR"

BACKEND_PORT=$(grep -E '^BACKEND_PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '"' | tr -d "'")
VITE_PORT=$(grep -E '^VITE_PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '"' | tr -d "'")
BACKEND_PORT=${BACKEND_PORT:-8001}
VITE_PORT=${VITE_PORT:-5181}

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

kill_port() {
    local port=$1 name=$2
    local pids
    pids=$(lsof -ti:"$port" 2>/dev/null || true)
    if [[ -n "$pids" ]]; then
        kill -9 $pids 2>/dev/null || true
        printf "${GREEN}✔  已停止 %s (:%s, PID %s)${NC}\n" "$name" "$port" "$(echo $pids | tr '\n' ' ')"
    else
        printf "${YELLOW}-  %s (:%s) 未在运行${NC}\n" "$name" "$port"
    fi
}

kill_port "$BACKEND_PORT" "后端"
kill_port "$VITE_PORT" "前端"
rm -f .local/backend.pid .local/frontend.pid
