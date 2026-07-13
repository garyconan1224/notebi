#!/bin/bash
# ══════════════════════════════════════════════════════════════════
#  NoteBi 一键启动器  v1.0
#  ─ 完全可移植，无硬编码路径 ─
#  ─ 自动检测并安装：Homebrew / Python 3.10+ / ffmpeg / Node.js ─
#  ─ Python 虚拟环境隔离依赖，换电脑开箱即用 ─
# ══════════════════════════════════════════════════════════════════

# ── 项目路径（自动检测，无需修改）──────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
PROJECT="$SCRIPT_DIR"
VENV_DIR="$PROJECT/.venv"
FRONTEND_DIR="$PROJECT/frontend"
mkdir -p "$PROJECT/.local"

# ── 颜色输出 ─────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
info()    { printf "${BLUE}ℹ  %s${NC}\n" "$*"; }
ok()      { printf "${GREEN}✔  %s${NC}\n" "$*"; }
warn()    { printf "${YELLOW}⚠  %s${NC}\n" "$*"; }
fail()    { printf "${RED}✘  %s${NC}\n" "$*" >&2; }
section() { printf "\n${BOLD}${BLUE}▶ %s${NC}\n" "$*"; }

printf "\n${BOLD}══════════════════════════════════════════════${NC}\n"
printf "${BOLD}   NoteBi 启动器   %s${NC}\n" "$(date '+%Y-%m-%d %H:%M:%S')"
printf "${BOLD}══════════════════════════════════════════════${NC}\n"
info "项目目录: $PROJECT"

# ══════════════════════════════════════════════════════════════════
# 1. Homebrew
# ══════════════════════════════════════════════════════════════════
section "检测 Homebrew"

# Apple Silicon 在 /opt/homebrew，Intel 在 /usr/local
for _p in /opt/homebrew/bin /usr/local/bin; do
    [[ -x "$_p/brew" ]] && export PATH="$_p:$PATH" && break
done

if ! command -v brew &>/dev/null; then
    warn "Homebrew 未安装，正在安装（需要网络，可能需要几分钟）..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # 安装后重新探测路径
    for _p in /opt/homebrew/bin /usr/local/bin; do
        [[ -x "$_p/brew" ]] && export PATH="$_p:$PATH" && break
    done
    ok "Homebrew 安装完成"
else
    ok "Homebrew: $(brew --version 2>/dev/null | head -1)"
fi

# ══════════════════════════════════════════════════════════════════
# 2. Python 3.10+
# ══════════════════════════════════════════════════════════════════
section "检测 Python"

PYTHON_BIN=""
for _py in python3.12 python3.11 python3.10; do
    if command -v "$_py" &>/dev/null; then
        _ver=$("$_py" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null || true)
        _maj="${_ver%%.*}"; _min="${_ver##*.}"
        if [[ "$_maj" -ge 3 && "$_min" -ge 10 ]]; then
            PYTHON_BIN="$_py"; break
        fi
    fi
done

# 也检查 brew prefix 下的路径
if [[ -z "$PYTHON_BIN" ]] && command -v brew &>/dev/null; then
    for _ver in 3.12 3.11 3.10; do
        _p="$(brew --prefix "python@$_ver" 2>/dev/null)/bin/python$_ver"
        if [[ -x "$_p" ]]; then
            export PATH="$(dirname "$_p"):$PATH"
            PYTHON_BIN="python$_ver"; break
        fi
    done
fi

if [[ -z "$PYTHON_BIN" ]]; then
    warn "Python 3.10+ 未找到，通过 Homebrew 安装 python@3.11..."
    brew install python@3.11
    export PATH="$(brew --prefix python@3.11)/bin:$PATH"
    PYTHON_BIN="python3.11"
    ok "Python 3.11 安装完成"
else
    ok "Python: $PYTHON_BIN ($($PYTHON_BIN --version 2>&1))"
fi

# ══════════════════════════════════════════════════════════════════
# 3. ffmpeg
# ══════════════════════════════════════════════════════════════════
section "检测 ffmpeg"

if ! command -v ffmpeg &>/dev/null; then
    warn "ffmpeg 未安装，通过 Homebrew 安装（视频处理必需）..."
    brew install ffmpeg
    ok "ffmpeg 安装完成"
