@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Jokowi TTS — Backend

echo.
echo  ==========================================
echo   Jokowi TTS Backend  ^|  http://localhost:8000
echo  ==========================================
echo.

:: ── Check Python ────────────────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
  echo  [ERROR] Python not found. Install Python 3.10 or 3.11 from python.org
  pause & exit /b 1
)

:: ── Create virtual environment if missing ───────────────────
if not exist ".venv" (
  echo  [1/3] Creating virtual environment...
  python -m venv .venv
  if errorlevel 1 ( echo  [ERROR] Failed to create venv. & pause & exit /b 1 )
)

:: ── Activate venv ───────────────────────────────────────────
call .venv\Scripts\activate.bat
if errorlevel 1 ( echo  [ERROR] Failed to activate venv. & pause & exit /b 1 )

:: ── Install / update dependencies ───────────────────────────
echo  [2/3] Installing dependencies (first run may take a few minutes)...
echo.

:: CPU-only PyTorch (works on all Windows machines)
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu --quiet

:: If you have an NVIDIA GPU, comment the line above and uncomment this:
:: pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121 --quiet

pip install -r requirements.txt --quiet
if errorlevel 1 ( echo  [ERROR] pip install failed. Check your internet connection. & pause & exit /b 1 )

echo.
echo  [3/3] Starting server...
echo.
echo  Open http://localhost:8000/docs for the interactive API docs.
echo  Press Ctrl+C to stop the server.
echo.

:: ── Start server ─────────────────────────────────────────────
python main.py

echo.
echo  Server stopped.
pause
