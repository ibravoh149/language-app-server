import urllib.request
from functools import lru_cache
from pathlib import Path
from piper.voice import PiperVoice

MODELS_DIR = Path(__file__).parent.parent.parent / ".piper_models"
HF_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0"

# Map of voice name -> HuggingFace path prefix
VOICE_PATHS = {
    "de_DE-thorsten-medium": "de/de_DE/thorsten/medium",
    "de_DE-kerstin-low":     "de/de_DE/kerstin/low",
    "de_DE-eva_k-x_low":     "de/de_DE/eva_k/x_low",
}


def _download_voice(voice_name: str) -> Path:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    onnx_path = MODELS_DIR / f"{voice_name}.onnx"
    json_path  = MODELS_DIR / f"{voice_name}.onnx.json"

    path_prefix = VOICE_PATHS.get(voice_name)
    if not path_prefix:
        raise ValueError(f"Unknown Piper voice: {voice_name}")

    if not onnx_path.exists():
        print(f"Downloading Piper voice: {voice_name}")
        urllib.request.urlretrieve(f"{HF_BASE}/{path_prefix}/{voice_name}.onnx",      onnx_path)
        urllib.request.urlretrieve(f"{HF_BASE}/{path_prefix}/{voice_name}.onnx.json", json_path)
        print(f"Piper voice {voice_name} ready")

    return onnx_path


@lru_cache
def get_piper_voice(voice_name: str) -> PiperVoice:
    onnx_path = _download_voice(voice_name)
    return PiperVoice.load(str(onnx_path), config_path=str(onnx_path) + ".json")
