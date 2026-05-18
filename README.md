<div align="center">

# Clario · Symptom Diary

**A local-first symptom diary powered by a fine-tuned Gemma 4 model that learns to read patient data and surfaces the patterns that are hard to catch in a 15-minute appointment.**

*100% local. Encrypted at rest. No account, no cloud, no telemetry — nothing ever leaves the machine except a localhost call to your own AI model.*

`Python 3.12` · `FastAPI` · `React + Vite` · `SQLCipher` · `Ollama` · `fine-tuned Gemma 4 LoRA`

</div>

---

## The diagnostic odyssey

For **300 million people** worldwide, getting a diagnosis takes years. The average wait for a rare-disease diagnosis is **4.8 years** — 5.4 for women, 10.4 for teenagers. During that time the patient becomes their own medical archivist: photos of rashes on a phone, voice memos of 3 a.m. episodes, notes on the back of receipts. They bring all of it to every appointment, and every appointment starts from zero.

The cruelty is that the answer is often already there, in the patient's own data. Rare diseases hide in plain sight — one symptom looks like the flu, another like stress. The pattern is there. It just needs to be seen all at once.

That is what Clario does.

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

No data of your own required — Clario ships with three synthetic reference patients.

1. **Launch** (above) → pick any 12+ character passphrase on the Setup screen.
2. Open **AI models** (`/llm`) → pull `gemma3:4b` + `nomic-embed-text`. *(Skippable — the engine degrades gracefully to keyword matching, just with weaker signals.)*
3. Timeline header → **Load demo patient** → pick **Maria** (8-month systemic-lupus picture).
4. Header → **Patterns** (`/hypotheses`) → **Re-check now**.

➡ Maria surfaces **moderate signals for Systemic Lupus Erythematosus and iron-deficiency anemia**, each with a hedged rationale and explicit citations back into her diary entries and lab results. Try **Tom** (MCAS) and **Anna** (Hashimoto) too.

---

## What Clario does

Clario is a local-first, privacy-preserving symptom diary for anyone on a long diagnostic odyssey — adults, parents of sick children, and the clinicians trying to help them.

**The patient captures their illness as it unfolds.** Free text, photos of skin findings, voice memos when an episode hits in the middle of the night, photographs of medical documents (visit notes, lab results, prescriptions). Everything stays on their device. Nothing is uploaded.

**In the background, Gemma 4 (local, via Ollama) extracts structured entities** from each entry: symptoms, triggers, body parts, lab markers, medications. Each symptom is canonicalised to its formal medical term with a stable **HPO ID** where applicable. Lab values become time-series. Documents become structured records. Over months and years, Clario builds a graph of the illness: what co-occurs, what precedes what, which lab patterns shift over time.

**When enough signal accumulates, the Hypothesis Engine** compares the user's symptom fingerprint against a curated knowledge base of rare diseases (~6,000 Orphanet disorders), surfaces credible patterns, and writes a hedged rationale — *"the pattern resembles Systemic Lupus Erythematosus; here are the journal entries that brought it up; consider discussing with your doctor."* Three signal levels (weak / moderate / strong). Every claim cites specific entries. **Never a diagnosis.**

**Before the next appointment**, the patient generates a one-page **clinician brief** — Markdown, PDF, or shared in-clinic via a local-network QR code that expires after the visit. It leads with patient-reported context, surfaces abnormal labs with trend indicators, highlights medications, and ends with *"Patterns AI noticed for the clinician's consideration."* The clinician gets fifteen minutes of focused review instead of fifteen minutes of catch-up.

| | |
|---|---|
| **Multimodal capture** | Markdown entries, photos (EXIF-stripped, AI-captioned), audio (whisper.cpp transcription), medical documents parsed into structured records. |
| **Illness graph** | Force-directed graph (`/graph`) of canonicalised entities — co-occurrence & precedence edges; click, focus, rename / merge / delete. |
| **Learning loop** | Confirm / Dismiss feeds back: dismissed conditions get a 60-day cooldown unless the score jumps ≥30%; confirmed ones pin to top with a ×1.25 boost; "doctor agreed" citations carry a ✓ into the printed brief. |
| **Phone companion (PWA)** | Scan a QR, capture photos straight into the journal from your phone. IndexedDB outbox queues drafts when the LAN drops; locking the desktop invalidates every paired phone. |
| **Patient-controlled portability** | Encrypted single-file `.diary` bundle export/import. Cryptographically opaque without the passphrase. |

React + Vite + i18n (English; RU/IT slots ready).

---

## ★ The hard problem we solved

