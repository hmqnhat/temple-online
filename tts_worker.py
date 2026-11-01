#!/usr/bin/env python3
"""
Persistent ZeroTTS Worker Daemon (voice='maichi' default).
- Strict Vietnamese-only text sanitizer: strips all Cuneiform (𒐫), Zalgo, emojis, and foreign scripts
  before passing to ZeroTTS so the model never chokes or glitches.
- Single-pass continuous synthesis + soft peak normalization (<= 0.90) + cosine fade-in/out.
- Low CPU configuration: intra_op_num_threads=3 + OMP_WAIT_POLICY=PASSIVE (0% CPU when idle).
"""
import hashlib
import json
import os
import re
import sys
import time
import traceback
import unicodedata
from pathlib import Path
from lib.tts_cache import prune_cache, MAX_AUDIO_BYTES

os.environ.setdefault("OMP_NUM_THREADS", "3")
os.environ.setdefault("OMP_WAIT_POLICY", "PASSIVE")
os.environ.setdefault("MKL_NUM_THREADS", "3")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "3")
os.environ.setdefault("VECLIB_MAXIMUM_THREADS", "3")

import numpy as np
from zerotts import ZeroTTS, normalize_vi_text
from zerotts.chunking import normalize_punctuation

CACHE_DIR = Path(os.environ.get("APP_DATA_DIR", Path(__file__).resolve().parent / "data")) / "tts-cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

MODEL_ID = "zeroweight-ai/ZeroTTS"
MODEL_REVISION = "18d6681518a4becaed3c125ceb3c7db59905fe86"

# Chỉ giữ lại chữ cái tiếng Việt (Latin + dấu tiếng Việt), chữ số và dấu câu cơ bản
VIETNAMESE_ALLOWED_RE = re.compile(
    r"[^0-9a-zA-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝàáâãèéêìíòóôõùúýĂăĐđĨĩŨũƠơƯưẠ-ỹ\s.,!?]"
)
BRACKET_EMOTE_RE = re.compile(r"\[[^\]]{1,24}\]")
REPEATED_CHARS_RE = re.compile(r"(.)\1{2,}", re.IGNORECASE)
MULTI_PUNCT_RE = re.compile(r"([.,!?])\1+")
MULTI_SPACE_RE = re.compile(r"\s+")


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def clean_and_normalize_text(raw_text: str) -> str:
    if not raw_text:
        return ""
    # 1. Chuẩn hóa NFKC (biến chữ kiểu toán học 𝒯𝒽𝒾ê𝓃 𝒯â𝓂 -> Thiên Tâm) rồi NFC
    text = unicodedata.normalize("NFC", unicodedata.normalize("NFKC", str(raw_text)))
    # 2. Xóa các mã emote kiểu [thanks], [rose]
    text = BRACKET_EMOTE_RE.sub(" ", text)
    # 3. Xóa sạch ký tự lạ (𒐫, emoji, ký tự ngoại ngữ, ký tự điều khiển)
    text = VIETNAMESE_ALLOWED_RE.sub(" ", text)
    # 4. Thu gọn ký tự lặp quá 2 lần (ví dụ: aaaaa -> aa, ..... -> .)
    text = MULTI_PUNCT_RE.sub(r"\1", text)
    text = REPEATED_CHARS_RE.sub(r"\1\1", text)
    text = MULTI_SPACE_RE.sub(" ", text).strip(" .,!?-")

    # Phải có ít nhất 2 chữ cái hợp lệ mới đọc
    letters = re.findall(r"[a-zA-ZÀ-ỹĂăĐđĨĩŨũƠơƯư]", text)
    if len(letters) < 2:
        return ""

    # Giới hạn độ dài an toàn cho 1 câu đọc TTS (tối đa 160 ký tự)
    if len(text) > 160:
        text = text[:160].rsplit(" ", 1)[0]

    normalized = normalize_vi_text(text)
    normalized = normalize_punctuation(normalized).strip()
    normalized = VIETNAMESE_ALLOWED_RE.sub(" ", normalized)
    normalized = MULTI_SPACE_RE.sub(" ", normalized).strip()
    if normalized and normalized[-1] not in ".!?":
        normalized += "."
    return normalized


