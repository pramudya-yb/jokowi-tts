# Jokowi TTS — Backend Setup

## Prerequisites

| Tool | Version |
|------|---------|
| Python | 3.10 or 3.11 (3.12 may have fairseq issues) |
| pip | latest |
| NVIDIA GPU | optional but 5-10× faster |

---

## 1. Create a virtual environment

```bash
cd jokowi-tts/backend

python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate
```

---

## 2. Install PyTorch (choose one)

**CPU only** (works on any machine, ~2–6 s per synthesis):
```bash
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
```

**NVIDIA GPU / CUDA 12.1** (~0.5–1 s per synthesis):
```bash
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121
```

---

## 3. Install the remaining dependencies

```bash
pip install -r requirements.txt
```

On first run, `rvc-python` will automatically download the HuBERT / ContentVec
feature-extraction model (~95 MB) into `~/.cache/rvc/`.

---

## 4. Start the server

```bash
python main.py
```

The API will be available at **http://localhost:8000**.
Keep this terminal open while using the Next.js frontend.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness check |
| GET | `/status` | Model load status + device info |
| GET | `/voices` | List Indonesian Edge TTS voices |
| POST | `/synthesize` | Synthesise text → Jokowi WAV |

### POST `/synthesize` body

```json
{
  "text": "Saudara-saudara sebangsa dan setanah air…",
  "voice": "id-ID-ArdiNeural",
  "pitch_shift": 0,
  "index_rate": 0.75,
  "speed": -5.0,
  "f0_method": "harvest"
}
```

Returns `audio/wav`.

---

## Troubleshooting

### `fairseq` install fails
```bash
pip install fairseq --no-build-isolation
```
Or use Python 3.10 which has better binary wheels.

### `rvc-python` API mismatch
Check the installed version:
```bash
python -c "import rvc_python; print(rvc_python.__version__)"
```
Then look at `rvc_pipeline.py` — the `infer_file()` kwargs may need adjusting
for older/newer versions.

### `rmvpe` F0 method
Gives noticeably better pitch accuracy but requires an extra ~200 MB model.
Change `f0_method` to `"rmvpe"` in the frontend and the model will
auto-download on first use.

### Port already in use
```bash
uvicorn main:app --host 0.0.0.0 --port 8001
```
Then set `NEXT_PUBLIC_API_URL=http://localhost:8001` in `.env.local`.
