import io
import numpy as np
import soundfile as sf
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.config import get_settings
from app.models.kokoro import get_kokoro_pipeline

router = APIRouter()


class SynthesizeRequest(BaseModel):
    text: str
    voice: str | None = None      # overrides KOKORO_DEFAULT_VOICE
    lang_code: str | None = None  # overrides KOKORO_DEFAULT_LANG
    speed: float = 1.0


@router.post("/synthesize")
async def synthesize(body: SynthesizeRequest):
    s = get_settings()
    lang_code = body.lang_code or s.kokoro_default_lang
    voice = body.voice or s.kokoro_default_voice

    try:
        pipeline = get_kokoro_pipeline(lang_code)
        chunks = [audio for _, _, audio in pipeline(body.text, voice=voice, speed=body.speed)]
        audio_data = np.concatenate(chunks)

        buffer = io.BytesIO()
        sf.write(buffer, audio_data, samplerate=24000, format="WAV")
        buffer.seek(0)

        return StreamingResponse(
            buffer,
            media_type="audio/wav",
            headers={"Content-Disposition": "inline; filename=speech.wav"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/voices")
def list_voices():
    return {
        "voices": [
            {"id": "af_heart",   "lang": "a", "description": "American English - Female"},
            {"id": "af_bella",   "lang": "a", "description": "American English - Female"},
            {"id": "af_nicole",  "lang": "a", "description": "American English - Female"},
            {"id": "am_adam",    "lang": "a", "description": "American English - Male"},
            {"id": "am_michael", "lang": "a", "description": "American English - Male"},
            {"id": "bf_emma",    "lang": "b", "description": "British English - Female"},
            {"id": "bm_george",  "lang": "b", "description": "British English - Male"},
        ],
        "lang_codes": {
            "a": "American English",
            "b": "British English",
            "e": "Spanish",
            "f": "French",
            "j": "Japanese",
            "z": "Mandarin Chinese",
        },
    }
