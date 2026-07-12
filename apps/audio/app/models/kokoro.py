from functools import lru_cache
from kokoro import KPipeline


# One pipeline per lang_code — cached so they're only created once
@lru_cache
def get_kokoro_pipeline(lang_code: str) -> KPipeline:
    # Downloads voice models on first call, cached to HF_HOME volume after that
    return KPipeline(lang_code=lang_code)
