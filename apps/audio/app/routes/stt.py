import os
import tempfile
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from app.models.whisper import get_whisper_model

router = APIRouter()


class TranscribeResponse(BaseModel):
    text: str
    language: str
    language_probability: float
    duration: float


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(
    file: UploadFile = File(...),
    language: str | None = Form(default=None),  # optional: force a specific language
):
    suffix = os.path.splitext(file.filename or "audio.wav")[1] or ".wav"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        model = get_whisper_model()
        segments, info = model.transcribe(
            tmp_path,
            language=language,          # None = auto-detect
            beam_size=5,
            vad_filter=True,            # strips silence automatically
        )
        text = " ".join(segment.text.strip() for segment in segments)
        return TranscribeResponse(
            text=text.strip(),
            language=info.language,
            language_probability=round(info.language_probability, 3),
            duration=round(info.duration, 2),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        os.unlink(tmp_path)
