from openai import AsyncOpenAI
from .base import LLMProvider


class DeepSeekProvider(LLMProvider):
    def __init__(self, api_key: str, model: str = "deepseek-chat"):
        self._model = model
        self._client = AsyncOpenAI(
            base_url="https://api.deepseek.com",
            api_key=api_key,
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
