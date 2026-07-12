from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Faster-Whisper — STT
    whisper_model_size: str = "small"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"

    # Kokoro — TTS default
    kokoro_default_voice: str = "af_heart"
    kokoro_default_lang: str = "a"

    # Piper — default voice per language (override via env var if needed)
    piper_voice_de: str = "de_DE-thorsten-medium"
    piper_voice_nl: str = "nl_NL-mls-medium"
    piper_voice_pl: str = "pl_PL-mls-medium"
    piper_voice_ru: str = "ru_RU-ruslan-medium"
    piper_voice_tr: str = "tr_TR-dfki-medium"
    piper_voice_ar: str = "ar_JO-kareem-medium"
    piper_voice_cs: str = "cs_CZ-jirka-medium"
    piper_voice_sv: str = "sv_SE-nst-medium"
    piper_voice_nb: str = "nb_NO-talesyntese-medium"
    piper_voice_da: str = "da_DK-talesyntese-medium"
    piper_voice_fi: str = "fi_FI-harri-medium"
    piper_voice_el: str = "el_GR-rapunzelina-low"
    piper_voice_uk: str = "uk_UA-lada-x_low"
    piper_voice_ko: str = "ko_KR-dawn-x_low"
    piper_voice_vi: str = "vi_VN-25hours_single-low"
    piper_voice_hu: str = "hu_HU-anna-medium"
    piper_voice_ro: str = "ro_RO-mihai-medium"
    piper_voice_sk: str = "sk_SK-lili-medium"
    piper_voice_ca: str = "ca_ES-upc_ona-medium"
    piper_voice_sr: str = "sr_RS-serbski_institut-medium"

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()


def get_piper_voice_for_language(lang: str) -> str:
    """Return the configured default Piper voice for a language code."""
    s = get_settings()
    mapping = {
        "de": s.piper_voice_de,
        "nl": s.piper_voice_nl,
        "pl": s.piper_voice_pl,
        "ru": s.piper_voice_ru,
        "tr": s.piper_voice_tr,
        "ar": s.piper_voice_ar,
        "cs": s.piper_voice_cs,
        "sv": s.piper_voice_sv,
        "nb": s.piper_voice_nb,
        "da": s.piper_voice_da,
        "fi": s.piper_voice_fi,
        "el": s.piper_voice_el,
        "uk": s.piper_voice_uk,
        "ko": s.piper_voice_ko,
        "vi": s.piper_voice_vi,
        "hu": s.piper_voice_hu,
        "ro": s.piper_voice_ro,
        "sk": s.piper_voice_sk,
        "ca": s.piper_voice_ca,
        "sr": s.piper_voice_sr,
    }
    return mapping[lang]


# Maps standard language codes to engine + Kokoro lang_code (where applicable)
LANGUAGE_ROUTING: dict[str, dict] = {
    # ── Kokoro ──────────────────────────────────────────────────────────────
    "en":    {"engine": "kokoro", "lang_code": "a"},
    "en-us": {"engine": "kokoro", "lang_code": "a"},
    "en-gb": {"engine": "kokoro", "lang_code": "b"},
    "es":    {"engine": "kokoro", "lang_code": "e"},
    "fr":    {"engine": "kokoro", "lang_code": "f"},
    "hi":    {"engine": "kokoro", "lang_code": "h"},
    "it":    {"engine": "kokoro", "lang_code": "i"},
    "ja":    {"engine": "kokoro", "lang_code": "j"},
    "pt":    {"engine": "kokoro", "lang_code": "p"},
    "zh":    {"engine": "kokoro", "lang_code": "z"},

    # ── Piper ────────────────────────────────────────────────────────────────
    "de": {"engine": "piper"},
    "nl": {"engine": "piper"},
    "pl": {"engine": "piper"},
    "ru": {"engine": "piper"},
    "tr": {"engine": "piper"},
    "ar": {"engine": "piper"},
    "cs": {"engine": "piper"},
    "sv": {"engine": "piper"},
    "nb": {"engine": "piper"},
    "da": {"engine": "piper"},
    "fi": {"engine": "piper"},
    "el": {"engine": "piper"},
    "uk": {"engine": "piper"},
    "ko": {"engine": "piper"},
    "vi": {"engine": "piper"},
    "hu": {"engine": "piper"},
    "ro": {"engine": "piper"},
    "sk": {"engine": "piper"},
    "ca": {"engine": "piper"},
    "sr": {"engine": "piper"},
}
