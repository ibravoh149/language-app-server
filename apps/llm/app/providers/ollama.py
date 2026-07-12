from openai import AsyncOpenAI
from .base import LLMProvider


class OllamaProvider(LLMProvider):
    def __init__(self, base_url: str, model: str):
        self._model = model
        self._client = AsyncOpenAI(
            base_url=f"{base_url}/v1",
            api_key="ollama",  # Ollama doesn't require a real key
        )

    async def generate(self, prompt: str, system: str | None = None) -> str:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        response = await self._client.chat.completions.create(
            model=self._model,
            messages=messages,
        )
        return response.choices[0].message.content
