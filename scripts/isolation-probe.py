"""Native imports and normalization inside the restrictive OS sandbox; no model loading."""
import importlib
import importlib.metadata
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time

secret, outside_write, forbidden_port, output = sys.argv[1:]
checks = {}
events = []


def audit(event, args):
    if event in {'socket.connect', 'subprocess.Popen', 'os.system', 'os.exec', 'os.fork'}:
        events.append({'event': event, 'args': str(args)[:400]})


sys.addaudithook(audit)


def denied(name, action):
    try:
        action()
        checks[name] = {'denied': False}
    except OSError as exc:
        checks[name] = {'denied': exc.errno in {1, 13}, 'errno': exc.errno}


denied('readFakeSecretOutsideAllowlist', lambda: Path(secret).read_bytes())
denied('writeOutsideWorkDirectory', lambda: Path(outside_write).write_text('fake'))
denied('spawnChildProcess', lambda: subprocess.run(['/usr/bin/true'], check=True))


def forbidden_connection():
    with socket.create_connection(('127.0.0.1', int(forbidden_port)), timeout=1.5):
        pass


denied('connectOutsideAllowedPort', forbidden_connection)
events.clear()  # Only report process/network activity from the dependency import phase below.
imports = []
modules = ['anyio', 'cffi', 'click', 'coloredlogs', 'filelock', 'flatbuffers', 'fsspec', 'h11', 'hf_xet',
           'httpcore2', 'httpx2', 'huggingface_hub', 'humanfriendly', 'idna', 'mpmath', 'numpy',
           'onnxruntime', 'packaging', 'google.protobuf', 'pycparser', 'yaml', 'scipy', 'sounddevice',
           'soundfile', 'sympy', 'tokenizers', 'tqdm', 'truststore', 'typing_extensions', 'zerotts']
for module in modules:
    started = time.monotonic()
    try:
        loaded = importlib.import_module(module)
        distribution = {'google.protobuf': 'protobuf', 'yaml': 'pyyaml'}.get(module, module.replace('_', '-'))
        imports.append({'module': module, 'ok': True, 'distributionVersion': importlib.metadata.version(distribution),
                        'moduleVersion': getattr(loaded, '__version__', None) if module == 'zerotts' else None,
                        'seconds': round(time.monotonic() - started, 3)})
    except Exception as exc:
        imports.append({'module': module, 'ok': False, 'error': f'{type(exc).__name__}: {exc}'})

try:
    import numpy as np
    import onnxruntime as ort
    from zerotts import normalize_vi_text
    assert np.array([1, 2, 3]).sum() == 6
    normalized = normalize_vi_text('Xin chào, chúc một ngày bình an.')
    assert isinstance(normalized, str) and normalized
    checks['nativeAndTextSmoke'] = {'passed': True, 'providers': ort.get_available_providers(),
                                    'textNormalized': bool(normalized), 'modelLoaded': False}
except Exception as exc:
    checks['nativeAndTextSmoke'] = {'passed': False, 'error': f'{type(exc).__name__}: {exc}'}

checks['imports'] = imports
checks['observedPythonAuditEvents'] = events
Path(output).write_text(json.dumps(checks, indent=2))
ok = all(checks[name]['denied'] for name in ['readFakeSecretOutsideAllowlist', 'writeOutsideWorkDirectory',
                                          'spawnChildProcess', 'connectOutsideAllowedPort'])
sys.exit(0 if ok and all(item['ok'] for item in imports) and checks['nativeAndTextSmoke']['passed'] else 1)
