import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'python'))
from release_archive import extract
class Archive(unittest.TestCase):
    def valid(self,prefix):
        with tempfile.TemporaryDirectory() as d:
            archive=Path(d)/'archive.zip'
            with zipfile.ZipFile(archive,'w') as z:
                z.writestr(prefix+'package.json',json.dumps({'name':'@bydt-softwares/hostman','version':'1.2.0'}))
                for name in ('bin/hostman.mjs','lib/bridge.mjs','python/hosts.py','scripts/setup-linux.sh','scripts/setup-windows.ps1','README.md','LICENSE'):z.writestr(prefix+name,'placeholder')
            result=extract(archive,Path(d)/'out');self.assertEqual(result['version'],'1.2.0');self.assertTrue(Path(result['root']).is_dir())
    def test_flat(self):self.valid('')
    def test_wrapped(self):self.valid('Hostman/')
    def test_invalid(self):
        for name in ('../outside','/absolute','C:/escape','a/../../outside'):
            with tempfile.TemporaryDirectory() as d:
                archive=Path(d)/'bad.zip'
                with zipfile.ZipFile(archive,'w') as z:z.writestr(name,'bad')
                with self.assertRaises(ValueError):extract(archive,Path(d)/'out')
    def test_duplicates(self):
        with tempfile.TemporaryDirectory() as d:
            archive=Path(d)/'bad.zip'
            with zipfile.ZipFile(archive,'w') as z:z.writestr('file','one');z.writestr('FILE','two')
            with self.assertRaises(ValueError):extract(archive,Path(d)/'out')
    def test_links(self):
        with tempfile.TemporaryDirectory() as d:
            archive=Path(d)/'bad.zip';item=zipfile.ZipInfo('link');item.external_attr=(0o120777<<16)
            with zipfile.ZipFile(archive,'w') as z:z.writestr(item,'/etc/hosts')
            with self.assertRaises(ValueError):extract(archive,Path(d)/'out')
    def test_incomplete(self):
        with tempfile.TemporaryDirectory() as d:
            archive=Path(d)/'bad.zip'
            with zipfile.ZipFile(archive,'w') as z:z.writestr('package.json',json.dumps({'name':'@bydt-softwares/hostman','version':'1.2.0'}))
            with self.assertRaises(ValueError):extract(archive,Path(d)/'out')
if __name__=='__main__':unittest.main()
