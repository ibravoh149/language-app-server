import os
import tempfile
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from app.models.whisper import get_whisper_model

router = APIRouter()


class WordTimestamp(BaseModel):
    word: str
    start: float  # seconds
    end: float    # seconds


class TranscribeResponse(BaseModel):
    text: str
    language: str
    language_probability: float
    duration: float
    words: list[WordTimestamp] | None = None  # only present when word_timestamps=True


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    file: UploadFile = File(...),
    language: str | None = Form(default=None),          # optional: force a specific language
    word_timestamps: bool = Form(default=False),         # set True to get per-word timing
):
    suffix = os.path.splitext(file.filename or "audio.wav")[1] or ".wav"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        model = get_whisper_model()
        segments, info = model.transcribe(
            tmp_path,
            language=language,
            beam_size=5,
            vad_filter=True,
            word_timestamps=word_timestamps,
        )

        # Must consume the generator once — collect segments into a list
        segments = list(segments)
        text = " ".join(seg.text.strip() for seg in segments)

        words = None
        if word_timestamps:
            words = [
                WordTimestamp(
                    word=w.word.strip(),
                    start=round(w.start, 3),
                    end=round(w.end, 3),
                )
                for seg in segments
                for w in (seg.words or [])
            ]

        return TranscribeResponse(
            text=text.strip(),
            language=info.language,
            language_probability=round(info.language_probability, 3),
            duration=round(info.duration, 2),
            words=words,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        os.unlink(tmp_path)
