from openai import AsyncOpenAI
from .base import GenerateOptions, GenerateResult, LLMProvider


class OpenAICompatibleProvider(LLMProvider):
    """Shared implementation for providers that speak the OpenAI chat API (Ollama, DeepSeek)."""

    def __init__(self, base_url: str, api_key: str, model: str):
        self._model = model
        self._client = AsyncOpenAI(base_url=base_url, api_key=api_key)

    async def generate(
        self, prompt: str, system: str | None = None, options: GenerateOptions | None = None
    ) -> GenerateResult:
        options = options or GenerateOptions()
        kwargs = {}
        if options.max_tokens is not None:
            kwargs["max_tokens"] = options.max_tokens
        if options.temperature is not None:
            kwargs["temperature"] = options.temperature
        if options.json:
            kwargs["response_format"] = {"type": "json_object"}

        response = await self._client.chat.completions.create(
            model=self._model,
            messages=self._build_messages(prompt, system),
            **kwargs,
        )
        usage = response.usage
        return GenerateResult(
            text=response.choices[0].message.content or "",
            prompt_tokens=usage.prompt_tokens if usage else None,
            completion_tokens=usage.completion_tokens if usage else None,
        )

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
