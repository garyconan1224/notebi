#!/bin/bash
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
exec "$ROOT_DIR/start-notebi.command" "$@"
