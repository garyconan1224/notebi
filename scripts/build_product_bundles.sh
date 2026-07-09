#!/usr/bin/env bash
# Build the three product-mode frontend bundles into product-builds/.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="$ROOT_DIR/.venv/bin/python"
if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="python3"
fi

BUILD_ROOT="$ROOT_DIR/product-builds"
MODES=(nibi notebi replicabi)

cd "$ROOT_DIR"
mkdir -p "$BUILD_ROOT"

for mode in "${MODES[@]}"; do
  target="$BUILD_ROOT/$mode"
  echo "==> Building $mode -> $target"
  VITE_PRODUCT_MODE="$mode" pnpm --dir frontend build
  "$PYTHON_BIN" - "$ROOT_DIR/frontend/dist" "$target" <<'PY'
import shutil
import sys
from pathlib import Path

src = Path(sys.argv[1]).resolve()
dst = Path(sys.argv[2]).resolve()
if not src.is_dir():
    raise SystemExit(f"missing frontend dist: {src}")

allowed_root = dst.parent
if dst.name not in {"nibi", "notebi", "replicabi"} or dst.parent.name != "product-builds":
    raise SystemExit(f"refusing to replace unexpected target: {dst}")

if dst.exists():
    shutil.rmtree(dst)
allowed_root.mkdir(parents=True, exist_ok=True)
shutil.copytree(src, dst)
PY
done

cat <<EOF

Built product bundles:
  $BUILD_ROOT/nibi
  $BUILD_ROOT/notebi
  $BUILD_ROOT/replicabi
EOF
