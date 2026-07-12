import urllib.request
from functools import lru_cache
from pathlib import Path
from piper.voice import PiperVoice

MODELS_DIR = Path(__file__).parent.parent.parent / ".piper_models"
HF_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0"

# All available Piper voices: voice_name -> HuggingFace path prefix
# Format: {lang}/{locale}/{speaker}/{quality}
VOICE_PATHS = {
    # German
    "de_DE-thorsten-medium":    "de/de_DE/thorsten/medium",
    "de_DE-kerstin-low":        "de/de_DE/kerstin/low",
    "de_DE-eva_k-x_low":        "de/de_DE/eva_k/x_low",
    "de_DE-karlsson-low":       "de/de_DE/karlsson/low",

    # Dutch
    "nl_NL-mls-medium":         "nl/nl_NL/mls/medium",
    "nl_NL-mls_5809-low":       "nl/nl_NL/mls_5809/low",
    "nl_BE-nathalie-medium":    "nl/nl_BE/nathalie/medium",
    "nl_BE-rdh-medium":         "nl/nl_BE/rdh/medium",

    # Polish
    "pl_PL-mls-medium":         "pl/pl_PL/mls/medium",
    "pl_PL-gosia-medium":       "pl/pl_PL/gosia/medium",

    # Russian
    "ru_RU-ruslan-medium":      "ru/ru_RU/ruslan/medium",
    "ru_RU-denis-medium":       "ru/ru_RU/denis/medium",
    "ru_RU-irina-medium":       "ru/ru_RU/irina/medium",

    # Turkish
    "tr_TR-dfki-medium":        "tr/tr_TR/dfki/medium",

    # Arabic
    "ar_JO-kareem-medium":      "ar/ar_JO/kareem/medium",

    # Czech
    "cs_CZ-jirka-medium":       "cs/cs_CZ/jirka/medium",
    "cs_CZ-jirka-low":          "cs/cs_CZ/jirka/low",

    # Swedish
    "sv_SE-nst-medium":         "sv/sv_SE/nst/medium",

    # Norwegian
    "nb_NO-talesyntese-medium": "nb/nb_NO/talesyntese/medium",
    "nb_NO-lyse-low":           "nb/nb_NO/lyse/low",

    # Danish
    "da_DK-talesyntese-medium": "da/da_DK/talesyntese/medium",

    # Finnish
    "fi_FI-harri-medium":       "fi/fi_FI/harri/medium",
    "fi_FI-harri-low":          "fi/fi_FI/harri/low",

    # Greek
    "el_GR-rapunzelina-low":    "el/el_GR/rapunzelina/low",

    # Ukrainian
    "uk_UA-lada-x_low":         "uk/uk_UA/lada/x_low",

    # Korean
    "ko_KR-dawn-x_low":         "ko/ko_KR/dawn/x_low",
    "ko_KR-kss-medium":         "ko/ko_KR/kss/medium",

    # Vietnamese
    "vi_VN-25hours_single-low": "vi/vi_VN/25hours_single/low",
    "vi_VN-vivos-x_low":        "vi/vi_VN/vivos/x_low",

    # Hungarian
    "hu_HU-anna-medium":        "hu/hu_HU/anna/medium",
    "hu_HU-berta-medium":       "hu/hu_HU/berta/medium",

    # Romanian
    "ro_RO-mihai-medium":       "ro/ro_RO/mihai/medium",

    # Slovak
    "sk_SK-lili-medium":        "sk/sk_SK/lili/medium",

    # Catalan
    "ca_ES-upc_ona-medium":     "ca/ca_ES/upc_ona/medium",
    "ca_ES-upc_pau-medium":     "ca/ca_ES/upc_pau/medium",

    # Serbian
    "sr_RS-serbski_institut-medium": "sr/sr_RS/serbski_institut/medium",
}

# Default voice per language code — used when caller doesn't specify a voice
PIPER_DEFAULT_VOICES: dict[str, str] = {
    "de": "de_DE-thorsten-medium",
    "nl": "nl_NL-mls-medium",
    "pl": "pl_PL-mls-medium",
    "ru": "ru_RU-ruslan-medium",
    "tr": "tr_TR-dfki-medium",
    "ar": "ar_JO-kareem-medium",
    "cs": "cs_CZ-jirka-medium",
    "sv": "sv_SE-nst-medium",
    "nb": "nb_NO-talesyntese-medium",
    "da": "da_DK-talesyntese-medium",
    "fi": "fi_FI-harri-medium",
    "el": "el_GR-rapunzelina-low",
    "uk": "uk_UA-lada-x_low",
    "ko": "ko_KR-dawn-x_low",
    "vi": "vi_VN-25hours_single-low",
    "hu": "hu_HU-anna-medium",
    "ro": "ro_RO-mihai-medium",
    "sk": "sk_SK-lili-medium",
    "ca": "ca_ES-upc_ona-medium",
    "sr": "sr_RS-serbski_institut-medium",
}


def _download_voice(voice_name: str) -> Path:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    onnx_path = MODELS_DIR / f"{voice_name}.onnx"
    json_path  = MODELS_DIR / f"{voice_name}.onnx.json"

    path_prefix = VOICE_PATHS.get(voice_name)
    if not path_prefix:
        raise ValueError(f"Unknown Piper voice: '{voice_name}'. Check VOICE_PATHS in piper.py.")

    if not onnx_path.exists():
        print(f"Downloading Piper voice: {voice_name} ...")
        urllib.request.urlretrieve(f"{HF_BASE}/{path_prefix}/{voice_name}.onnx",      onnx_path)
        urllib.request.urlretrieve(f"{HF_BASE}/{path_prefix}/{voice_name}.onnx.json", json_path)
        print(f"Piper voice {voice_name} ready")

    return onnx_path


@lru_cache
def get_piper_voice(voice_name: str) -> PiperVoice:
    onnx_path = _download_voice(voice_name)
    return PiperVoice.load(str(onnx_path), config_path=str(onnx_path) + ".json")