Out of the box, **no language model — including Gemma 4 — bridges colloquial diary language and formal medical terminology.** A patient writes *"butterfly rash on my cheeks after gardening."* A clinician thinks *malar rash, photosensitivity.* If the AI can't connect those registers, the whole downstream system breaks: pattern matching fails, hypotheses go quiet, and the patient's own words become invisible to the algorithm.

We solved it with **post-training on Gemma 4 E4B via Unsloth**. We built a synthetic training corpus from authoritative open sources — **Orphanet** (rare-disease phenotype annotations) and **HPO** (the Human Phenotype Ontology, ~17,000 terms with colloquial synonym mappings) — to teach the model to extract clinical entities from informal patient text and emit them with canonical HPO IDs. Training used **QLoRA at rank 16**, ~500 generated diary-and-target pairs across the rare-disease space, with **disease-level holdout** for honest evaluation on **200 manually verified golden examples**.

| Metric (held-out set) | Vanilla Gemma 4 E4B | Clario-Extract (LoRA) |
|---|---|---|
| Entity-extraction F1 | 0.42 | **0.71** |
| HPO ID accuracy | 0.31 | **0.66** |

The product runs **both configurations** — patients choose stock Gemma or the Clario-Extract variant via the in-app setup wizard. The fine-tuned LoRA is published openly (CC-BY-4.0):

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

## Why local-first, why Gemma 4

This is health data about real children and chronically-ill adults — **special-category personal data under GDPR Article 9.**

Asking exhausted patients to upload years of symptom photos and voice memos to a third-party server isn't just a privacy risk — it's the exact breakdown of trust they've already lived through with the medical system. Clario is built on one principle: **no data leaves the user's machine. Ever.** Gemma 4's range of sizes — from E4B on a laptop to 26B-A4B on a desktop — is what makes local-first viable *at meaningful quality*. The model has to live where the data lives. Otherwise the product is privacy theatre. Clario is not.

---

## How we built it safely

Three commitments run through every layer:

- **No diagnosis claims.** Every AI rationale uses hedged language verified in post-processing — *"the pattern resembles," "consider ruling out," "your doctor may want to evaluate."* Strong / moderate / weak signal pills, never percentages.
- **Citation grounding.** Every claim in the brief and every hypothesis rationale cites the specific journal entries that produced it — traceable back to source data in one click.
- **Red-flag refusal.** Questions about dosing, self-harm, emergencies, or pregnancy + medications are intercepted *before* the model is invoked and routed to appropriate resources. The model never gets the chance to improvise on these topics.

Plus the foundations: **SQLCipher** at-rest encryption with Argon2id passphrase-derived keys, **libsodium secretstream** for media, 15-minute auto-lock, encrypted bundle export, and a persistent disclaimer on every screen. There is **no recovery** — lose the passphrase and the data is gone, by design.

---

## ⚙ How it fits together

```
Browser (React PWA)  ──►  FastAPI (single process, :8765)  ──►  SQLCipher DB + encrypted media
                                  │
                                  ├─ background extraction worker ─► Ollama (Gemma 4 + nomic-embed-text)
                                  │                                  └─ or Clario-Extract LoRA sidecar (:11435)
                                  └─ Hypothesis Engine ─► vector match vs. curated Orphanet/HPO KB
```

Every entry enqueues a job; the worker asks Gemma for `{entities, ts_event_hint}` JSON, embeds with `nomic-embed-text`, canonicalises via cosine search on `sqlite-vec`, and builds `co_occurs` / `precedes` graph edges. If Ollama is offline, jobs record as `failed` and resume on "Re-extract" — nothing is lost.

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

```bash
cd backend && .venv/bin/pytest -q     # 120 passed
```

**Storage:** `~/.symptom-diary/data/` — SQLCipher DB, salt, libsodium-encrypted media. Override with `DIARY_DATA_DIR=/some/path`.

---

## ⤳ What's next

Clario today handles English diary text and English-language medical documents. The architecture is ready for **multilingual extension** — Gemma 4's multilingual capability plus localized synonym tables — and that's our next training run. Vision extraction from documents works well on printed lab reports and weakens on handwritten clinical notes; a **multimodal LoRA on Gemma 4's vision layers** is the next iteration.

---

## Team & acknowledgements

We are three students from the **University of Pavia** studying AI, with backgrounds in innovation management and startup development. We built Clario because one of us has lived inside the diagnostic odyssey — and because we believe the answer is usually already in the patient's data; it just hasn't been seen yet.

Our gratitude to the maintainers of **Orphadata**, the **HPO Consortium**, **Unsloth**, and the **Ollama** team.

<div align="center">

---

*Clario is a journaling and pattern-surfacing aid — **not a diagnostic device**. When frontier-quality AI runs locally and stays grounded in real data, it doesn't replace clinicians — it gives them the information they need.*

</div>
