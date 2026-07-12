from enum import Enum
from .providers.base import LLMProvider


class TaskType(str, Enum):
    TRANSLATION = "translation"
    GRAMMAR_CHECK = "grammar_check"
    VOCABULARY = "vocabulary"
    CONVERSATION = "conversation"
    PRONUNCIATION_FEEDBACK = "pronunciation_feedback"


class LLMRouter:
    def __init__(self, providers: dict[str, LLMProvider], routing: dict[TaskType, str]):
        self._providers = providers
        self._routing = routing

    def get(self, task: TaskType) -> LLMProvider:
        provider_name = self._routing.get(task)
        if not provider_name:
            raise ValueError(f"No routing rule for task: {task}")
        provider = self._providers.get(provider_name)
        if not provider:
            raise ValueError(f"Provider '{provider_name}' is not configured")
        return provider
