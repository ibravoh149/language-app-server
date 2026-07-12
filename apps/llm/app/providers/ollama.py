from openai import AsyncOpenAI
from .base import LLMProvider


class OllamaProvider(LLMProvider):
    def __init__(self, base_url: str, model: str):
        self._model = model
        self._client = AsyncOpenAI(
            base_url=f"{base_url}/v1",
            api_key="ollama",
        )

    async def generate(self, prompt: str, system: str | None = None) -> str:
        response = await self._client.chat.completions.create(
            model=self._model,
            messages=self._build_messages(prompt, system),
        )
        return response.choices[0].message.content

    async def stream(self, prompt: str, system: str | None = None):
        response = await self._client.chat.completions.create(
            model=self._model,
            messages=self._build_messages(prompt, system),
            stream=True,
        )
        async for chunk in response:
            content = chunk.choices[0].delta.content
            if content:
                yield content
