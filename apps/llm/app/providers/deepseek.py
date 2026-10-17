from .openai_compatible import OpenAICompatibleProvider


class DeepSeekProvider(OpenAICompatibleProvider):
    """DeepSeek cloud API (production)."""

    def __init__(self, api_key: str, model: str = "deepseek-chat"):
        super().__init__(base_url="https://api.deepseek.com", api_key=api_key, model=model)
