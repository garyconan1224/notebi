#!/bin/bash
# 快速重启前后端：先杀旧端口，再起新进程。
# 跳过依赖检查（假定已跑过 ./start-notebi.command 装好环境）。
# 用法：./dev.sh        启动
#       ./stop.sh       停止
#       tail -f .local/backend.log .local/frontend.log   看日志

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
cd "$SCRIPT_DIR"
mkdir -p .local

# 即使从已有终端环境启动，也必须保持 NoteBi 产品模式，不能继承 Nibi。
export VITE_PRODUCT_MODE="notebi"

# ── 读取端口（.env 优先，否则默认） ──────────────────────────────
BACKEND_PORT=$(grep -E '^BACKEND_PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '"' | tr -d "'")
VITE_PORT=$(grep -E '^VITE_PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '"' | tr -d "'")
BACKEND_PORT=${BACKEND_PORT:-8001}
VITE_PORT=${VITE_PORT:-5181}

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

# ── 清端口 ────────────────────────────────────────────────────
kill_port() {
    local port=$1
    local pids
    pids=$(lsof -ti:"$port" 2>/dev/null || true)
    if [[ -n "$pids" ]]; then
        printf "${YELLOW}⚠  端口 %s 被占用，杀掉 PID: %s${NC}\n" "$port" "$(echo $pids | tr '\n' ' ')"
        kill -9 $pids 2>/dev/null || true
        sleep 0.3
    fi
}
kill_port "$BACKEND_PORT"
kill_port "$VITE_PORT"

# ── 起后端 ────────────────────────────────────────────────────
if [[ ! -x .venv/bin/uvicorn ]]; then
    printf "${YELLOW}⚠  .venv 不存在，请先跑一次 ./start-notebi.command${NC}\n"
    exit 1
fi
printf "${BLUE}▶ 启动后端 :%s${NC}\n" "$BACKEND_PORT"
# --reload 只监视代码目录（backend/shared），不扫 data/（数千文件）与 .local/：
# 未装 watchfiles 时 uvicorn 用 StatReload 轮询 stat，若监视整个仓库会与 yt-dlp
# 下载往 data/ 写分片抢磁盘/CPU、拖慢下载。限定代码目录后既保留热重载又不影响下载。
nohup .venv/bin/uvicorn backend.app.main:app --reload \
    --reload-dir backend --reload-dir shared \
    --port "$BACKEND_PORT" \
    > .local/backend.log 2>&1 &
echo $! > .local/backend.pid

# ── 起前端 ────────────────────────────────────────────────────
if [[ ! -d frontend/node_modules ]]; then
    printf "${YELLOW}⚠  frontend/node_modules 不存在，请先跑一次 ./start-notebi.command${NC}\n"
    exit 1
fi
printf "${BLUE}▶ 启动前端 :%s${NC}\n" "$VITE_PORT"
export VITE_BACKEND_BASE_URL="http://127.0.0.1:$BACKEND_PORT"
export VITE_BACKEND_PORT="$BACKEND_PORT"
(
    cd frontend
    nohup pnpm dev --host --port "$VITE_PORT" \
        > ../.local/frontend.log 2>&1 &
    echo $! > ../.local/frontend.pid
)

# ── 健康探测 ──────────────────────────────────────────────────
printf "${BLUE}▶ 等待后端就绪…${NC}\n"
for i in $(seq 1 30); do
    if curl -s -o /dev/null -w "" "http://localhost:$BACKEND_PORT/health" 2>/dev/null; then
        if curl -s "http://localhost:$BACKEND_PORT/health" 2>/dev/null | grep -q healthy; then
            printf "${GREEN}✔  后端已就绪${NC}\n"
            break
        fi
    fi
    sleep 0.3
done

printf "${BLUE}▶ 等待前端就绪…${NC}\n"
for i in $(seq 1 60); do
    if curl -s -o /dev/null "http://localhost:$VITE_PORT/" 2>/dev/null; then
        printf "${GREEN}✔  前端已就绪${NC}\n"
        break
    fi
    sleep 0.3
done

printf "\n${GREEN}══════════════════════════════════════════════\n"
printf "  ✔ NoteBi 已启动\n"
printf "══════════════════════════════════════════════${NC}\n"
printf "  前端:   http://localhost:%s\n" "$VITE_PORT"
printf "  后端:   http://localhost:%s\n" "$BACKEND_PORT"
printf "  日志:   tail -f .local/backend.log .local/frontend.log\n"
printf "  停止:   ./stop-notebi.command\n"
