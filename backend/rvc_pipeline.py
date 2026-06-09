"""
RVCPipeline
===========
Wrapper around `infer_rvc_python` (BaseLoader) that:
  1. Validates model/index files on init
  2. Lazy-initialises the underlying BaseLoader object
  3. Exposes a single `convert()` method used by main.py

Supported F0 methods:
  - "pm"       (parselmouth, fast — default)
  - "harvest"  (pyworld-based, slower but decent)
  - "rmvpe"    (best quality, requires rmvpe.pt ~200 MB auto-dl)
"""

import logging
import os
import shutil
from pathlib import Path

import torch

logger = logging.getLogger(__name__)


class RVCPipeline:
    def __init__(self, model_path: str, index_path: str):
        self.model_path = Path(model_path)
        self.index_path = Path(index_path)
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self._loader = None
        self._load()

    # ------------------------------------------------------------------
    def _load(self) -> None:
        if not self.model_path.exists():
            raise FileNotFoundError(f"Model file not found: {self.model_path}")
        if not self.index_path.exists():
            raise FileNotFoundError(f"Index file not found: {self.index_path}")

        try:
            from infer_rvc_python import BaseLoader
        except ImportError as exc:
            raise ImportError(
                "\n\ninfer_rvc_python is not installed.\n"
                "Run:\n"
                "  pip install infer_rvc_python\n"
            ) from exc

        logger.info("Initialising BaseLoader on device=%s …", self.device)
        only_cpu = not torch.cuda.is_available()
        self._loader = BaseLoader(only_cpu=only_cpu)

        logger.info("Applying config with model %s …", self.model_path.name)
        result = self._loader.apply_conf(
            tag="jokowi",
            file_model=str(self.model_path),
            pitch_algo="pm",
            pitch_lvl=0,
            file_index=str(self.index_path) if self.index_path.exists() else "",
            index_influence=0.75,
            respiration_median_filtering=3,
            envelope_ratio=0.25,
            consonant_breath_protection=0.33,
        )
        logger.info("RVC config applied: %s", result)
        logger.info("RVC ready ✓")

    # ------------------------------------------------------------------
    def convert(
        self,
        input_path: str,
        output_path: str,
        pitch_shift: int = 0,
        index_rate: float = 0.75,
        f0_method: str = "pm",
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
        f0_method    : Pitch extraction method ("pm", "harvest", "rmvpe").
        filter_radius: Median-filter radius for F0 smoothing.
        rms_mix_rate : Volume normalisation blend (0 = raw, 1 = normalised).
        protect      : Protect unvoiced consonants from pitch modification.
        """
        assert self._loader is not None, "Pipeline not initialised"

        # Update config if pitch or method changed
        self._loader.apply_conf(
            tag="jokowi",
            file_model=str(self.model_path),
            pitch_algo=f0_method,
            pitch_lvl=pitch_shift,
            file_index=str(self.index_path) if self.index_path.exists() else "",
            index_influence=index_rate,
            respiration_median_filtering=filter_radius,
            envelope_ratio=rms_mix_rate,
            consonant_breath_protection=protect,
        )

        # Run inference — returns list of output file paths
        result_paths = self._loader(
            audio_files=[input_path],
            tag_list=["jokowi"],
            type_output="wav",
        )

        if not result_paths or not os.path.exists(result_paths[0]):
            raise RuntimeError("RVC inference failed to produce output")

        # Move the result to the desired output path
        shutil.move(result_paths[0], output_path)
        logger.info("Voice conversion complete → %s", output_path)
