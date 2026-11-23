#!/usr/bin/env python3
"""Read-only release preflight. Run: python scripts/release_preflight.py DIST [VERSION]."""
import gzip
import io
import json
import re
import stat
import sys
import tarfile
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
TOKENS = {
    'private key': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'GitHub token': re.compile(rb'\b(?:gh[opusr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b'),
    'API key': re.compile(rb'\bsk-[A-Za-z0-9_-]{32,}\b'),
    'credential in URL': re.compile(rb'https?://[^\s/:@]+:[^\s/@]{8,}@'),
}

# Verified false positives in upstream @deepseek-ai/dsh vendor runtime (see docs/release-preflight-allowlist.md).
# Keyed by exact inner archive path (with trailing kind), never wildcarding runtime/node_modules as a whole.
VENDOR_ALLOWLIST = {
    ('runtime/node_modules/@deepseek-ai/dsh-experimental-inspector/lib/devtools/chunks/legacy-dM_vujv7.js', 'credential in URL'),
    ('runtime/node_modules/@deepseek-ai/dsh-experimental-inspector/lib/devtools/entrypoints/lighthouse_worker/lighthouse_worker.js', 'credential in URL'),
    ('runtime/node_modules/@deepseek-ai/dsh-experimental-inspector/lib/devtools/models/issues_manager/descriptions/corsRedirectContainsCredentials.md', 'credential in URL'),
    ('runtime/node_modules/http2-wrapper/README.md', 'credential in URL'),
    ('runtime/node_modules/jose/dist/webapi/key/import.js', 'private key'),
    ('runtime/node_modules/normalize-url/index.d.ts', 'credential in URL'),
    ('runtime/node_modules/normalize-url/readme.md', 'credential in URL'),
    *{
        (f'runtime/node_modules/@opentelemetry/semantic-conventions/dist/{stem}.{ext}', 'credential in URL')
        for stem in ('experimental_attributes', 'stable_attributes', 'trace/SemanticAttributes')
        for ext in ('cjs', 'cjs.map', 'mjs', 'mjs.map', 'd.cts', 'd.mts')
    },
}


def is_allowlisted(label, kind):
    if '!' not in label:
        return False
    inner = label.split('!', 1)[1].lstrip('./').replace('\\', '/')
    return (inner, kind) in VENDOR_ALLOWLIST


def assets(version):
    """Final asset set: four system bundles plus one bare plugin tarball.

    v0.3.6 dropped the Purge and Clean variants and the -Stable suffix, so this
    list is the only definition of what a release should contain.
    """
    names = {f'Super-Agent-Bundled-{os}-{arch}-v{version}.zip'
             for os, arch in [('Windows', 'x64'), ('macOS', 'arm64'), ('macOS', 'x64'), ('Linux', 'x64')]}
    names |= {f'Super-Agent-Plugin-v{version}.tgz'}
    return names


def unsafe_name(name):
    path = PurePosixPath(name.replace('\\', '/'))
    return path.is_absolute() or '..' in path.parts or bool(re.match(r'^[A-Za-z]:', name))


def inspect_stream(stream, label, issues):
    # Carry overlap across chunks so a token crossing a read boundary is detected.
    tail = b''
    found = set()
    while chunk := stream.read(1024 * 1024):
        data = tail + chunk
        for kind, pattern in TOKENS.items():
            if kind not in found and pattern.search(data):
                if not is_allowlisted(label, kind):
                    issues.append(f'{label}: possible {kind} (value redacted)')
                found.add(kind)
        tail = data[-512:]


def check_name(name, label, issues):
    if unsafe_name(name):
        issues.append(f'{label}: unsafe archive path: {name}')
    parts = PurePosixPath(name.replace('\\', '/')).parts
    if '.git' in parts or (parts and parts[-1] in ('.env', '.npmrc', '.netrc', 'id_rsa', 'id_ed25519')):
        issues.append(f'{label}: sensitive file: {name}')


