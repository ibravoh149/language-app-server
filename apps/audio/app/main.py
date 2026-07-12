from contextlib import asynccontextmanager
from fastapi import FastAPI
from app.routes import health, stt, tts
from app.models.whisper import get_whisper_model
from app.models.kokoro import get_kokoro_pipeline
from app.models.piper import get_piper_voice
from app.config import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load all models at startup so the first request isn't slow.
    # Piper will download the German voice model on first startup if not cached.
    s = get_settings()
    get_whisper_model()
    get_kokoro_pipeline(s.kokoro_default_lang)
    get_piper_voice(s.piper_voice_de)
    yield


app = FastAPI(title="languageapp-audio", version="0.1.0", lifespan=lifespan)

app.include_router(health.router)
app.include_router(stt.router, prefix="/stt")
app.include_router(tts.router, prefix="/tts")
