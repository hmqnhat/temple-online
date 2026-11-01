#!/usr/bin/env python3
"""Run deterministic probes in macOS Seatbelt. Not a malware certification or VM.

No real credentials/model/TikTok connection. A parent canary verifies forbidden
network access against a listening local server, avoiding ambiguous Internet timeouts.
"""
import http.server
import json
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'docs/security/dependency-audit'


def sb_string(value):
    return json.dumps(str(value))


def main():
    if sys.platform != 'darwin':
        raise SystemExit('This probe requires macOS sandbox-exec; use a dedicated VM on other platforms.')
    node = Path(shutil.which('node')).resolve()
    python = ROOT / '.venv/bin/python'
    python_installation = python.resolve().parents[1]
    hits = []

    class Canary(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            hits.append(self.path)
            self.send_response(200)
            self.end_headers()
        def log_message(self, *_args):
            pass

    canary = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Canary)
    # Count connections as well as requests; the probes deliberately do not send HTTP.
    original_get_request = canary.get_request
    def get_request():
        result = original_get_request()
        hits.append('TCP_ACCEPT')
        return result
    canary.get_request = get_request
    threading.Thread(target=canary.serve_forever, daemon=True).start()
    results = {}
    try:
        with tempfile.TemporaryDirectory(prefix='zane-isolated-') as temporary:
            temp = Path(temporary).resolve()
            work = temp / 'work'
            work.mkdir()
            secret = temp / 'fake-private-key.txt'
            secret.write_text('FAKE_CANARY_NOT_A_REAL_SECRET')
            outside_write = temp / 'should-not-exist.txt'
            with socket.socket() as available:
                available.bind(('127.0.0.1', 0))
                app_port = available.getsockname()[1]
            profile = '\n'.join([
                '(version 1)', '(allow default)',
                '(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "/private/tmp") (subpath "/private/var/folders"))',
                '(allow file-read-metadata)',
                '(allow file-read* ' + ' '.join(f'(subpath {sb_string(p)})' for p in [
                    ROOT, python_installation, node.parents[1], '/System', '/usr', '/bin', '/sbin',
                    '/private/etc', '/private/var/db/timezone', '/dev']) + ')',
                '(deny file-write*)', f'(allow file-write* (subpath {sb_string(work)}) (literal "/dev/null"))',
                f'(allow file-read* (subpath {sb_string(work)}))',
                '(deny network*)',
                f'(allow network-bind (local ip "localhost:{app_port}"))',
                f'(allow network-inbound (local ip "localhost:{app_port}"))',
                f'(allow network-outbound (remote ip "localhost:{app_port}"))',
                '(deny process-fork)',
            ]) + '\n'
            profile_file = temp / 'audit.sb'
            profile_file.write_text(profile)
            OUTPUT.mkdir(parents=True, exist_ok=True)
            (OUTPUT / 'isolation-profile.sb').write_text(profile)
            env = {'PATH': '/usr/bin:/bin', 'LANG': 'en_US.UTF-8', 'PYTHONNOUSERSITE': '1',
                   'PYTHONDONTWRITEBYTECODE': '1', 'PORT': str(app_port),
                   'APP_DATA_DIR': str(work / 'data'), 'ENABLE_TTS': '0',
                   'ADMIN_TOKEN': 'isolation_test_' + 'e' * 40,
                   'HF_HOME': str(work / 'hf-cache'), 'HF_HUB_OFFLINE': '1',
                   'HF_HUB_DISABLE_IMPLICIT_TOKEN': '1', 'HF_HUB_DISABLE_TELEMETRY': '1',
                   'ZEROTTS_VOICES_HOME': str(work / 'voices'), 'DO_NOT_TRACK': '1',
                   'OMP_NUM_THREADS': '2', 'OPENBLAS_NUM_THREADS': '2'}
            for name, executable, args in [('node', node, [str(ROOT / 'scripts/isolation-probe.cjs')]),
                                           ('python', python, ['-I', str(ROOT / 'scripts/isolation-probe.py')])]:
                output = work / f'{name}-result.json'
                command = ['/usr/bin/sandbox-exec', '-f', str(profile_file), str(executable), *args,
                           str(secret), str(outside_write), str(canary.server_port), str(output)]
                try:
                    completed = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True, timeout=55)
                    results[name] = {'exitCode': completed.returncode, 'stdout': completed.stdout[-6000:],
                                     'stderr': completed.stderr[-6000:],
                                     'checks': json.loads(output.read_text()) if output.exists() else None}
                except subprocess.TimeoutExpired:
                    results[name] = {'timeout': True}
            results['forbiddenCanaryConnections'] = hits
            results['outsideWriteCreated'] = outside_write.exists()
            results['scope'] = 'macOS OS sandbox; real Node dependencies, native Python imports; no LIVE, model load or TTS inference'
            (OUTPUT / 'isolation-results.json').write_text(json.dumps(results, indent=2) + '\n')
    finally:
        canary.shutdown()
        canary.server_close()
    print(json.dumps(results, indent=2))
    return 0 if all(results.get(name, {}).get('exitCode') == 0 for name in ['node', 'python']) and not hits else 1


if __name__ == '__main__':
    sys.exit(main())
