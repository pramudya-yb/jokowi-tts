"""
Jokowi TTS Backend
Pipeline: Text → Edge TTS (WAV) → RVC Jokowi Model → Jokowi Voice (WAV)
"""

import asyncio
import logging
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
import tempfile

import edge_tts
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from rvc_pipeline import RVCPipeline

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_DIR = BASE_DIR / "Jokowi Voice Model"
MODEL_PTH = MODEL_DIR / "model.pth"
MODEL_INDEX = MODEL_DIR / "model.index"

TEMP_DIR = Path(tempfile.gettempdir()) / "jokowi-tts"
TEMP_DIR.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# App lifespan — load model once at startup
# ---------------------------------------------------------------------------
pipeline: RVCPipeline | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global pipeline
    logger.info("Loading RVC model from %s …", MODEL_PTH)
    try:
        pipeline = RVCPipeline(str(MODEL_PTH), str(MODEL_INDEX))
        logger.info("✅  RVC model ready (device: %s)", pipeline.device)
    except Exception as exc:
        logger.error("❌  Failed to load model: %s", exc)
        raise
    yield
    logger.info("Shutting down …")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Jokowi TTS API",
    description="RVC-powered Jokowi voice synthesis",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    voice: str = Field(default="id-ID-ArdiNeural")
    pitch_shift: int = Field(default=0, ge=-12, le=12, description="Semitones")
    index_rate: float = Field(default=0.75, ge=0.0, le=1.0)
    speed: float = Field(default=-5.0, ge=-50.0, le=50.0, description="Edge TTS rate %")
    f0_method: str = Field(default="harvest", description="harvest | pm | rmvpe")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": pipeline is not None}


@app.get("/status")
async def status():
    return {
        "status": "ready" if pipeline is not None else "loading",
        "model_loaded": pipeline is not None,
        "model_path": str(MODEL_PTH),
        "index_path": str(MODEL_INDEX),
        "device": pipeline.device if pipeline else None,
    }


@app.get("/voices")
async def list_voices():
    """Return Indonesian Edge TTS voices."""
    all_voices = await edge_tts.list_voices()
    id_voices = [v for v in all_voices if v["Locale"].startswith("id")]
    return {"voices": id_voices}


@app.post("/synthesize")
async def synthesize(
    req: SynthesizeRequest,
    bg: BackgroundTasks,
):
    if pipeline is None:
        raise HTTPException(503, "Model not loaded yet — try again in a moment")

    job = uuid.uuid4().hex
    tts_wav = TEMP_DIR / f"{job}_tts.wav"
    out_wav = TEMP_DIR / f"{job}_out.wav"

    try:
        # ── Step 1: Text → Edge TTS ──────────────────────────────────────
        rate_str = f"{req.speed:+.0f}%"  # e.g. "-5%", "+10%"
        comm = edge_tts.Communicate(text=req.text, voice=req.voice, rate=rate_str)
        await comm.save(str(tts_wav))

        if not tts_wav.exists() or tts_wav.stat().st_size == 0:
            raise RuntimeError("Edge TTS produced no audio — check the voice name")

        # ── Step 2: WAV → RVC Jokowi voice ──────────────────────────────
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            pipeline.convert,
            str(tts_wav),
            str(out_wav),
            req.pitch_shift,
            req.index_rate,
            req.f0_method,
        )

        if not out_wav.exists() or out_wav.stat().st_size == 0:
            raise RuntimeError("RVC produced no output audio")

        # Clean up temp files in the background after the response is sent
        bg.add_task(_deferred_cleanup, tts_wav, out_wav)

        return FileResponse(
            str(out_wav),
            media_type="audio/wav",
            filename="jokowi_speech.wav",
            headers={"Cache-Control": "no-store"},
        )

    except Exception as exc:
        # Immediate cleanup on error
        for p in (tts_wav, out_wav):
            p.unlink(missing_ok=True)
        logger.exception("Synthesis failed")
        raise HTTPException(500, str(exc)) from exc


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _deferred_cleanup(*paths: Path, delay: int = 60) -> None:
    """Delete temp files after `delay` seconds (gives client time to download)."""
    import time
    time.sleep(delay)
    for p in paths:
        try:
            p.unlink(missing_ok=True)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Dev runner
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
