from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class GenerateOptions:
    """Per-request limits. Every call should be bounded to keep LLM spend low (TRACKER D10)."""
    max_tokens: int | None = None
    temperature: float | None = None
    json: bool = False  # ask the model for a single JSON object


@dataclass
class GenerateResult:
    text: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


class LLMProvider(ABC):
    def _build_messages(self, prompt: str, system: str | None) -> list[dict]:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        return messages

    @abstractmethod
    async def generate(
        self, prompt: str, system: str | None = None, options: GenerateOptions | None = None
    ) -> GenerateResult: ...

    async def stream(self, prompt: str, system: str | None = None):
        # Default fallback: return full response as a single chunk
        # Providers that support real streaming override this
        result = await self.generate(prompt=prompt, system=system)
        yield result.text
