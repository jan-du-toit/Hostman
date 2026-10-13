"""System-integration tests use mocks and temporary files only."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'python'))
import system

class Integration(unittest.TestCase):
    def exercise(self, backend, fail=False):
        with tempfile.TemporaryDirectory(prefix='hostman-system-test-') as folder:
            root=Path(folder)/'data';root.mkdir()
            nm=Path(folder)/'nm.conf';resolved=Path(folder)/'resolved.conf';resolv=Path(folder)/'resolv.conf'
            original=Path(folder)/'original-resolv';original.write_text('nameserver 192.168.1.1\n')
            resolv.symlink_to(original)
            def reload(which):
                if which=='networkmanager':
                    if nm.exists(): system.restore(resolv,{'kind':'file','text':'nameserver 127.0.0.1\n','mode':0o644})
                if fail and (nm.exists() or resolved.exists()):raise RuntimeError('simulated reload failure')
            with patch.multiple(system,NM=nm,RESOLVED=resolved,RESOLV=resolv), \
                 patch.object(system,'dns_backend',return_value=backend), \
                 patch.object(system,'run') as run, \
                 patch.object(system,'probe'), \
                 patch.object(system,'flush'), \
                 patch.object(system,'reload_backend',side_effect=reload):
                if fail:
                    with self.assertRaises(RuntimeError):system.linux_enable(root)
                else:
                    system.linux_enable(root)
                    self.assertEqual(json.loads((root/'dns-system.json').read_text())['phase'],'enabled')
                    self.assertIn('nameserver 127.0.0.1',resolv.read_text())
                    system.linux_disable(root)
                self.assertFalse((root/'dns-system.json').exists())
                self.assertTrue(resolv.is_symlink())
                self.assertEqual(resolv.readlink(),original)
                self.assertFalse(nm.exists());self.assertFalse(resolved.exists())
                self.assertEqual(original.read_text(),'nameserver 192.168.1.1\n')
                self.assertTrue(run.called)
    def test_nm(self):self.exercise('networkmanager')
    def test_resolved(self):self.exercise('resolved')
    def test_nm_failure(self):self.exercise('networkmanager',True)
    def test_resolved_failure(self):self.exercise('resolved',True)
    def test_old_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);nm=root/'nm';resolv=root/'resolv'
            nm.write_bytes(system.DROPIN);resolv.write_text('nameserver 127.0.0.1\n')
            (root/'dns-system.json').write_text(json.dumps({'platform':'fedora','nm':{'kind':'missing'},'resolv':{'kind':'file','text':'nameserver 10.0.0.1\n','mode':0o644},'phase':'enabled'}))
            with patch.multiple(system,NM=nm,RESOLV=resolv),patch.object(system,'reload_backend'),patch.object(system,'run'),patch.object(system,'flush'):
                system.linux_disable(root)
            self.assertEqual(resolv.read_text(),'nameserver 10.0.0.1\n');self.assertFalse(nm.exists())

if __name__=='__main__':unittest.main()
