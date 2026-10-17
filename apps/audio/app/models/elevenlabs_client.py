from functools import lru_cache
from elevenlabs import ElevenLabs
from app.config import get_settings


@lru_cache
def get_elevenlabs_client() -> ElevenLabs:
    s = get_settings()
    return ElevenLabs(api_key=s.elevenlabs_api_key)
