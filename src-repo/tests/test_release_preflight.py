import io
import json
import sys
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import release_preflight as preflight


def make_plugin_tgz(version='0.3.12', extra=None):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz') as tf:
        pkg = json.dumps({'name': 'dsh-superagent', 'version': version}).encode('utf-8')
        info = tarfile.TarInfo('package/package.json')
        info.size = len(pkg)
        tf.addfile(info, io.BytesIO(pkg))
        if extra:
            for name, content in extra.items():
                ei = tarfile.TarInfo(name)
                ei.size = len(content)
                tf.addfile(ei, io.BytesIO(content))
    return buf.getvalue()


def write_bundle(path: Path, windows: bool, version='0.3.12', extra_files=None):
    tgz = make_plugin_tgz(version)
    with zipfile.ZipFile(path, 'w') as zf:
        def add_exec(name, data):
            zi = zipfile.ZipInfo(name)
            zi.create_system = 0 if windows else 3
            zi.external_attr = 0 if windows else (0o100755 << 16)
            zf.writestr(zi, data)

        add_exec('start.cmd' if windows else 'start.sh', b'echo start\n')
        add_exec('node/node.exe' if windows else 'node/bin/node', b'node')
        zf.writestr('tools/windows-profile-bootstrap.mjs' if windows else 'tools/unix-profile-bootstrap.mjs', b'console.log(1)\n')
        zf.writestr('runtime/node_modules/@deepseek-ai/dsh/lib/bin.js', b'')
        zf.writestr('payload/profile/package.json', b'{}')
        zf.writestr('payload/profile/cordis.patch.yml', b'')
        zf.writestr('payload/dsh-superagent.tgz', tgz)
        if extra_files:
            for k, v in extra_files.items():
                zf.writestr(k, v)


class ReleasePreflightTests(unittest.TestCase):
    def test_allowlisted_vendor_files_pass_while_real_secrets_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp)
            ver = '0.3.12'
            (dist / f'Super-Agent-Plugin-v{ver}.tgz').write_bytes(make_plugin_tgz(ver))
            write_bundle(
                dist / f'Super-Agent-Bundled-Windows-x64-v{ver}.zip',
                windows=True,
                version=ver,
                extra_files={
                    'runtime/node_modules/jose/dist/webapi/key/import.js': b'"-----BEGIN PRIVATE KEY-----"',
                    'runtime/node_modules/normalize-url/readme.md': b'https://user:password@sindresorhus.com',
                },
            )
            for os_name, arch in [('macOS', 'arm64'), ('macOS', 'x64'), ('Linux', 'x64')]:
                write_bundle(dist / f'Super-Agent-Bundled-{os_name}-{arch}-v{ver}.zip', windows=False, version=ver)

            self.assertEqual(preflight.run(dist, ver), [])

            # Non-allowlisted path with private key must fail.
            write_bundle(
                dist / f'Super-Agent-Bundled-Linux-x64-v{ver}.zip',
                windows=False,
                version=ver,
                extra_files={'payload/leaked.pem': b'-----BEGIN PRIVATE KEY-----'},
            )
            issues = preflight.run(dist, ver)
            self.assertEqual(len(issues), 1)
            self.assertIn('payload/leaked.pem: possible private key', issues[0])

            # Allowlisted path with wrong token type (GitHub token) must STILL fail!
            write_bundle(
                dist / f'Super-Agent-Bundled-Linux-x64-v{ver}.zip',
                windows=False,
                version=ver,
                extra_files={'runtime/node_modules/normalize-url/readme.md': b'ghp_' + b'A' * 36},
            )
            issues = preflight.run(dist, ver)
            self.assertEqual(len(issues), 1)
            self.assertIn('possible GitHub token', issues[0])


if __name__ == '__main__':
    unittest.main()