def inspect_tar(stream, label, version, issues):
    found = False
    with gzip.GzipFile(fileobj=stream, mode='rb') as uncompressed, tarfile.open(fileobj=uncompressed, mode='r|') as archive:
        for member in archive:
            check_name(member.name, label, issues)
            # Links can escape via their target or through another archive entry.
            # Reject them outright rather than attempting an unsafe partial resolution.
            if member.issym() or member.islnk():
                issues.append(f'{label}: archive link not permitted: {member.name}')
                continue
            if not member.isfile():
                continue
            entry = archive.extractfile(member)
            if entry is None:
                continue
            if member.name in ('package/package.json', './package/package.json'):
                if member.size > 1024 * 1024:
                    issues.append(f'{label}: package.json too large')
                    continue
                try:
                    content = entry.read()
                    inspect_stream(io.BytesIO(content), f'{label}!{member.name}', issues)
                    package = json.loads(content)
                    found = True
                    if package.get('name') != 'dsh-superagent' or package.get('version') != version:
                        issues.append(f'{label}: plugin package name/version mismatch')
                except (ValueError, UnicodeDecodeError):
                    issues.append(f'{label}: invalid package.json')
            else:
                inspect_stream(entry, f'{label}!{member.name}', issues)
        # tar may stop before gzip's trailer; read it to verify the gzip CRC.
        while uncompressed.read(1024 * 1024):
            pass
    if not found:
        issues.append(f'{label}: plugin package.json missing')


def inspect_zip(path, version, issues):
    nested = 0
    with zipfile.ZipFile(path) as archive:
        entries = {}
        for item in archive.infolist():
            name = item.filename.removeprefix('./')
            if name in entries:
                issues.append(f'{path.name}: duplicate archive path: {name}')
            entries[name] = item
        if path.name.startswith('Super-Agent-Bundled-'):
            windows = '-Windows-' in path.name
            startup = 'start.cmd' if windows else 'start.sh'
            bootstrap = 'tools/windows-profile-bootstrap.mjs' if windows else 'tools/unix-profile-bootstrap.mjs'
            node = 'node/node.exe' if windows else 'node/bin/node'
            required = [startup, bootstrap, node, 'runtime/node_modules/@deepseek-ai/dsh/lib/bin.js',
                        'payload/profile/package.json', 'payload/profile/cordis.patch.yml']
            for name in required:
                if name not in entries or entries[name].is_dir():
                    issues.append(f'{path.name}: required bundled file missing: {name}')
            if not windows:
                for name in (startup, node):
                    item = entries.get(name)
                    if item and (item.create_system != 3 or not (item.external_attr >> 16) & 0o111):
                        issues.append(f'{path.name}: missing Unix executable permissions: {name}')
        for item in archive.infolist():
            check_name(item.filename, path.name, issues)
            if item.create_system == 3 and stat.S_ISLNK(item.external_attr >> 16):
                issues.append(f'{path.name}: archive link not permitted: {item.filename}')
            if item.is_dir():
                continue
            with archive.open(item) as entry:
                if item.filename.endswith('.tgz') and ('dsh-superagent' in item.filename or 'Super-Agent-Plugin-' in item.filename):
                    nested += 1
                    inspect_tar(entry, f'{path.name}!{item.filename}', version, issues)
                    # Consume the rest so ZIP CRC is verified even after gzip end-of-stream.
                    while entry.read(1024 * 1024):
                        pass
                else:
                    inspect_stream(entry, f'{path.name}!{item.filename}', issues)
    if not nested:
        issues.append(f'{path.name}: embedded plugin archive missing')


def run(directory, version):
    issues = []
    directory = Path(directory)
    if not directory.is_dir():
        return [f'Directory does not exist: {directory}']
    actual = {p.name for p in directory.iterdir() if p.is_file() and p.suffix.lower() in ('.zip', '.tgz')}
    expected = assets(version)
    issues.extend(f'Missing asset: {name}' for name in sorted(expected - actual))
    issues.extend(f'Unexpected asset: {name}' for name in sorted(actual - expected))
    for name in sorted(actual):
        path = directory / name
        try:
            if name.lower().endswith('.zip'):
                inspect_zip(path, version, issues)
            else:
                with path.open('rb') as stream:
                    inspect_tar(stream, name, version, issues)
        except (OSError, EOFError, ValueError, RuntimeError, zipfile.BadZipFile, tarfile.TarError) as exc:
            issues.append(f'{name}: archive unreadable or corrupt ({type(exc).__name__})')
    return issues


def main():
    if len(sys.argv) not in (2, 3):
        print(__doc__, file=sys.stderr)
        return 2
    version = sys.argv[2] if len(sys.argv) == 3 else json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    problems = run(sys.argv[1], version)
    for issue in problems:
        print(issue)
    print(f'Preflight: {len(problems)} issue(s); version {version}.')
    print('Checks do not prove runtime, platform compatibility, or absence of every possible secret.')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
