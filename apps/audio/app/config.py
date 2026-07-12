from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Faster-Whisper — STT
    # Model sizes: tiny, base, small, medium, large-v3
    # Use "small" for dev (fast, low memory), "large-v3" for prod (best accuracy)
    whisper_model_size: str = "small"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"  # int8 is fastest on CPU

    # Kokoro — TTS (languages: a=en-us, b=en-gb, e=es, f=fr, h=hi, i=it, j=ja, p=pt, z=zh)
    kokoro_default_voice: str = "af_heart"
    kokoro_default_lang: str = "a"

    # Piper — TTS for languages Kokoro doesn't support (e.g. German)
    piper_voice_de: str = "de_DE-thorsten-medium"  # default German voice

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()


# Maps standard language codes to (engine, engine-specific config)
# engine: "kokoro" | "piper"
LANGUAGE_ROUTING: dict[str, dict] = {
    "en":    {"engine": "kokoro", "lang_code": "a"},
    "en-us": {"engine": "kokoro", "lang_code": "a"},
    "en-gb": {"engine": "kokoro", "lang_code": "b"},
    "es":    {"engine": "kokoro", "lang_code": "e"},
    "fr":    {"engine": "kokoro", "lang_code": "f"},
    "hi":    {"engine": "kokoro", "lang_code": "h"},
    "it":    {"engine": "kokoro", "lang_code": "i"},
    "ja":    {"engine": "kokoro", "lang_code": "j"},
    "pt":    {"engine": "kokoro", "lang_code": "p"},
    "zh":    {"engine": "kokoro", "lang_code": "z"},
    "de":    {"engine": "piper"},   # routed to Piper
}
