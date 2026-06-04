#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo ""
echo "  =========================================="
echo "   Jokowi TTS Backend  |  http://localhost:8000"
echo "  =========================================="
echo ""

# ── Check Python ────────────────────────────────────────────
PYTHON=""
for candidate in python3.11 python3.10 python3 python; do
  if command -v "$candidate" &>/dev/null; then
    PYTHON="$candidate"
    break
  fi
done

if [[ -z "$PYTHON" ]]; then
  echo "  [ERROR] Python not found. Install Python 3.10 or 3.11."
  exit 1
fi

PY_VER=$("$PYTHON" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "  Using Python $PY_VER ($PYTHON)"

# ── Create virtual environment if missing ───────────────────
if [[ ! -d ".venv" ]]; then
  echo "  [1/3] Creating virtual environment..."
  "$PYTHON" -m venv .venv
fi

# ── Activate venv ───────────────────────────────────────────
# shellcheck disable=SC1091
source .venv/bin/activate

# ── Install / update dependencies ───────────────────────────
echo "  [2/3] Installing dependencies (first run may take a few minutes)..."
echo ""

# Detect OS for appropriate torch install
OS="$(uname -s)"
if [[ "$OS" == "Darwin" ]]; then
  # macOS — CPU only (MPS support comes from torch itself, no special index needed)
  pip install torch torchaudio --quiet
else
  # Linux CPU-only (change to cu121 if you have an NVIDIA GPU)
  pip install torch torchaudio \
    --index-url https://download.pytorch.org/whl/cpu \
    --quiet
fi

pip install -r requirements.txt --quiet

echo ""
echo "  [3/3] Starting server..."
echo ""
echo "  Open http://localhost:8000/docs for interactive API docs."
echo "  Press Ctrl+C to stop."
echo ""

# ── Start server ─────────────────────────────────────────────
python main.py
