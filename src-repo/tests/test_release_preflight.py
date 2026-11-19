import importlib.util
import io
import json
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'release_preflight.py'
spec = importlib.util.spec_from_file_location('release_preflight', SCRIPT)
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


def plugin(version='0.3.5', extra=None):
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode='w:gz') as tar:
        entries = {'package/package.json': json.dumps({'name': 'dsh-superagent', 'version': version}).encode()}
        entries.update(extra or {})
        for name, content in entries.items():
            info = tarfile.TarInfo(name)
            info.size = len(content)
            tar.addfile(info, io.BytesIO(content))
    return data.getvalue()


class ReleasePreflightTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.version = '0.3.5'
        self.payload = plugin()
        for name in preflight.assets(self.version):
            path = self.root / name
            if name.endswith('.tgz'):
                path.write_bytes(self.payload)
            else:
                with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as archive:
                    archive.writestr('payload/dsh-superagent.tgz', self.payload)
                    if name.startswith('Super-Agent-Bundled-'):
                        windows = '-Windows-' in name
                        executable = ['start.cmd', 'node/node.exe'] if windows else ['start.sh', 'node/bin/node']
                        for filename in executable:
                            info = zipfile.ZipInfo(filename); info.create_system = 3
                            info.external_attr = (0o100755 << 16)
                            archive.writestr(info, b'fixture')
                        for filename in ('runtime/node_modules/@deepseek-ai/dsh/lib/bin.js', 'payload/profile/package.json', 'payload/profile/cordis.patch.yml'):
                            archive.writestr(filename, b'fixture')

    def test_complete_release_passes(self):
        self.assertEqual(preflight.run(self.root, self.version), [])

    def test_missing_and_old_asset_fail(self):
        target = next(self.root.glob('*.zip'))
        target.rename(self.root / target.name.replace('0.3.5', '0.3.0'))
        result = preflight.run(self.root, self.version)
        self.assertTrue(any(x.startswith('Missing asset:') for x in result))
        self.assertTrue(any(x.startswith('Unexpected asset:') for x in result))

    def test_wrong_plugin_version_and_secret_are_reported_without_value(self):
        secret = b'ghp_' + b'x' * 36
        target = next(self.root.glob('*.tgz'))
        target.write_bytes(plugin('0.3.0', {'package/.git/config': secret}))
        result = '\n'.join(preflight.run(self.root, self.version))
        self.assertIn('name/version mismatch', result)
        self.assertIn('sensitive file', result)
        self.assertIn('possible GitHub token', result)
        self.assertNotIn(secret.decode(), result)

    def test_corrupt_zip_and_traversal_fail(self):
        paths = list(self.root.glob('*.zip'))
        paths[0].write_bytes(b'not a zip')
        with zipfile.ZipFile(paths[1], 'w') as archive:
            archive.writestr('../escape', b'no')
            archive.writestr('payload/dsh-superagent.tgz', self.payload)
        result = '\n'.join(preflight.run(self.root, self.version))
        self.assertIn('archive unreadable or corrupt', result)
        self.assertIn('unsafe archive path', result)

    def test_rejects_symbolic_and_hard_links_in_archives(self):
        target = next(self.root.glob('*.tgz'))
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode='w:gz') as archive:
            content = json.dumps({'name': 'dsh-superagent', 'version': self.version}).encode()
            manifest = tarfile.TarInfo('package/package.json'); manifest.size = len(content)
            archive.addfile(manifest, io.BytesIO(content))
            for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                link = tarfile.TarInfo(f'package/link-{kind.decode()}')
                link.type = kind; link.linkname = '../../outside'
                archive.addfile(link)
        target.write_bytes(data.getvalue())
        zip_target = next(self.root.glob('*.zip'))
        with zipfile.ZipFile(zip_target, 'w') as archive:
            archive.writestr('payload/dsh-superagent.tgz', self.payload)
            link = zipfile.ZipInfo('payload/link'); link.create_system = 3
            link.external_attr = (0o120777 << 16)
            archive.writestr(link, '../../outside')
        findings = '\n'.join(preflight.run(self.root, self.version))
        self.assertEqual(findings.count('archive link not permitted'), 3)

    def test_incomplete_bundle_and_missing_unix_permissions_fail(self):
        target = next(self.root.glob('Super-Agent-Bundled-Linux-*.zip'))
        with zipfile.ZipFile(target, 'w') as archive:
            archive.writestr('payload/dsh-superagent.tgz', self.payload)
            archive.writestr('start.sh', b'fixture')
        findings = '\n'.join(preflight.run(self.root, self.version))
        self.assertIn('required bundled file missing: node/bin/node', findings)
        self.assertIn('missing Unix executable permissions: start.sh', findings)

    def test_duplicate_zip_paths_fail(self):
        target = next(self.root.glob('Super-Agent-Clean-*.zip'))
        with zipfile.ZipFile(target, 'w') as archive:
            archive.writestr('payload/dsh-superagent.tgz', self.payload)
            archive.writestr('./payload/dsh-superagent.tgz', self.payload)
        findings = '\n'.join(preflight.run(self.root, self.version))
        self.assertIn('duplicate archive path: payload/dsh-superagent.tgz', findings)


if __name__ == '__main__':
    unittest.main()
