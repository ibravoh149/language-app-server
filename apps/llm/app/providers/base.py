from abc import ABC, abstractmethod


class LLMProvider(ABC):
    def _build_messages(self, prompt: str, system: str | None) -> list[dict]:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        return messages

    @abstractmethod
    async def generate(self, prompt: str, system: str | None = None) -> str: ...

    async def stream(self, prompt: str, system: str | None = None):
        # Default fallback: return full response as a single chunk
        # Providers that support real streaming override this
        yield await self.generate(prompt=prompt, system=system)
