import json
import logging
from functools import lru_cache
from pydantic_settings import BaseSettings
from .providers.base import LLMProvider
from .providers.ollama import OllamaProvider
from .providers.deepseek import DeepSeekProvider
from .providers.groq import GroqProvider
from .router import LLMRouter, TaskType

logger = logging.getLogger("uvicorn.error")


class Settings(BaseSettings):
    # Ollama (local / self-hosted)
    ollama_base_url: str = "http://host.docker.internal:11434"
    ollama_model: str = "qwen2.5:7b"

    # DeepSeek cloud
    deepseek_api_key: str = ""
    deepseek_model: str = "deepseek-chat"

    # Groq cloud (fast; free tier for development)
    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-120b"
    # low | medium | high, or empty for models without reasoning
    groq_reasoning_effort: str = "low"

    # JSON map of task -> provider name, e.g. '{"translation":"ollama"}'
    # Defaults: all tasks go to ollama (safe for local dev with no API key)
    task_routing: str = json.dumps({t.value: "ollama" for t in TaskType})

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()


def build_router() -> LLMRouter:
    s = get_settings()

    providers: dict[str, LLMProvider] = {
        "ollama": OllamaProvider(base_url=s.ollama_base_url, model=s.ollama_model),
    }

    if s.deepseek_api_key:
        providers["deepseek"] = DeepSeekProvider(
            api_key=s.deepseek_api_key,
            model=s.deepseek_model,
        )

    if s.groq_api_key:
        providers["groq"] = GroqProvider(
            api_key=s.groq_api_key,
            model=s.groq_model,
            reasoning_effort=s.groq_reasoning_effort or None,
        )

    # Tasks missing from TASK_ROUTING, or routed to a provider without an API key, fall back to
    # the first configured hosted provider, else ollama. So a new task type or a missing key
    # never breaks an existing .env.
    fallback = next((p for p in ("groq", "deepseek") if p in providers), "ollama")
    routing = {t: fallback for t in TaskType}
    for task, provider in json.loads(s.task_routing).items():
        if provider in providers:
            routing[TaskType(task)] = provider
        else:
            logger.warning("TASK_ROUTING: %s -> %s has no API key; using %s", task, provider, fallback)
    return LLMRouter(providers=providers, routing=routing)
