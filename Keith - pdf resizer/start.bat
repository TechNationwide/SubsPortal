@echo off
cd /d "%~dp0"
if not exist "venv" (
  echo Creating virtual environment...
  python -m venv venv
)
call venv\Scripts\activate.bat
pip install -r requirements.txt -q
echo.
echo Starting PDF Resizer at http://127.0.0.1:8000
echo.
cd backend
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
