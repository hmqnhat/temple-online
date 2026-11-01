#!/usr/bin/env python3
"""Static dependency triage; never imports package code or runs lifecycle hooks.

Optional npm verification downloads official registry tarballs and compares installed files.
Wheel verification checks requirements.lock, internal RECORD, startup hooks and sensitive sinks.
Findings are leads for review, not malware verdicts.
"""
import argparse
import base64
import concurrent.futures
import csv
import email
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import tarfile
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'docs/security/dependency-audit'
RULES = {
    'sensitive_paths': re.compile(r'\.ssh\b|\.aws\b|\.npmrc\b|Keychain|Login Data|Cookies\.sqlite|Local State|\.netrc\b|\.pypirc\b', re.I),
    'persistence': re.compile(r'LaunchAgents|LaunchDaemons|launchctl|osascript|crontab|schtasks', re.I),
    'process_execution': re.compile(r'child_process|\bexecSync\b|\bspawnSync\b|\bsubprocess\.|\bos\.system\s*\(|\bos\.popen\s*\('),
    'dynamic_execution': re.compile(r'\beval\s*\(|\bexec\s*\(|new\s+Function\s*\('),
    'unsafe_deserialization': re.compile(r'pickle\.loads?\s*\(|allow_pickle\s*=\s*True|torch\.load\s*\('),
}
CODE_EXTENSIONS = {'.js', '.cjs', '.mjs', '.py', '.sh', '.ps1'}
NATIVE_EXTENSIONS = {'.so', '.dylib', '.dll', '.node', '.wasm', '.pyd', '.exe'}


def canonical(name):
    return re.sub(r'[-_.]+', '-', name).lower()


def safe_member(name):
    path = PurePosixPath(name)
    return not path.is_absolute() and '..' not in path.parts and '\\' not in name


def scan_text(package, name, text):
    hits = []
    for number, line in enumerate(text.splitlines(), 1):
        for rule, regex in RULES.items():
            match = regex.search(line)
            if match:
                start = max(0, match.start() - 60)
                hits.append({'package': package, 'file': name, 'line': number, 'rule': rule,
                             'snippet': line[start:start + 240]})
    return hits


def verify_npm(entry):
    relative, item = entry
    url = item['resolved']
    if urllib.parse.urlparse(url).hostname != 'registry.npmjs.org':
        raise ValueError(f'Unexpected npm registry: {relative}')
    request = urllib.request.Request(url, headers={'User-Agent': 'local-dependency-audit/1.0'})
    with urllib.request.urlopen(request, timeout=40) as response:
        data = response.read(32 * 1024 * 1024 + 1)
    if len(data) > 32 * 1024 * 1024:
        raise ValueError(f'Oversized npm archive: {relative}')
    algorithm, encoded = item['integrity'].split('-', 1)
    if algorithm not in {'sha512', 'sha256'} or base64.b64encode(hashlib.new(algorithm, data).digest()).decode() != encoded:
        raise ValueError(f'npm integrity mismatch: {relative}')
    mismatches, links = [], []
    checked = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        members = archive.getmembers()
        roots = {PurePosixPath(member.name).parts[0] for member in members}
        if len(roots) != 1:
            raise ValueError(f'Multiple npm archive roots: {relative}')
        for member in members:
            if not safe_member(member.name):
                raise ValueError(f'Unsafe npm archive path: {relative}/{member.name}')
            name = str(PurePosixPath(*PurePosixPath(member.name).parts[1:]))
            if member.issym() or member.islnk():
                links.append({'file': name, 'target': member.linkname})
            if not member.isfile():
                continue
            expected = archive.extractfile(member).read()
            installed = ROOT / relative / name
            if not installed.is_file() or installed.is_symlink() or hashlib.sha256(installed.read_bytes()).digest() != hashlib.sha256(expected).digest():
                mismatches.append(name)
            checked += 1
    return {'package': relative, 'version': item['version'], 'archiveIntegrity': True,
            'comparedFiles': checked, 'mismatches': mismatches, 'archiveLinks': links}


def npm_scan(online):
    lock = json.loads((ROOT / 'package-lock.json').read_text())
    findings, native, hooks, prepare = [], [], [], []
    files = 0
    packages = [(name, item) for name, item in lock['packages'].items() if name]
    for relative, _ in packages:
        root = ROOT / relative
        meta = json.loads((root / 'package.json').read_text())
        for hook, command in meta.get('scripts', {}).items():
            if hook in {'preinstall', 'install', 'postinstall'}:
                hooks.append({'package': meta['name'], 'hook': hook, 'command': command})
            if hook == 'prepare':
                prepare.append({'package': meta['name'], 'command': command})
        for file in root.rglob('*'):
            if not file.is_file() or file.is_symlink() or 'node_modules' in file.relative_to(root).parts:
                continue
            name = str(file.relative_to(root))
            if file.suffix in NATIVE_EXTENSIONS:
                native.append({'package': meta['name'], 'file': name, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
            if file.suffix in CODE_EXTENSIONS:
                files += 1
                findings.extend(scan_text(meta['name'], name, file.read_text(errors='replace')))
    report = {'packages': len(packages), 'codeFilesScanned': files, 'automaticInstallHooks': hooks,
              'prepareScripts': prepare, 'nativeFiles': native, 'triageFindings': findings}
    if online:
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            report['registryComparisons'] = list(pool.map(verify_npm, packages))
    (OUTPUT / 'npm-static-review.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'npmPackages': len(packages), 'codeFiles': files, 'installHooks': len(hooks),
                      'nativeFiles': len(native), 'triageLeads': len(findings),
                      'mismatchedPackages': [r['package'] for r in report.get('registryComparisons', []) if r['mismatches']]}))
    if any(item['mismatches'] for item in report.get('registryComparisons', [])):
        raise SystemExit('Installed npm files differ from registry artifacts; inspect npm-static-review.json before running.')