else
    ok "ffmpeg: $(ffmpeg -version 2>&1 | head -1 | grep -oE 'version [^ ]+' || echo '已安装')"
fi

# ══════════════════════════════════════════════════════════════════
# 4. Node.js
# ══════════════════════════════════════════════════════════════════
section "检测 Node.js"

if ! command -v node &>/dev/null; then
    warn "Node.js 未安装，通过 Homebrew 安装..."
    brew install node
    # brew 安装的 node 可能不在 PATH，手动追加
    export PATH="$(brew --prefix node)/bin:$PATH"
    ok "Node.js 安装完成"
else
    ok "Node.js: $(node --version)"
fi

if ! command -v npm &>/dev/null; then
    fail "npm 未找到，尝试重新安装 Node.js..."
    brew reinstall node
fi

# pnpm（可选，前端优先使用）
if ! command -v pnpm &>/dev/null; then
    info "安装 pnpm 包管理器..."
    npm install -g pnpm --silent && ok "pnpm 安装完成" || warn "pnpm 安装失败，将使用 npm"
else
    ok "pnpm: $(pnpm --version)"
fi

# ══════════════════════════════════════════════════════════════════
# 5. Python 虚拟环境
# ══════════════════════════════════════════════════════════════════
section "Python 虚拟环境"

if [[ ! -d "$VENV_DIR" ]]; then
    info "创建虚拟环境: .venv"
    "$PYTHON_BIN" -m venv "$VENV_DIR"
    ok "虚拟环境已创建"
else
    ok "虚拟环境已存在: .venv"
fi

PY="$VENV_DIR/bin/python"
PIP="$VENV_DIR/bin/pip"

# ══════════════════════════════════════════════════════════════════
# 6. Python 依赖
# ══════════════════════════════════════════════════════════════════
section "Python 依赖"

STAMP="$VENV_DIR/.deps_stamp"
NEEDS_INSTALL=0

if [[ ! -f "$STAMP" ]]; then
    NEEDS_INSTALL=1
elif [[ "$PROJECT/requirements.txt" -nt "$STAMP" ]]; then
    warn "requirements.txt 已更新，重新安装依赖..."
    NEEDS_INSTALL=1
else
    # 快速验证核心模块
    for _mod in fastapi uvicorn pydantic httpx psutil; do
        if ! "$PY" -c "import $_mod" &>/dev/null; then
            warn "模块缺失: $_mod"
            NEEDS_INSTALL=1; break
        fi
    done
fi

if [[ "$NEEDS_INSTALL" -eq 1 ]]; then
    info "安装 Python 依赖（首次可能需要 3-5 分钟）..."
    "$PIP" install --upgrade pip --quiet
    "$PIP" install -r "$PROJECT/requirements.txt"
    touch "$STAMP"
    ok "Python 依赖安装完成"
else
    ok "Python 依赖已就绪"
fi

# ══════════════════════════════════════════════════════════════════
# 7. 前端依赖
# ══════════════════════════════════════════════════════════════════
section "前端依赖"

# 架构检测：从其他电脑复制的 node_modules 含有平台原生 binding，
# 在新架构上无法运行，需要删除重装
ARCH_STAMP="$FRONTEND_DIR/node_modules/.arch_stamp"
CURRENT_ARCH="$(uname -m)"  # arm64 / x86_64

_frontend_install() {
    cd "$FRONTEND_DIR"
    rm -f package-lock.json  # 避免 npm/pnpm 冲突
    if command -v pnpm &>/dev/null; then
        pnpm install
    else
        npm install
    fi
    echo "$CURRENT_ARCH" > "$ARCH_STAMP"
    cd "$PROJECT"
    ok "前端依赖安装完成"
}

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    warn "frontend/node_modules 不存在，正在安装..."
    _frontend_install
elif [[ ! -f "$ARCH_STAMP" ]] || [[ "$(cat "$ARCH_STAMP" 2>/dev/null)" != "$CURRENT_ARCH" ]]; then
    warn "检测到 node_modules 来自其他架构（$(cat "$ARCH_STAMP" 2>/dev/null || echo '未知') → $CURRENT_ARCH），重新安装..."
    rm -rf "$FRONTEND_DIR/node_modules"
    _frontend_install
