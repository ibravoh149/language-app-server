import io
import wave
from pathlib import Path
import numpy as np
import soundfile as sf
import kokoro
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.config import get_settings, get_piper_voice_for_language, LANGUAGE_ROUTING
from app.models.kokoro import get_kokoro_pipeline
from app.models.piper import get_piper_voice, VOICE_PATHS
from app.models.elevenlabs_client import get_elevenlabs_client

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

    # Piper voices — derived from VOICE_PATHS so it always stays in sync
    PIPER_LANG_NAMES = {
        "de": "German",    "nl": "Dutch",      "pl": "Polish",
        "ru": "Russian",   "tr": "Turkish",    "ar": "Arabic",
        "cs": "Czech",     "sv": "Swedish",    "nb": "Norwegian",
        "da": "Danish",    "fi": "Finnish",    "el": "Greek",
        "uk": "Ukrainian", "ko": "Korean",     "vi": "Vietnamese",
        "hu": "Hungarian", "ro": "Romanian",   "sk": "Slovak",
        "ca": "Catalan",   "sr": "Serbian",
    }
    for voice_id in sorted(VOICE_PATHS.keys()):
        lang = voice_id[:2]
        voices.append({
            "id": voice_id,
            "engine": "piper",
            "lang_code": lang,
            "language": PIPER_LANG_NAMES.get(lang, "Unknown"),
        })
    return voices


class SynthesizeRequest(BaseModel):
    text: str
    language: str | None = None   # standard code: "en", "de", "fr" etc. — auto-routes to correct engine
    voice: str | None = None      # optional: override the default voice / ElevenLabs voice_id
    lang_code: str | None = None  # Kokoro-specific (a/b/e/f...). Ignored if language is set
    speed: float = 1.0
    engine: str | None = None     # None/"auto" = Kokoro/Piper (default). "elevenlabs" = cloud TTS.


@router.post("/synthesize")
async def synthesize(body: SynthesizeRequest):
    s = get_settings()

    try:
        # Explicit ElevenLabs override
        if body.engine == "elevenlabs":
            if not s.elevenlabs_api_key:
                raise HTTPException(status_code=400, detail="ELEVENLABS_API_KEY is not configured")
            voice_id = body.voice or s.elevenlabs_default_voice_id
            return await _synthesize_elevenlabs(body.text, voice_id)

        # language field takes precedence — routes to the right engine automatically
        if body.language:
            lang = body.language.lower()
            route = LANGUAGE_ROUTING.get(lang)
            if not route:
                raise HTTPException(status_code=400, detail=f"Language '{lang}' is not supported")

            if route["engine"] == "piper":
                voice = body.voice or get_piper_voice_for_language(lang)
                return await _synthesize_piper(body.text, voice)

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


async def _synthesize_elevenlabs(text: str, voice_id: str) -> StreamingResponse:
    s = get_settings()
    client = get_elevenlabs_client()

    audio_chunks = client.text_to_speech.convert(
        voice_id=voice_id,
        text=text,
        model_id=s.elevenlabs_model,
        output_format="mp3_44100_128",
    )
    audio_bytes = b"".join(audio_chunks)

    return StreamingResponse(
        io.BytesIO(audio_bytes),
        media_type="audio/mpeg",
        headers={"Content-Disposition": "inline; filename=speech.mp3"},
    )


@router.get("/voices")
def list_voices():
    s = get_settings()
    return {
        "voices": _get_voices(),
        "supported_languages": list(LANGUAGE_ROUTING.keys()),
        "lang_codes": LANG_CODES,
        "elevenlabs": {
            "available": bool(s.elevenlabs_api_key),
            "default_voice_id": s.elevenlabs_default_voice_id,
            "model": s.elevenlabs_model,
            "note": "Pass engine='elevenlabs' with any valid ElevenLabs voice_id to use cloud TTS",
        },
    }
