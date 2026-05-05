# Symptom Diary

A local, multimodal symptom diary with graph visualization and a background hypothesis engine for rare diseases. Everything runs locally — no outbound network except localhost Ollama.

## Status

**MVP-3** — encrypted local journal + Ollama-driven entity extraction + graph + multimodal capture + **Hypothesis Engine** + **clinician brief** + curated synthetic patients. The full roadmap lives in `../symptom-diary-plan (1).md`.

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
- **Encrypted media attachments** (libsodium secretstream + HKDF subkey from passphrase)
  - **Photos** — EXIF-stripped, resized, decrypted on-stream; vision Gemma writes a
    short caption back into the entry
  - **Audio** — uploaded encrypted; whisper.cpp (if installed) transcribes and
    appends `> [audio transcript]` to the entry
  - **Medical documents** (visit note / lab result / prescription / imaging /
    discharge / referral) — vision Gemma extracts strict JSON which is broken
    out into `document_record`, `lab_value`, `medication_record` rows. UI shows
    an editable confirmation form before marking the document `verified`.
- **Documents page** (`/documents`) — filter by type, drill into AI-extracted fields,
  edit & verify
- **Lab timeline** (`/labs`) — series view per test (e.g. TSH over years), with
  high/low/in-range flags
- **Medications page** (`/medications`) — every prescription extracted from any
  document, sorted by date
- **Hypothesis Engine** (`/hypotheses`) — curated KB of ~40 common + rare disease
  profiles (`backend/diary/data/diseases_seed.json`). Engine builds a "user
  fingerprint" from active entities + abnormal labs, vector-matches against
  disease features, aggregates by frequency-class weight, and writes hedged
  rationales. Three-tier signal pills (weak / moderate / strong), explicit
  citations to journal entries / labs / meds, dismiss / confirm / reactivate,
  graceful fallback when Ollama is unavailable (templated rationale + Jaccard
  matching).
- **Clinician brief** (`/insights`) — markdown + printable HTML version with
  episodes, top entities, abnormal labs, medications, and "Patterns AI noticed
  for clinician's consideration" block.
- **Synthetic reference patients** (`POST /api/demo/load`) — Maria (8mo SLE
  picture), Tom (6mo MCAS picture), Anna (5mo Hashimoto picture). Pre-loaded
  diary text, lab results, prescriptions. One-click loadable from the timeline.
- **Persistent safety banner** restating "not a diagnosis, discuss with a
  clinician" on every screen.
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

The app ships a 3-step bootstrap wizard at `/llm`:

1. **Install Ollama**
   - macOS + Homebrew → one-click `brew install ollama` (streamed live).
   - macOS without Homebrew → "Open download page" link.
   - Linux → official one-liner shown with copy-to-clipboard (it needs sudo, so we don't auto-run it).
   - Windows → "Open download page" link.
2. **Start Ollama** → spawns `ollama serve` as a managed child process; killed automatically when the backend shuts down.
3. **Pull AI models** → existing pull-with-progress UI (`gemma3:4b` + `nomic-embed-text` are good defaults).

If you'd rather start it yourself: `ollama serve` (the wizard auto-detects an externally-started daemon and skips its own spawn). Override the default model with:

```bash
DIARY_LLM_MODEL=gemma3:4b ./run-backend.sh   # or any Ollama tag you have
```

If Ollama is offline the extraction worker still records jobs as `failed`; once you start Ollama and click "Re-extract" on an entry, processing resumes. The same applies to media — if you upload a photo while Ollama is down, the photo is encrypted and stored, and you can click "Re-run AI" once Ollama is up.

### whisper.cpp (audio transcription)

Audio is **always** stored encrypted regardless of whether whisper is available — uploading still works, you just won't get an automatic transcript. To enable transcription:

1. Build or download `whisper-cli` from <https://github.com/ggerganov/whisper.cpp>
2. Download a ggml model (e.g. `ggml-small.bin`)
3. Export both paths before launching the backend:

   ```bash
   export DIARY_WHISPER_BIN=/path/to/whisper-cli
   export DIARY_WHISPER_MODEL=/path/to/ggml-small.bin
   ```

## Storage

- DB: `~/.symptom-diary/data/diary.sqlite` (SQLCipher-encrypted)
- Salt: `~/.symptom-diary/data/diary.salt`
- Media: `~/.symptom-diary/data/media/<entry_id>/<media_id>.enc` (libsodium-encrypted)
- Override with `DIARY_DATA_DIR=/some/path`

There is **no recovery**. If you lose the passphrase, the data is gone.

## Tests

```bash
cd backend
.venv/bin/pytest -q
# 36 passed
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

## Demo

Easiest way to see the Hypothesis Engine working without any data of your own:

1. Set up the journal (Setup screen) — any 12+ char passphrase.
2. Open `/llm` and pull `gemma3:4b` (or another vision-capable Gemma) +
   `nomic-embed-text`. Skipping this still works, but the engine falls back
   to keyword Jaccard and produces fewer / weaker matches.
3. Click **Load demo patient** in the Timeline header → pick Maria.
4. Hit **Patterns** in the header (or `/hypotheses`) → click **Re-check now**.

Maria should produce moderate signals for Systemic Lupus Erythematosus and
Iron-deficiency anemia, with citations back into her diary and lab results.

## Roadmap

See `../symptom-diary-plan (1).md`. Next phases:
- **Unsloth fine-tune** (parallel sponsor track) — entity extraction LoRA + document
  extraction LoRA on Orphanet/PMC pairs.
- **MVP-4** — encrypted bundle export, QR-bridge for in-clinic sharing, real
  Orphanet XML sync to grow the curated KB beyond ~40 conditions.
- **Polish** — PyInstaller .exe, Tauri shell, code-signing.
