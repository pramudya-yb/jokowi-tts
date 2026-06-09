@echo off
cd /d "%~dp0"
title Jokowi TTS Backend

echo.
echo  ============================================
echo   Jokowi TTS Backend - http://localhost:8000
echo  ============================================
echo.

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found.
    echo Install Python 3.10 or 3.11 from https://python.org
    echo During install, check "Add Python to PATH"
    echo.
    pause
    exit /b 1
)

python --version
echo.

:: Create virtual environment if missing
if not exist ".venv" (
    echo [1/3] Creating virtual environment...
    python -m venv .venv
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo Done.
    echo.
)

:: Activate venv
call .venv\Scripts\activate.bat
if errorlevel 1 (
    echo [ERROR] Failed to activate virtual environment.
    pause
    exit /b 1
)

:: Install dependencies
echo [2/3] Installing dependencies...
echo First run downloads PyTorch (~200MB) - this may take several minutes.
echo.

pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu -q
if errorlevel 1 (
    echo [ERROR] Failed to install PyTorch.
    echo Check your internet connection and try again.
    pause
    exit /b 1
)

pip install -r requirements.txt -q
if errorlevel 1 (
    echo [ERROR] Failed to install requirements.
    pause
    exit /b 1
)

echo Dependencies ready.
echo.

:: Start server
echo [3/3] Starting server...
echo.
echo  API docs : http://localhost:8000/docs
echo  Health   : http://localhost:8000/health
echo.
echo Press Ctrl+C to stop.
echo.

python main.py

echo.
echo Server stopped.
pause