else
    ok "前端依赖已就绪 (${CURRENT_ARCH})"
fi

# ══════════════════════════════════════════════════════════════════
# 8. 环境配置文件 (.env)
# ══════════════════════════════════════════════════════════════════
section "环境配置"

if [[ ! -f "$PROJECT/.env" ]]; then
    if [[ -f "$PROJECT/.env.example" ]]; then
        cp "$PROJECT/.env.example" "$PROJECT/.env"
        printf "\n${YELLOW}"
        printf "  ┌────────────────────────────────────────────┐\n"
        printf "  │  ⚠  .env 已从模板创建，请填写 API Key！    │\n"
        printf "  │  文件: %-36s│\n" "$PROJECT/.env"
        printf "  └────────────────────────────────────────────┘\n"
        printf "${NC}\n"
        read -r -p "    已了解，按回车继续启动..."
    fi
else
    ok ".env 配置文件已存在"
fi

# 加载环境变量
if [[ -f "$PROJECT/.env" ]]; then
    set -a; source "$PROJECT/.env"; set +a
fi
VITE_PRODUCT_MODE="notebi"
VITE_PORT="${VITE_PORT:-5181}"
BACKEND_PORT="${BACKEND_PORT:-8001}"
VITE_BACKEND_PORT="${VITE_BACKEND_PORT:-$BACKEND_PORT}"
info "后端端口: $BACKEND_PORT  |  前端端口: $VITE_PORT"

# ══════════════════════════════════════════════════════════════════
# 9. 端口清理
# ══════════════════════════════════════════════════════════════════
section "端口检测"

for _port in "$BACKEND_PORT" "$VITE_PORT"; do
    _pids=$(lsof -iTCP:"$_port" -sTCP:LISTEN -n -P 2>/dev/null | awk 'NR>1{print $2}' | sort -u || true)
    if [[ -n "$_pids" ]]; then
        warn "端口 $_port 被占用，正在清理..."
        for _pid in $_pids; do kill -9 "$_pid" 2>/dev/null || true; done
        sleep 0.3
        ok "端口 $_port 已清理"
    else
        ok "端口 $_port 空闲"
    fi
done

# ══════════════════════════════════════════════════════════════════
# 10. 启动服务
# ══════════════════════════════════════════════════════════════════
section "启动服务"

cd "$PROJECT"

# 后端（输出写入日志文件）
"$PY" -m uvicorn backend.app.main:app --reload --port "$BACKEND_PORT" \
    > "$PROJECT/.local/backend.log" 2>&1 &
BACKEND_PID=$!
ok "后端已启动 (端口: $BACKEND_PORT, PID: $BACKEND_PID)"
info "后端日志: .local/backend.log"

sleep 2

# 前端（输出写入日志文件）
cd "$FRONTEND_DIR"
VITE_PRODUCT_MODE="$VITE_PRODUCT_MODE" \
VITE_BACKEND_PORT="$VITE_BACKEND_PORT" \
VITE_BACKEND_BASE_URL="http://127.0.0.1:$BACKEND_PORT" \
    npm run dev > "$PROJECT/.local/frontend.log" 2>&1 &
FRONTEND_PID=$!
ok "前端已启动 (PID: $FRONTEND_PID)"
info "前端日志: .local/frontend.log"
cd "$PROJECT"

sleep 2

# ── 完成提示 ─────────────────────────────────────────────────────
printf "\n${BOLD}══════════════════════════════════════════════${NC}\n"
printf "  ${GREEN}✔  前端地址:${NC} http://localhost:${VITE_PORT}\n"
printf "  ${GREEN}✔  后端地址:${NC} http://localhost:${BACKEND_PORT}\n"
printf "  ${BLUE}ℹ  后端日志:${NC} .local/backend.log\n"
printf "  ${BLUE}ℹ  前端日志:${NC} .local/frontend.log\n"
printf "${BOLD}══════════════════════════════════════════════${NC}\n\n"

# 自动打开浏览器
open "http://localhost:$VITE_PORT" 2>/dev/null || true

printf "按 ${BOLD}Ctrl+C${NC} 关闭全部服务...\n\n"

cleanup() {
    printf "\n正在关闭服务...\n"
    kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
    ok "全部服务已关闭"
}
trap cleanup INT TERM
wait
