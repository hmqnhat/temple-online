#!/usr/bin/env python3
"""Download the app's pinned model into its own cache and verify every file.

Does not load ONNX graphs, run synthesis, or use Hugging Face credentials.
"""
import argparse
import ast
from datetime import datetime, timezone
import fnmatch
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
CACHE = DATA / 'model-cache'
REPORT = ROOT / 'docs/security/zerotts-model-install.json'


def worker_constants():
    constants = {}
    for node in ast.parse((ROOT / 'tts_worker.py').read_text()).body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in {'MODEL_ID', 'MODEL_REVISION'}:
                    constants[target.id] = ast.literal_eval(node.value)
    return constants['MODEL_ID'], constants['MODEL_REVISION']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--inspect-only', action='store_true')
    args = parser.parse_args()
    for key, value in {'HF_HOME': str(CACHE), 'HF_HUB_DISABLE_IMPLICIT_TOKEN': '1',
                       'HF_HUB_DISABLE_TELEMETRY': '1', 'DO_NOT_TRACK': '1',
                       'ZEROTTS_VOICES_HOME': str(DATA / 'voices')}.items():
        os.environ[key] = value
    from huggingface_hub import HfApi, snapshot_download
    from zerotts.hub import _ALLOW_PATTERNS, REQUIRED_FILES

    repo, revision = worker_constants()
    info = HfApi(token=False).model_info(repo, revision=revision, files_metadata=True, timeout=45)
    if info.sha != revision:
        raise RuntimeError('Hub returned a different model revision')
    files = []
    for sibling in info.siblings:
        name = sibling.rfilename
        if not any(fnmatch.fnmatchcase(name, pattern) for pattern in _ALLOW_PATTERNS):
            continue
        parts = PurePosixPath(name)
        if parts.is_absolute() or '..' in parts.parts or '\\' in name:
            raise RuntimeError(f'Unsafe model path: {name}')
        if not isinstance(sibling.size, int) or not sibling.blob_id:
            raise RuntimeError(f'Missing file metadata: {name}')
        files.append({'file': name, 'bytes': sibling.size, 'gitBlob': sibling.blob_id,
                      'lfsSha256': sibling.lfs.sha256 if sibling.lfs else None})
    names = {entry['file'] for entry in files}
    for required in [*REQUIRED_FILES, 'tokenizer.json', 'voices/maichi/voice.npz',
                     'onnx/codec/codec_browser_onnx_meta.json']:
        if required not in names:
            raise RuntimeError(f'Pinned revision missing required file: {required}')
    total = sum(entry['bytes'] for entry in files)
    print(json.dumps({'repo': repo, 'revision': revision, 'files': len(files),
                      'bytes': total, 'GiB': round(total / 1024**3, 3), 'cache': str(CACHE)}, ensure_ascii=False), flush=True)
    report = {'checkedUtc': datetime.now(timezone.utc).isoformat(), 'repo': repo,
              'revision': revision, 'bytes': total, 'files': files, 'downloaded': False}
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=2) + '\n')
    if args.inspect_only:
        return
    if shutil.disk_usage(ROOT).free < total * 2 + 512 * 1024**2:
        raise RuntimeError('Not enough free disk space for download and cache')
    CACHE.mkdir(parents=True, exist_ok=True)
    snapshot = Path(snapshot_download(repo, revision=revision, token=False,
                    cache_dir=CACHE / 'hub', allow_patterns=[entry['file'] for entry in files], max_workers=3))
    for entry in files:
        file = snapshot / entry['file']
        if not file.is_file() or file.stat().st_size != entry['bytes']:
            raise RuntimeError(f'Missing or truncated model file: {entry["file"]}')
        sha256 = hashlib.sha256()
        git_blob = hashlib.sha1(f'blob {entry["bytes"]}\0'.encode())
        with file.open('rb') as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                sha256.update(chunk)
                git_blob.update(chunk)
        if entry['lfsSha256']:
            valid = sha256.hexdigest() == entry['lfsSha256']
        else:
            valid = git_blob.hexdigest() == entry['gitBlob']
        if not valid:
            raise RuntimeError(f'Model file hash mismatch: {entry["file"]}')
        entry['localSha256'] = sha256.hexdigest()
        entry['verified'] = True
    report.update(downloaded=True, snapshot=str(snapshot), verifiedFiles=len(files))
    REPORT.write_text(json.dumps(report, indent=2) + '\n')
    print(f'OK: downloaded and hash-verified {len(files)} model/voice files; no model code executed.', flush=True)


if __name__ == '__main__':
    main()
