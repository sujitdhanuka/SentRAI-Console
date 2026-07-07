source .venv/bin/activate
uvicorn sentrai.main:app --app-dir src --reload --port 8000
