from .openai_compatible import OpenAICompatibleProvider


class OllamaProvider(OpenAICompatibleProvider):
    """Local Ollama through its OpenAI-compatible endpoint. Development only (TRACKER D9)."""

    def __init__(self, base_url: str, model: str):
        super().__init__(base_url=f"{base_url}/v1", api_key="ollama", model=model)
