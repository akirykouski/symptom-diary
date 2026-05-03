# Symptom Diary

A local, multimodal symptom diary with graph visualization and a background hypothesis engine for rare diseases. Everything runs locally — no outbound network except localhost Ollama.

## Status

**MVP-1** — encrypted local journal + Ollama-driven entity extraction + graph. The full roadmap lives in `../symptom-diary-plan (1).md`.

## What works today

- Single-user, single-passphrase encrypted journal (SQLCipher / Argon2id)
- 15-minute auto-lock on inactivity
- Markdown entries, mood (-2…+2), severity (0–10), tags + filterable timeline
- **Ollama integration through the in-app `/llm` page** — see status, pull models with streaming progress, target the model the extractor uses
- **Background extraction worker** — every entry enqueues a job; the worker
  asks Gemma for `{entities, ts_event_hint}` JSON, embeds with `nomic-embed-text`,
  canonicalizes via cosine search on `sqlite-vec`, builds `co_occurs` and
  `precedes` edges
- **Force-directed graph** (`/graph`) — entities colored by type, click for
  details + recent mentions + neighbors; right-click to focus; rename / merge / delete
- Queue indicator on the timeline; "Re-extract" button on every entry
- React + Vite + i18n (English; RU/IT slots ready)

## Prerequisites

### Windows (primary target)

- Python 3.12 ([python.org](https://www.python.org/downloads/))
- Node 20+ ([nodejs.org](https://nodejs.org/))
- `pip install uv`
- `npm i -g pnpm` (optional — `npm` works too)

The Windows wheel for `sqlcipher3-binary` is bundled — no native build step.

### macOS / Linux (dev)

The `sqlcipher3` source package builds against system SQLCipher.

```bash
brew install sqlcipher                # macOS
# sudo apt install libsqlcipher-dev   # Debian/Ubuntu

export SQLCIPHER_PATH=$(brew --prefix sqlcipher)
export CFLAGS="-I${SQLCIPHER_PATH}/include -I${SQLCIPHER_PATH}/include/sqlcipher"
export LDFLAGS="-L${SQLCIPHER_PATH}/lib"
```

## Run (dev)

### Backend → http://localhost:8765

```bash
cd backend
uv venv --python 3.12
uv pip install -e ".[dev]"
uv run python -m diary
```

### Frontend → http://localhost:5173

```bash
cd frontend
npm install            # or pnpm install
npm run dev
```

Open http://localhost:5173 — pick a passphrase and start journaling. Vite proxies `/api/*` to the backend.

### Ollama (for AI features)

```bash
# install once: https://ollama.com
ollama serve            # listens on localhost:11434
```

In the app, click "AI" in the timeline header. The page shows whether Ollama is reachable and lets you pull the extractor + embedder models with a live progress bar. Override the default model name with:

```bash
DIARY_LLM_MODEL=gemma3:4b ./run-backend.sh   # or any Ollama tag you have
```

If Ollama is offline the extraction worker still records jobs as `failed`; once you start Ollama and click "Re-extract" on an entry, processing resumes.

## Storage

- DB: `~/.symptom-diary/data/diary.sqlite` (SQLCipher-encrypted)
- Salt: `~/.symptom-diary/data/diary.salt`
- Override with `DIARY_DATA_DIR=/some/path`

There is **no recovery**. If you lose the passphrase, the data is gone.

## Tests

```bash
cd backend
.venv/bin/pytest -q
# 12 passed
```

## Smoke checklist (manual UI test)

1. Fresh setup
   - Wipe `~/.symptom-diary/data/`
   - `npm run dev` + backend running
   - Open localhost:5173 → Setup screen appears
   - Enter passphrase ≥12 chars, confirm, submit → redirected to empty Timeline
2. Tags
   - Click "Tags" → create one (e.g. `head`, color red)
   - Back to timeline → the tag appears as a filter chip
3. Entry
   - Click "New entry" → editor modal opens
   - Pick a date/time, write markdown text, set mood/severity, tag it
   - Save → bar appears on the timeline
4. Edit + delete
   - Click the timeline item → editor reopens with values preloaded
   - Edit text, save → updated tooltip
   - Open again → Delete → bar disappears
5. Lock + unlock
   - Click "Lock" → returns to Unlock screen
   - Wrong passphrase → red "Wrong passphrase"
   - Correct passphrase → entries reappear unchanged
6. Encryption at rest
   - With backend stopped, run `file ~/.symptom-diary/data/diary.sqlite`
   - Output: `data` (not `SQLite 3.x database`)
   - `sqlite3 ~/.symptom-diary/data/diary.sqlite .tables` → `Error: file is not a database`

## Project layout

```
symptom-diary/
├── backend/
│   ├── diary/
│   │   ├── app.py          # FastAPI factory + CORS
│   │   ├── config.py       # paths, env, constants
│   │   ├── crypto.py       # Argon2id + HKDF
│   │   ├── db.py           # SQLCipher connection + migrations
│   │   ├── deps.py         # require_unlocked dependency
│   │   ├── models.py       # Pydantic schemas
│   │   ├── session.py      # in-memory unlock state, auto-lock
│   │   ├── migrations/001_init.sql
│   │   └── routes/
│   │       ├── auth.py
│   │       ├── entries.py
│   │       └── tags.py
│   └── tests/
└── frontend/
    └── src/
        ├── api/client.ts
        ├── i18n/{index.ts, locales/en.json}
        ├── components/{EntryEditor, TimelineView, TagPicker}.tsx
        └── pages/{Setup, Unlock, Timeline, Tags}.tsx
```

## Roadmap

See `../symptom-diary-plan (1).md`. Next phase is MVP-1: Ollama integration, entity extraction, force-directed graph.