def polish_waveform(wav: np.ndarray, sample_rate: int) -> np.ndarray:
    """De-click ends and prevent PCM_16 digital clipping ('xước/rè')."""
    arr = np.asarray(wav, dtype=np.float32).reshape(-1)
    if arr.size == 0:
        return arr.reshape(1, 0)

    arr = arr - np.mean(arr)

    peak = float(np.max(np.abs(arr)))
    if peak > 0.90:
        arr = arr * (0.90 / peak)

    fade_in = min(int(sample_rate * 0.012), arr.size // 4)
    fade_out = min(int(sample_rate * 0.020), arr.size // 4)
    if fade_in > 1:
        ramp_in = 0.5 * (1.0 - np.cos(np.linspace(0, np.pi, fade_in, dtype=np.float32)))
        arr[:fade_in] *= ramp_in
    if fade_out > 1:
        ramp_out = 0.5 * (1.0 + np.cos(np.linspace(0, np.pi, fade_out, dtype=np.float32)))
        arr[-fade_out:] *= ramp_out

    return arr.reshape(1, -1)


def main() -> None:
    t0 = time.time()
    prune_cache(CACHE_DIR)
    for partial in CACHE_DIR.glob("*.part.wav"):
        partial.unlink(missing_ok=True)
    emit({"type": "status", "status": "loading", "model": f"{MODEL_ID}@{MODEL_REVISION}"})

    try:
        tts = ZeroTTS.from_pretrained(
            MODEL_ID, revision=MODEL_REVISION,
            local_files_only=os.environ.get("TTS_ALLOW_MODEL_DOWNLOAD") != "1",
            intra_op_num_threads=3,
        )
        voices = tts.list_voices()
        default_voice = "maichi" if "maichi" in voices else (voices[0] if voices else None)
        load_sec = round(time.time() - t0, 2)
        emit({
            "type": "ready",
            "model": f"{MODEL_ID}@{MODEL_REVISION}",
            "voice": default_voice,
            "voices": voices,
            "sampleRate": int(tts.sample_rate),
            "loadSec": load_sec,
        })
    except Exception as exc:
        emit({
            "type": "error",
            "fatal": True,
            "error": str(exc),
            "trace": traceback.format_exc(),
        })
        sys.exit(1)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            text = req.get("text")
            voice = req.get("voice", "maichi")
            if not isinstance(text, str) or not 1 <= len(text) <= 320:
                raise ValueError("TTS text length must be 1–320 characters")
            if not isinstance(voice, str) or voice not in voices or not re.fullmatch(r"[a-z0-9_-]{1,40}", voice):
                raise ValueError("Unsupported voice")
            text = text.strip()
            prune_cache(CACHE_DIR)

            norm_text = clean_and_normalize_text(text)
            if not norm_text:
                emit({"type": "result", "id": req_id, "ok": False, "error": "Filtered empty/spam text"})
                continue

            cache_key = hashlib.sha256(f"v4::{MODEL_REVISION}::{voice}::{norm_text}".encode("utf-8")).hexdigest()[:32]
            out_name = f"{voice}_{cache_key}.wav"
            out_path = CACHE_DIR / out_name

            if out_path.is_file() and out_path.stat().st_size > 200:
                emit({
                    "type": "result",
                    "id": req_id,
                    "ok": True,
                    "cached": True,
                    "voice": voice,
                    "file": out_name,
                    "url": f"/tts-cache/{out_name}",
                    "synthSec": 0.0,
                })
                continue

            t_synth = time.time()
            raw_wav = tts.synthesize(norm_text, voice=voice, eoa_extra_frames=2)
            if raw_wav is None or raw_wav.size == 0:
                emit({"type": "result", "id": req_id, "ok": False, "error": "No audio generated"})
                continue

            clean_audio = polish_waveform(raw_wav, int(tts.sample_rate))
            if clean_audio.shape[-1] / float(tts.sample_rate) > 60:
                raise ValueError("Generated audio exceeds 60 seconds")
            partial_path = CACHE_DIR / f"{voice}_{cache_key}.part.wav"
            try:
                tts.save_audio(clean_audio, str(partial_path))
                size = partial_path.stat().st_size
                if size > MAX_AUDIO_BYTES:
                    raise ValueError("Generated audio exceeds cache file limit")
                prune_cache(CACHE_DIR, reserve_bytes=size)
                partial_path.replace(out_path)
            finally:
                partial_path.unlink(missing_ok=True)
            synth_sec = round(time.time() - t_synth, 2)
            duration_sec = round(clean_audio.shape[-1] / float(tts.sample_rate), 2)

            emit({
                "type": "result",
                "id": req_id,
                "ok": True,
                "cached": False,
                "voice": voice,
                "file": out_name,
                "url": f"/tts-cache/{out_name}",
                "synthSec": synth_sec,
                "durationSec": duration_sec,
            })
        except Exception as exc:
            emit({
                "type": "result",
                "id": req_id,
                "ok": False,
                "error": str(exc),
            })


if __name__ == "__main__":
    main()
