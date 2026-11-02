import json
import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from openai import RateLimitError
from pydantic import BaseModel, Field
from app.config import build_router
from app.providers.base import GenerateOptions
from app.router import TaskType

router = APIRouter()
_llm_router = build_router()
logger = logging.getLogger("uvicorn.error")


class GenerateRequest(BaseModel):
    task: TaskType
    prompt: str
    system: str | None = None
    # Limits — callers should always bound requests (TRACKER D10)
    max_tokens: int | None = Field(default=None, ge=1, le=4096)
    temperature: float | None = Field(default=None, ge=0, le=2)
    json_output: bool = False  # ask for a single JSON object


class Usage(BaseModel):
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


class GenerateResponse(BaseModel):
    result: str
    provider: str
    model: str | None = None
    # True when the routed provider was rate-limited and the local model answered
    fallback: bool = False
    usage: Usage


@router.post("/generate", response_model=GenerateResponse)
async def generate(body: GenerateRequest):
    try:
        provider = _llm_router.get(body.task)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    options = GenerateOptions(max_tokens=body.max_tokens, temperature=body.temperature, json=body.json_output)
    fallback = False
    try:
        result = await provider.generate(prompt=body.prompt, system=body.system, options=options)
    except RateLimitError:
        # A hosted provider's free tier ran out for now: answer from the local model instead of failing.
        local = _llm_router.local()
        if local is None or local is provider:
            raise
        logger.warning("llm task=%s provider=%s rate-limited; falling back to %s", body.task.value, type(provider).__name__, type(local).__name__)
        provider = local
        fallback = True
        result = await provider.generate(prompt=body.prompt, system=body.system, options=options)
    logger.info(
        "llm task=%s provider=%s prompt_tokens=%s completion_tokens=%s",
        body.task.value, type(provider).__name__, result.prompt_tokens, result.completion_tokens,
    )
    return GenerateResponse(
        result=result.text,
        provider=type(provider).__name__,
        model=getattr(provider, "_model", None),
        fallback=fallback,
        usage=Usage(prompt_tokens=result.prompt_tokens, completion_tokens=result.completion_tokens),
    )


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
