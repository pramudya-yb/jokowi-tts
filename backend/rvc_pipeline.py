"""
RVCPipeline
===========
Thin wrapper around `rvc-python` that:
  1. Validates model/index files on init
  2. Lazy-initialises the underlying RVCInference object
  3. Exposes a single `convert()` method used by main.py

Supported F0 methods (no extra downloads needed):
  - "harvest"  (default, pyworld-based)
  - "pm"       (parselmouth, fast)
  - "rmvpe"    (best quality, requires ~/.cache/rvc/rmvpe.pt ~200 MB auto-dl)
"""

import logging
from pathlib import Path

import torch

logger = logging.getLogger(__name__)


class RVCPipeline:
    def __init__(self, model_path: str, index_path: str):
        self.model_path = Path(model_path)
        self.index_path = Path(index_path)
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self._rvc = None
        self._load()

    # ------------------------------------------------------------------
    def _load(self) -> None:
        if not self.model_path.exists():
            raise FileNotFoundError(f"Model file not found: {self.model_path}")
        if not self.index_path.exists():
            raise FileNotFoundError(f"Index file not found: {self.index_path}")

        try:
            from rvc_python.infer import RVCInference  # type: ignore
        except ImportError as exc:
            raise ImportError(
                "\n\nrvc-python is not installed.\n"
                "Run:\n"
                "  pip install rvc-python\n\n"
                "If you get torch errors, first install PyTorch manually:\n"
                "  # CPU-only:\n"
                "  pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu\n"
                "  # CUDA 12.1:\n"
                "  pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121\n"
            ) from exc

        logger.info("Initialising RVCInference on device=%s …", self.device)
        rvc = RVCInference(device=self.device)

        logger.info("Loading weights from %s …", self.model_path.name)
        rvc.load_model(str(self.model_path))

        self._rvc = rvc
        logger.info("RVC ready ✓")

    # ------------------------------------------------------------------
    def convert(
        self,
        input_path: str,
        output_path: str,
        pitch_shift: int = 0,
        index_rate: float = 0.75,
        f0_method: str = "harvest",
        filter_radius: int = 3,
        rms_mix_rate: float = 0.25,
        protect: float = 0.33,
    ) -> None:
        """
        Convert voice in *input_path* to Jokowi's voice and write to *output_path*.

        Parameters
        ----------
        input_path   : Path to the source WAV produced by Edge TTS.
        output_path  : Destination path for the synthesised WAV.
        pitch_shift  : Semitones to transpose (+/- 12).
        index_rate   : How strongly the FAISS index influences features (0–1).
        f0_method    : Pitch extraction method ("harvest", "pm", "rmvpe").
        filter_radius: Median-filter radius for F0 smoothing.
        rms_mix_rate : Volume normalisation blend (0 = raw, 1 = normalised).
        protect      : Protect unvoiced consonants from pitch modification.
        """
        assert self._rvc is not None, "Pipeline not initialised"

        self._rvc.infer_file(
            input_path=input_path,
            output_path=output_path,
            index_path=str(self.index_path),
            f0up_key=pitch_shift,
            f0method=f0_method,
            index_rate=index_rate,
            filter_radius=filter_radius,
            resample_sr=44100,   # standard web-compatible rate
            rms_mix_rate=rms_mix_rate,
            protect=protect,
        )
