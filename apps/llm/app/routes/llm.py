from fastapi import APIRouter, HTTPException
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
