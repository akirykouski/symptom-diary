<div align="center">

# Clario · Symptom Diary

**A private, multimodal symptom diary that turns scattered notes, photos, and lab reports into a clinician-ready picture — and quietly flags rare-disease patterns a busy GP might miss.**

*100% local. Encrypted at rest. No account, no cloud, no telemetry — nothing ever leaves the machine except a localhost call to your own AI model.*

`Python 3.12` · `FastAPI` · `React + Vite` · `SQLCipher` · `Ollama` · `fine-tuned Gemma LoRA`

</div>

---

## ▶ Run it in one step

The whole app — backend, AI glue, and UI — runs as **one local process on one URL**.

| Platform | Launch |
|---|---|
| **Windows** | Double-click **`start-windows.bat`** *(or right-click `run.ps1` → Run with PowerShell)* |
| **macOS** | Double-click **`Clario.command`** *(or `./run.sh`)* |
| **Linux** | `./run.sh` |

First run sets everything up (Python env + backend + UI build, ~2 min — needs **Python 3.12+** and **Node 20+**). Every run after that launches instantly and opens your browser at **<http://127.0.0.1:8765>**.

```
./run.sh --rebuild      # macOS/Linux: force a fresh deps install + UI rebuild
.\run.ps1 -Rebuild      # Windows: same
```

To stop: close the window or press `Ctrl+C`. For the AI features, install Ollama from the in-app **AI models** page (one click).

---

## ◆ See it work in 60 seconds (judges start here)

No data of your own required — ship with three synthetic reference patients.

1. **Launch** (above) → pick any 12+ character passphrase on the Setup screen.
2. Open **AI models** (`/llm`) → pull `gemma3:4b` + `nomic-embed-text`. *(Skippable — the engine degrades gracefully to keyword matching, just with weaker signals.)*
3. Timeline header → **Load demo patient** → pick **Maria** (8-month systemic-lupus picture).
4. Header → **Patterns** (`/hypotheses`) → **Re-check now**.

➡ Maria surfaces **moderate signals for Systemic Lupus Erythematosus and iron-deficiency anemia**, each with explicit citations back into her diary entries and lab results. Try **Tom** (MCAS) and **Anna** (Hashimoto) too.

---

## ✦ What makes it interesting

| | |
|---|---|
| **Privacy by construction** | Single passphrase → SQLCipher DB + Argon2id, libsodium-encrypted media, 15-min auto-lock. Lose the passphrase and the data is genuinely gone. |
| **Multimodal capture** | Markdown entries, photos (EXIF-stripped, AI-captioned), audio (whisper.cpp transcription), and medical documents (visit notes / labs / prescriptions / imaging) parsed into structured rows. |
| **Hypothesis Engine** | Curated KB of ~40 common + rare disease profiles. Builds a user "fingerprint" from active entities + abnormal labs, vector-matches disease features, writes **hedged, cited** rationales — never a diagnosis. |
| **Learning loop** | Confirm / Dismiss feeds back: dismissed conditions get a 60-day cooldown unless the score jumps ≥30%; confirmed ones pin to top with a ×1.25 boost; "doctor agreed" citations carry a ✓ into the printed brief. |
| **Clinician brief** | One page: episodes, top entities, abnormal labs, meds, and "patterns AI noticed for clinician's consideration" — as Markdown, printable HTML, or PDF. |
| **Phone companion (PWA)** | Scan a QR, capture photos straight into the journal from your phone. IndexedDB outbox queues drafts when the LAN drops. Locking the desktop invalidates every paired phone. |
| **In-clinic QR share** | Generate a one-time, read-only, 5–30 min TTL link so a clinician scans the brief into their own browser. Locking instantly revokes it. |
| **Safety first** | A red-flag refusal layer short-circuits prompts about dosing, self-harm, emergencies, diagnostic certainty, or pregnancy + meds *before* the LLM runs. Persistent "not a diagnosis" banner on every screen. |

Encrypted `.diary` single-file backup/restore. React + Vite + i18n (English; RU/IT slots ready).

---

## ★ The differentiator: a fine-tuned extraction model

Entity extraction runs in two modes. The **default** calls vanilla Gemma via Ollama — zero extra setup. The **fine-tuned sidecar** wraps `unsloth/gemma-4-e4b-it` + our **Clario LoRA adapter** + an HPO synonym index, and meaningfully beats the baseline on a held-out-by-disease eval set:

| Metric | Vanilla Gemma | Clario LoRA | |
|---|---|---|---|
| Schema correctness | 0% | **100%** | ▲ |
| Synonym-aware name F1 | 0.209 | **0.524** | ▲ |
| HPO ID F1 (name→lookup) | 0.349 | **0.524** | ▲ |

**Published artefacts (CC-BY-4.0):**
- Model — <https://huggingface.co/m0rtyddd/clario-gemma4-e4b-lora-v2>
- Dataset — <https://huggingface.co/datasets/m0rtyddd/clario-synthetic-diary>

<details>
<summary><b>Running the fine-tuned sidecar</b> (optional — needs a CUDA GPU, ~6 GB VRAM)</summary>