def wheel_scan(directory):
    lock = (ROOT / 'requirements.lock').read_text()
    expected = {}
    for block in re.split(r'(?m)^(?=[A-Za-z0-9_-]+==)', lock)[1:]:
        name, version = block.splitlines()[0].rstrip(' \\').split('==')
        expected[canonical(name)] = (version, set(re.findall(r'--hash=sha256:([a-f0-9]{64})', block)))
    reports, findings = [], []
    for wheel in sorted(directory.glob('*.whl')):
        digest = hashlib.sha256(wheel.read_bytes()).hexdigest()
        with zipfile.ZipFile(wheel) as archive:
            names = archive.namelist()
            if any(not safe_member(name) for name in names):
                raise ValueError(f'Unsafe wheel path: {wheel.name}')
            metadata_name = next(name for name in names if name.endswith('.dist-info/METADATA'))
            metadata = email.message_from_bytes(archive.read(metadata_name))
            name, version = metadata['Name'], metadata['Version']
            wanted_version, hashes = expected[canonical(name)]
            if version != wanted_version or digest not in hashes:
                raise ValueError(f'Wheel not authorized by lockfile: {wheel.name}')
            record_name = metadata_name.removesuffix('METADATA') + 'RECORD'
            record_rows = list(csv.reader(io.StringIO(archive.read(record_name).decode())))
            recorded = set()
            verified = 0
            for file, checksum, size in record_rows:
                recorded.add(file)
                if not checksum:
                    if file != record_name:
                        raise ValueError(f'Unhashed wheel member: {wheel.name}/{file}')
                    continue
                algorithm, encoded = checksum.split('=', 1)
                if algorithm not in {'sha256', 'sha384', 'sha512'}:
                    raise ValueError(f'Unexpected RECORD hash: {wheel.name}')
                data = archive.read(file)
                actual = base64.urlsafe_b64encode(hashlib.new(algorithm, data).digest()).decode().rstrip('=')
                if actual != encoded.rstrip('=') or str(len(data)) != size:
                    raise ValueError(f'RECORD mismatch: {wheel.name}/{file}')
                verified += 1
            unrecorded = [n for n in names if not n.endswith('/') and n not in recorded]
            if unrecorded:
                raise ValueError(f'Unrecorded wheel members: {wheel.name}/{unrecorded}')
            code_files, native, startup_hooks, endpoints = 0, [], [], set()
            for file in names:
                ext = PurePosixPath(file).suffix
                if ext in NATIVE_EXTENSIONS:
                    native.append({'file': file, 'sha256': hashlib.sha256(archive.read(file)).hexdigest()})
                if ext == '.pth' or PurePosixPath(file).name in {'sitecustomize.py', 'usercustomize.py'}:
                    startup_hooks.append({'file': file, 'contents': archive.read(file).decode(errors='replace')[:4000]})
                if ext in CODE_EXTENSIONS:
                    text = archive.read(file).decode(errors='replace')
                    code_files += 1
                    findings.extend(scan_text(name, file, text))
                    endpoints.update(re.findall(r'https?://[A-Za-z0-9_.:-]+', text))
            reports.append({'name': name, 'version': version, 'wheel': wheel.name, 'sha256': digest,
                            'lockHashVerified': True, 'recordFilesVerified': verified, 'codeFilesScanned': code_files,
                            'startupHooks': startup_hooks, 'nativeFiles': native, 'urlLiterals': sorted(endpoints),
                            'projectURLs': metadata.get_all('Project-URL', []),
                            'entryPoints': [n for n in names if n.endswith('.dist-info/entry_points.txt')]})
    missing = set(expected) - {canonical(r['name']) for r in reports}
    if missing:
        raise ValueError(f'Missing wheels: {sorted(missing)}')
    (OUTPUT / 'python-static-review.json').write_text(json.dumps({'packages': reports, 'triageFindings': findings}, indent=2) + '\n')
    print(json.dumps({'pythonWheels': len(reports), 'codeFiles': sum(r['codeFilesScanned'] for r in reports),
                      'nativeFiles': sum(len(r['nativeFiles']) for r in reports),
                      'startupHooks': sum(len(r['startupHooks']) for r in reports), 'triageLeads': len(findings)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--npm', action='store_true')
    parser.add_argument('--verify-npm-registry', action='store_true')
    parser.add_argument('--wheels', type=Path)
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    if args.npm or args.verify_npm_registry:
        npm_scan(args.verify_npm_registry)
    if args.wheels:
        wheel_scan(args.wheels)
