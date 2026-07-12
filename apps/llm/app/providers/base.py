from abc import ABC, abstractmethod


class LLMProvider(ABC):
    @abstractmethod
    async def generate(self, prompt: str, system: str | None = None) -> str:
        """Send a prompt and return the text response."""
        ...
