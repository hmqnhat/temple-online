"""Bounded local audio cache; independent of native TTS dependencies."""
import os
import re
import time

MAX_CACHE_BYTES = 128 * 1024 * 1024
MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_FILES = 256
TTL_SECONDS = 24 * 3600
PIN_SECONDS = 420


def pin_file(path):
    os.utime(path, None)


WAV_NAME = re.compile(r"[a-z0-9_-]+\.wav\Z")


def prune_cache(directory, reserve_bytes=0, now=None):
    now = time.time() if now is None else now
    entries = []
    for file in directory.iterdir():
        if not WAV_NAME.fullmatch(file.name) or file.is_symlink() or not file.is_file():
            continue
        stat = file.stat()
        if now - stat.st_mtime > TTL_SECONDS or stat.st_size > MAX_AUDIO_BYTES:
            file.unlink(missing_ok=True)
        else:
            entries.append((stat.st_mtime, stat.st_size, file))
    entries.sort(key=lambda item: item[0])
    size = sum(item[1] for item in entries)
    count = len(entries)
    for modified, length, file in entries:
        if size + reserve_bytes <= MAX_CACHE_BYTES and count < MAX_FILES:
            break
        if now - modified < PIN_SECONDS:
            continue
        file.unlink(missing_ok=True)
        size -= length
        count -= 1

    if size + reserve_bytes > MAX_CACHE_BYTES or (reserve_bytes and count >= MAX_FILES):
        raise ValueError("cache_capacity_pinned")
