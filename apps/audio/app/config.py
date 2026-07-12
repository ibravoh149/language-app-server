from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Faster-Whisper — STT
    # Model sizes: tiny, base, small, medium, large-v3
    # Use "small" for dev (fast, low memory), "large-v3" for prod (best accuracy)
    whisper_model_size: str = "small"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"  # int8 is fastest on CPU

    # Kokoro — TTS
    kokoro_default_voice: str = "af_heart"
    # lang_code: 'a' = American English, 'b' = British English,
    #            'e' = Spanish, 'f' = French, 'j' = Japanese, 'z' = Mandarin
    kokoro_default_lang: str = "a"

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
