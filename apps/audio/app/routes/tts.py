import io
import wave
from pathlib import Path
import numpy as np
import soundfile as sf
import kokoro
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.config import get_settings, LANGUAGE_ROUTING
from app.models.kokoro import get_kokoro_pipeline
from app.models.piper import get_piper_voice

router = APIRouter()

LANG_CODES = {
    "a": "American English",
    "b": "British English",
    "e": "Spanish",
    "f": "French",
    "h": "Hindi",
    "i": "Italian",
    "j": "Japanese",
    "p": "Portuguese",
    "z": "Mandarin Chinese",
}


def _get_voices() -> list[dict]:
    voices = []

    # Kokoro voices — read dynamically from installed package
    try:
        voices_dir = Path(kokoro.__file__).parent / "voices"
        if voices_dir.exists():
            for path in sorted(voices_dir.glob("*.pt")):
                voice_id = path.stem
                lang = voice_id[0] if voice_id else "?"
                voices.append({
                    "id": voice_id,
                    "engine": "kokoro",
                    "lang_code": lang,
                    "language": LANG_CODES.get(lang, "Unknown"),
                })
    except Exception:
        pass

    # Piper voices — known German voices
    piper_voices = [
        {"id": "de_DE-thorsten-medium", "engine": "piper", "lang_code": "de", "language": "German"},
        {"id": "de_DE-kerstin-low",     "engine": "piper", "lang_code": "de", "language": "German"},
        {"id": "de_DE-eva_k-x_low",     "engine": "piper", "lang_code": "de", "language": "German"},
    ]
    voices.extend(piper_voices)

    return voices


class SynthesizeRequest(BaseModel):
    text: str
    language: str | None = None   # standard code: "en", "de", "fr" etc. — auto-routes to correct engine
    voice: str | None = None      # optional: override the default voice for the language
    lang_code: str | None = None  # Kokoro-specific (a/b/e/f...). Ignored if language is set
    speed: float = 1.0


@router.post("/synthesize")
async def synthesize(body: SynthesizeRequest):
    s = get_settings()

    try:
        # language field takes precedence — routes to the right engine automatically
        if body.language:
            lang = body.language.lower()
            route = LANGUAGE_ROUTING.get(lang)
            if not route:
                raise HTTPException(status_code=400, detail=f"Language '{lang}' is not supported")

            if route["engine"] == "piper":
                return await _synthesize_piper(body.text, body.voice or s.piper_voice_de)

            # Kokoro path via language routing
            lang_code = route["lang_code"]
            voice = body.voice or s.kokoro_default_voice
            return await _synthesize_kokoro(body.text, lang_code, voice, body.speed)

        # Fallback: use lang_code directly (Kokoro only, backward-compatible)
        lang_code = body.lang_code or s.kokoro_default_lang
        voice = body.voice or s.kokoro_default_voice
        return await _synthesize_kokoro(body.text, lang_code, voice, body.speed)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def _synthesize_kokoro(text: str, lang_code: str, voice: str, speed: float) -> StreamingResponse:
    pipeline = get_kokoro_pipeline(lang_code)
    chunks = [audio for _, _, audio in pipeline(text, voice=voice, speed=speed)]
    audio_data = np.concatenate(chunks)

    buffer = io.BytesIO()
    sf.write(buffer, audio_data, samplerate=24000, format="WAV")
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="audio/wav",
        headers={"Content-Disposition": "inline; filename=speech.wav"},
    )


async def _synthesize_piper(text: str, voice_name: str) -> StreamingResponse:
    piper_voice = get_piper_voice(voice_name)

    buffer = io.BytesIO()
    with wave.open(buffer, "w") as wav_file:
        piper_voice.synthesize(text, wav_file)
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="audio/wav",
        headers={"Content-Disposition": "inline; filename=speech.wav"},
    )


@router.get("/voices")
def list_voices():
    return {
        "voices": _get_voices(),
        "supported_languages": list(LANGUAGE_ROUTING.keys()),
        "lang_codes": LANG_CODES,
    }
