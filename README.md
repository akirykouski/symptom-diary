# Symptom Diary

A local, multimodal symptom diary with graph visualization and a background hypothesis engine for rare diseases. Everything runs locally — no outbound network except localhost Ollama.

## Status

**MVP-5** — everything from MVP-4 plus a **PWA mobile capture companion**
(scan a QR with a phone, take photos straight into the journal, IndexedDB
outbox queues drafts when the LAN drops) and a **Hypothesis Engine learning
loop** (dismissals suppress for 60 days unless the score grows ≥ 30%;
confirmed diseases pin to the top and get a ×1.25 boost; per-entry "doctor
agreed" corroboration shows up in the brief).

The full roadmap lives in `../symptom-diary-plan (1).md`.

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
- **Clinician brief** (`/insights`) — markdown + printable HTML + downloadable
  PDF (via optional WeasyPrint extra; gracefully falls back to a downloadable
  HTML attachment when WeasyPrint isn't installed). Episodes, top entities,
  abnormal labs, medications, and "Patterns AI noticed for clinician's
  consideration" block.
- **Ask-anything Q&A** (`/insights` → ask box) — every answer cites the
  underlying journal entries as inline `[entry-<prefix>]` pills; a red-flag
  refusal layer short-circuits prompts about dosing, self-harm, emergencies,
  diagnostic certainty, or pregnancy + medication safety *before* the LLM is
  called. Hedged-language and citation enforcement on the model output, with
  a deterministic grounded-summary fallback when Ollama is unavailable or the
  output fails the safety filter.
- **Encrypted `.diary` bundle export/import** — single-file backup containing
  the SQLCipher database, salt, manifest, and encrypted media tree. Bundle is
  cryptographically opaque without the passphrase. Restore-from-bundle option
  on the Setup screen.
- **In-clinic QR share** — generate a one-time URL + QR code (5–30 min TTL,
  read-only, scoped to the brief) so a clinician can scan it from a phone on
  the same WiFi and view the brief in their own browser. Locking the journal
  immediately invalidates active share links.
- **Mobile capture companion (PWA)** — pair a phone via QR; the phone lands
  on a focused capture page (camera shutter + optional note) that uploads
  photos directly into the journal. IndexedDB outbox queues drafts when the
  LAN drops and auto-flushes when reachable. Mobile sessions live as long as
  the desktop is unlocked; locking the journal invalidates every paired phone.
- **Hypothesis Engine learning loop** — Confirm/Dismiss actions on patterns
  feed back into matching: dismissed diseases get a 60-day cooldown unless
  the new aggregate score exceeds the dismissal score by 30%; confirmed
  diseases pin to the top of the list with a ★ badge and a ×1.25 score
  boost; users can mark individual citations as "doctor agreed", which
  carries a ✓ marker into the printed brief.
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
# 118 passed
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

## Fine-tuned extractor (optional)

The entity-extraction stage ships in two modes:

1. **Default** — backend calls vanilla Gemma via Ollama with a prompt that
   asks for the `{entities, ts_event_hint}` JSON schema. Works out of the
   box, fewer dependencies.
2. **Fine-tuned sidecar** — a local FastAPI service on `:11435` wrapping
   `unsloth/gemma-4-e4b-it` + the Clario LoRA adapter
   (`m0rtyddd/clario-gemma4-e4b-lora-v2` on HuggingFace) + an HPO synonym
   index. Schema correctness 0 → 100 %, synonym-aware name F1 0.209 →
   0.524, HPO ID F1 via name→lookup 0.349 → 0.524, all measured against a
   held-out-by-disease eval set. Full numbers and limitations live in
   the model card.

### Running the sidecar

Requires a CUDA GPU with ~6 GB free VRAM. The adapter (~70 MB) is pulled
from HuggingFace Hub on first run.

```bash
cd backend
pip install -e .[extractor]

# Optional: build the HPO synonym index so the sidecar can resolve
# canonical names -> HPO IDs. Without it the sidecar still works but
# omits hpo_id from extracted entities.
#   - hp.obo:           http://purl.obolibrary.org/obo/hp.obo
#   - en_product4.xml:  https://www.orphadata.com/data/xml/en_product4.xml
python -m scripts.build_knowledge \
    --hpo-obo path/to/hp.obo \
    --orphanet-xml path/to/en_product4.xml \
    --out data/disease_knowledge.json

# Start the sidecar (loads adapter from HF Hub, ~60 s).
CLARIO_KNOWLEDGE_PATH=data/disease_knowledge.json \
    python -m scripts.clario_extractor_service
```

Then start the backend with `CLARIO_EXTRACTOR_URL=http://127.0.0.1:11435`
pointing at the sidecar — `backend/diary/extraction.py` will delegate
extraction to it. Embeddings still go to Ollama.

| Env var | Default | Purpose |
|---|---|---|
| `CLARIO_ADAPTER` | `m0rtyddd/clario-gemma4-e4b-lora-v2` | HF repo ID or local path |
| `CLARIO_EXTRACTOR_PORT` | `11435` | sidecar bind port |
| `CLARIO_KNOWLEDGE_PATH` | *(unset)* | path to `disease_knowledge.json` |
| `CLARIO_EXTRACTOR_URL` | *(unset)* | backend uses sidecar when set |

### Published artefacts

- Model: <https://huggingface.co/m0rtyddd/clario-gemma4-e4b-lora-v2>
- Dataset: <https://huggingface.co/datasets/m0rtyddd/clario-synthetic-diary>

Both are CC-BY-4.0 (propagated from HPO + Orphanet attribution).

## Roadmap

See `../symptom-diary-plan (1).md`. Remaining work:
- **Document extraction LoRA** on Orphanet/PMC pairs (sibling to the
  diary-extraction LoRA shipped above).
- **Real Orphanet XML sync** to grow the curated KB beyond the ~40 seed
  conditions.
- **Polish** — PyInstaller .exe, Tauri shell, code-signing.
