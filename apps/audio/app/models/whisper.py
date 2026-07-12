from functools import lru_cache
from faster_whisper import WhisperModel
from app.config import get_settings


@lru_cache
def get_whisper_model() -> WhisperModel:
    s = get_settings()
    # Downloads model from HuggingFace on first call, cached to HF_HOME volume after that
    return WhisperModel(
        s.whisper_model_size,
        device=s.whisper_device,
        compute_type=s.whisper_compute_type,
    )