```bash
cd backend
pip install -e ".[extractor]"

# Optional: build the HPO synonym index so the sidecar resolves
# canonical names -> HPO IDs (without it, hpo_id is just omitted).
#   hp.obo:          http://purl.obolibrary.org/obo/hp.obo
#   en_product4.xml: https://www.orphadata.com/data/xml/en_product4.xml
python -m scripts.build_knowledge \
    --hpo-obo path/to/hp.obo \
    --orphanet-xml path/to/en_product4.xml \
    --out data/disease_knowledge.json

# Start the sidecar (pulls the ~70 MB adapter from HF Hub, ~60 s).
CLARIO_KNOWLEDGE_PATH=data/disease_knowledge.json \
    python -m scripts.clario_extractor_service
```

Then start the backend with `CLARIO_EXTRACTOR_URL=http://127.0.0.1:11435` — `backend/diary/extraction.py` delegates extraction to the sidecar; embeddings still go to Ollama.

| Env var | Default | Purpose |
|---|---|---|
| `CLARIO_ADAPTER` | `m0rtyddd/clario-gemma4-e4b-lora-v2` | HF repo ID or local path |
| `CLARIO_EXTRACTOR_PORT` | `11435` | sidecar bind port |
| `CLARIO_KNOWLEDGE_PATH` | *(unset)* | path to `disease_knowledge.json` |
| `CLARIO_EXTRACTOR_URL` | *(unset)* | backend uses sidecar when set |

</details>

---

## ⚙ How it fits together

```
Browser (React PWA)  ──►  FastAPI (single process, :8765)  ──►  SQLCipher DB + encrypted media
                                  │
                                  ├─ background extraction worker ─► Ollama (Gemma + nomic-embed-text)
                                  │                                  └─ or Clario LoRA sidecar (:11435)
                                  └─ Hypothesis Engine ─► vector match vs. curated disease KB
```

Every entry enqueues a job; the worker asks Gemma for `{entities, ts_event_hint}` JSON, embeds with `nomic-embed-text`, canonicalizes via cosine search on `sqlite-vec`, and builds `co_occurs` / `precedes` graph edges. The force-directed graph (`/graph`) lets you click, focus, and rename/merge/delete entities. If Ollama is offline, jobs record as `failed` and resume on "Re-extract" — nothing is lost.

---

## ⌥ Developer setup (only if you're changing code)

The one-step launcher above is what you want for everyday use and demos. The two-process dev flow (hot-reload UI on `:5173`, backend on `:8765`):

**Backend** → <http://localhost:8765>
```bash
cd backend
uv venv --python 3.12
uv pip install -e ".[dev]"
uv run python -m diary
```

**Frontend** → <http://localhost:5173>
```bash
cd frontend
npm install
npm run dev          # Vite proxies /api/* to the backend
```

<details>
<summary>Prerequisites & platform notes</summary>

- **Windows (primary target):** Python 3.12, Node 20+. The `sqlcipher3` Windows wheel is bundled — no native build.
- **macOS / Linux:** `sqlcipher3` builds against system SQLCipher:
  ```bash
  brew install sqlcipher                 # macOS
  # sudo apt install libsqlcipher-dev    # Debian/Ubuntu
  export SQLCIPHER_PATH=$(brew --prefix sqlcipher)
  export CFLAGS="-I${SQLCIPHER_PATH}/include -I${SQLCIPHER_PATH}/include/sqlcipher"
  export LDFLAGS="-L${SQLCIPHER_PATH}/lib"
  ```
  *(The launcher sets these automatically on macOS when Homebrew is present.)*
</details>

<details>
<summary>Optional: whisper.cpp for audio transcription</summary>

Audio is **always** stored encrypted regardless. To also transcribe:
1. Build/download `whisper-cli` from <https://github.com/ggerganov/whisper.cpp>
2. Download a ggml model (e.g. `ggml-small.bin`)
3. Export before launching the backend:
   ```bash
   export DIARY_WHISPER_BIN=/path/to/whisper-cli
   export DIARY_WHISPER_MODEL=/path/to/ggml-small.bin
   ```
</details>

### Tests

```bash
cd backend
.venv/bin/pytest -q     # 120 passed
```

### Storage

- DB: `~/.symptom-diary/data/diary.sqlite` (SQLCipher-encrypted)
- Salt: `~/.symptom-diary/data/diary.salt`
- Media: `~/.symptom-diary/data/media/<entry_id>/<media_id>.enc` (libsodium-encrypted)
- Override the location with `DIARY_DATA_DIR=/some/path`

**There is no recovery.** If you lose the passphrase, the data is gone — by design.

---

## ⤳ Roadmap

- **Document-extraction LoRA** on Orphanet/PMC pairs (sibling to the shipped diary-extraction LoRA).
- **Real Orphanet XML sync** to grow the curated KB beyond the ~40 seed conditions.
- **Packaging polish** — PyInstaller `.exe`, Tauri shell, code-signing.

<div align="center">

---

*Clario is a journaling and pattern-surfacing aid — **not a diagnostic device**. Every insight is hedged, cited, and meant to start a conversation with a clinician, never replace one.*

</div>
