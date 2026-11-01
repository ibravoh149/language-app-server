from .openai_compatible import OpenAICompatibleProvider


class GroqProvider(OpenAICompatibleProvider):
    """Groq cloud API (OpenAI-compatible, very fast inference). Free tier for development.

    gpt-oss models reason before answering; `reasoning_effort` ("low" by default) keeps
    turns fast and leaves room in max_tokens for the actual answer.
    """

    def __init__(self, api_key: str, model: str, reasoning_effort: str | None = "low"):
        extra = {"reasoning_effort": reasoning_effort} if reasoning_effort else None
        # max_retries=0: on a rate limit, fail fast and let the route fall back to the local model
        # instead of waiting through the client's exponential backoff.
        super().__init__(base_url="https://api.groq.com/openai/v1", api_key=api_key, model=model, extra_body=extra, max_retries=0)
