import io
from pathlib import Path
import numpy as np
import soundfile as sf
import kokoro
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.config import get_settings
from app.models.kokoro import get_kokoro_pipeline

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
    try:
        # Dynamically read voices from the installed kokoro package
        voices_dir = Path(kokoro.__file__).parent / "voices"
        if voices_dir.exists():
            voices = []
            for path in sorted(voices_dir.glob("*.pt")):
                voice_id = path.stem
                lang = voice_id[0] if voice_id else "?"
                voices.append({
                    "id": voice_id,
                    "lang_code": lang,
                    "language": LANG_CODES.get(lang, "Unknown"),
                })
            return voices
    except Exception:
        pass

    # Fallback: known voices as of kokoro v0.9.x
    return [
        {"id": "af_alloy",     "lang_code": "a", "language": "American English"},
        {"id": "af_aoede",     "lang_code": "a", "language": "American English"},
        {"id": "af_bella",     "lang_code": "a", "language": "American English"},
        {"id": "af_heart",     "lang_code": "a", "language": "American English"},
        {"id": "af_jessica",   "lang_code": "a", "language": "American English"},
        {"id": "af_kore",      "lang_code": "a", "language": "American English"},
        {"id": "af_nicole",    "lang_code": "a", "language": "American English"},
        {"id": "af_nova",      "lang_code": "a", "language": "American English"},
        {"id": "af_river",     "lang_code": "a", "language": "American English"},
        {"id": "af_sarah",     "lang_code": "a", "language": "American English"},
        {"id": "af_sky",       "lang_code": "a", "language": "American English"},
        {"id": "am_adam",      "lang_code": "a", "language": "American English"},
        {"id": "am_echo",      "lang_code": "a", "language": "American English"},
        {"id": "am_eric",      "lang_code": "a", "language": "American English"},
        {"id": "am_fenrir",    "lang_code": "a", "language": "American English"},
        {"id": "am_liam",      "lang_code": "a", "language": "American English"},
        {"id": "am_michael",   "lang_code": "a", "language": "American English"},
        {"id": "am_onyx",      "lang_code": "a", "language": "American English"},
        {"id": "am_puck",      "lang_code": "a", "language": "American English"},
        {"id": "bf_alice",     "lang_code": "b", "language": "British English"},
        {"id": "bf_emma",      "lang_code": "b", "language": "British English"},
        {"id": "bf_isabella",  "lang_code": "b", "language": "British English"},
        {"id": "bf_lily",      "lang_code": "b", "language": "British English"},
        {"id": "bm_daniel",    "lang_code": "b", "language": "British English"},
        {"id": "bm_fable",     "lang_code": "b", "language": "British English"},
        {"id": "bm_george",    "lang_code": "b", "language": "British English"},
        {"id": "bm_lewis",     "lang_code": "b", "language": "British English"},
        {"id": "ef_dora",      "lang_code": "e", "language": "Spanish"},
        {"id": "em_alex",      "lang_code": "e", "language": "Spanish"},
        {"id": "ff_siwis",     "lang_code": "f", "language": "French"},
        {"id": "hf_alpha",     "lang_code": "h", "language": "Hindi"},
        {"id": "hf_beta",      "lang_code": "h", "language": "Hindi"},
        {"id": "if_sara",      "lang_code": "i", "language": "Italian"},
        {"id": "im_nicola",    "lang_code": "i", "language": "Italian"},
        {"id": "jf_alpha",     "lang_code": "j", "language": "Japanese"},
        {"id": "jf_gongitsune","lang_code": "j", "language": "Japanese"},
        {"id": "jm_kumo",      "lang_code": "j", "language": "Japanese"},
        {"id": "pf_dora",      "lang_code": "p", "language": "Portuguese"},
        {"id": "pm_alex",      "lang_code": "p", "language": "Portuguese"},
        {"id": "zf_xiaobei",   "lang_code": "z", "language": "Mandarin Chinese"},
        {"id": "zm_yunxi",     "lang_code": "z", "language": "Mandarin Chinese"},
    ]


class SynthesizeRequest(BaseModel):
    text: str
    voice: str | None = None
    lang_code: str | None = None
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
        "voices": _get_voices(),
        "lang_codes": LANG_CODES,
    }
