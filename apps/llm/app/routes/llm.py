import json
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.config import build_router
from app.router import TaskType

router = APIRouter()
_llm_router = build_router()


class GenerateRequest(BaseModel):
    task: TaskType
    prompt: str
    system: str | None = None


class GenerateResponse(BaseModel):
    result: str
    provider: str


@router.post("/generate", response_model=GenerateResponse)
async def generate(body: GenerateRequest):
    try:
        provider = _llm_router.get(body.task)
        result = await provider.generate(prompt=body.prompt, system=body.system)
        return GenerateResponse(result=result, provider=type(provider).__name__)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/stream")
async def stream(body: GenerateRequest):
    try:
        provider = _llm_router.get(body.task)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    async def event_generator():
        try:
            async for token in provider.stream(prompt=body.prompt, system=body.system):
                yield f"data: {json.dumps({'token': token})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
