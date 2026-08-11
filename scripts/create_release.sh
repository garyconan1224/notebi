#!/bin/bash

set -euo pipefail

VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
    echo "错误：未指定版本号"
    echo "用法：bash scripts/create_release.sh <version>"
    echo "示例：bash scripts/create_release.sh v0.3.0"
    exit 1
fi

if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "错误：版本号必须使用 vX.Y.Z 格式"
    exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "NoteBi 版本发布检查"
echo "目标版本：$VERSION"

STATUS="$(git status --porcelain --untracked-files=all)"
if [[ -n "$STATUS" ]]; then
    echo "错误：工作树不干净，以下文件不会被自动暂存："
    echo "$STATUS"
    exit 1
fi

if git rev-parse -q --verify "refs/tags/$VERSION" >/dev/null; then
    echo "错误：Git tag 已存在：$VERSION"
    exit 1
fi

PACKAGE_VERSION="$(
    sed -nE 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' \
        frontend/package.json | head -1
)"
if [[ "$PACKAGE_VERSION" != "${VERSION#v}" ]]; then
    echo "错误：frontend/package.json 版本为 $PACKAGE_VERSION，与 $VERSION 不一致"
    exit 1
fi

if [[ -x .venv/bin/python ]]; then
    PYTHON_BIN=".venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python3)"
else
    echo "错误：未找到 Python 3"
    exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
    echo "错误：未找到 pnpm"
    exit 1
fi

echo "运行源码与代码检查..."
"$PYTHON_BIN" scripts/source_preflight.py --root .
"$PYTHON_BIN" -m compileall -q backend shared scripts
git diff --check

echo "运行后端测试..."
"$PYTHON_BIN" -m pytest backend/tests -q

echo "运行前端测试与构建..."
pnpm --dir frontend test --run
pnpm --dir frontend build

git tag -a "$VERSION" -m "NoteBi $VERSION"

echo "版本检查通过，已在当前 commit 创建本地 tag：$VERSION"
echo "当前 commit：$(git rev-parse --short HEAD)"
echo "脚本没有创建 commit，也没有推送远端。"
