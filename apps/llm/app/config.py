import json
from functools import lru_cache
from pydantic_settings import BaseSettings
from .providers.base import LLMProvider
from .providers.ollama import OllamaProvider
from .providers.deepseek import DeepSeekProvider
from .router import LLMRouter, TaskType


class Settings(BaseSettings):
    # Ollama (local / self-hosted)
    ollama_base_url: str = "http://host.docker.internal:11434"
    ollama_model: str = "deepseek-r1:14b"

    # DeepSeek cloud
    deepseek_api_key: str = ""
    deepseek_model: str = "deepseek-chat"

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

    routing = {TaskType(k): v for k, v in json.loads(s.task_routing).items()}
    return LLMRouter(providers=providers, routing=routing)
