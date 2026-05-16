#!/usr/bin/env bash
# Clario / Symptom Diary - one-command launcher (macOS / Linux)
#
#   ./run.sh            # first run sets everything up, then launches
#   ./run.sh --rebuild  # force a fresh deps install + UI rebuild
#
# Everything is local; nothing leaves your machine.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
PORT="${DIARY_PORT:-8765}"
URL="http://127.0.0.1:$PORT/"
REBUILD=0
[[ "${1:-}" == "--rebuild" || "${1:-}" == "-r" ]] && REBUILD=1

cyan()  { printf '  \033[36m%s\033[0m\n' "$1"; }
green() { printf '  \033[32m%s\033[0m\n' "$1"; }
die()   { printf '\n  \033[31m%s\033[0m\n\n' "$1"; exit 1; }

echo ""
printf '  \033[97mClario - local encrypted symptom diary\033[0m\n'
printf '  \033[90m---------------------------------------\033[0m\n'

# --- locate Python 3.12+ -------------------------------------------------
PY=""
for c in python3.12 python3 python; do
  if command -v "$c" >/dev/null 2>&1; then
    v="$("$c" -c 'import sys;print("%d.%d"%sys.version_info[:2])' 2>/dev/null || echo 0.0)"
    if [ "$(printf '%s\n3.12\n' "$v" | sort -V | head -1)" = "3.12" ]; then PY="$c"; break; fi
  fi
done
[ -n "$PY" ] || die "Python 3.12+ is required. Install it from https://www.python.org/downloads/ and re-run."
green "Python found ($PY)"

# macOS/Linux build sqlcipher3 from source against system SQLCipher.
if [ "$(uname)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
  if brew --prefix sqlcipher >/dev/null 2>&1; then
    SQ="$(brew --prefix sqlcipher)"
    export CFLAGS="-I${SQ}/include -I${SQ}/include/sqlcipher ${CFLAGS:-}"
    export LDFLAGS="-L${SQ}/lib ${LDFLAGS:-}"
  fi
fi

# --- backend venv + deps -------------------------------------------------
VENV="$BACKEND/.venv"
VENVPY="$VENV/bin/python"
MARKER="$VENV/.deps-installed"

if [ ! -x "$VENVPY" ]; then
  cyan "Creating Python environment (first run, ~1 min)..."
  "$PY" -m venv "$VENV"
fi

if [ "$REBUILD" = 1 ] || [ ! -f "$MARKER" ]; then
  cyan "Installing backend dependencies..."
  "$VENVPY" -m pip install --quiet --upgrade pip
  ( cd "$BACKEND" && "$VENVPY" -m pip install --quiet -e . ) || die "Backend install failed (see output above). On Linux you may need: sudo apt install libsqlcipher-dev"
  touch "$MARKER"
  green "Backend ready"
else
  green "Backend ready (cached)"
fi

# --- frontend build ------------------------------------------------------
if [ "$REBUILD" = 1 ] || [ ! -f "$FRONTEND/dist/index.html" ]; then
  command -v npm >/dev/null 2>&1 || die "Node.js 20+ is required to build the interface (first run only). Install from https://nodejs.org/ and re-run."
  if [ "$REBUILD" = 1 ] || [ ! -d "$FRONTEND/node_modules" ]; then
    cyan "Installing interface dependencies (first run, ~1 min)..."
    ( cd "$FRONTEND" && npm install --no-audit --no-fund --loglevel=error )
  fi
  cyan "Building the interface..."
  ( cd "$FRONTEND" && npm run build )
  green "Interface built"
else
  green "Interface built (cached)"
fi

# --- open browser when the server is ready -------------------------------
(
  for _ in $(seq 1 90); do
    if curl -fsS "${URL}api/health" >/dev/null 2>&1; then
      if command -v open >/dev/null 2>&1; then open "$URL"
      elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true
      fi
      break
    fi
    sleep 0.7
  done
) &

echo ""
green "Starting Clario at $URL"
cyan "Keep this window open. Press Ctrl+C to stop."
echo ""

export DIARY_HOST="127.0.0.1"
export DIARY_PORT="$PORT"
cd "$BACKEND"
exec "$VENVPY" -m diary
