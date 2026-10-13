#!/usr/bin/env python3
"""Extract an uploaded Hostman Release ZIP without trusting archive paths."""
import json
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import zipfile

MAX_BYTES = 200 * 1024 * 1024
MAX_FILES = 10000

def extract(archive, destination):
    destination = Path(destination).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    if any(destination.iterdir()): raise ValueError('Extraction destination must be empty.')
    with zipfile.ZipFile(archive) as z:
        infos=z.infolist()
        if len(infos)>MAX_FILES or sum(i.file_size for i in infos)>MAX_BYTES:
            raise ValueError('Release ZIP exceeds extraction limits.')
        seen=set()
        for item in infos:
            name=item.filename.replace('\\','/')
            parts=PurePosixPath(name).parts
            if not parts or name.startswith('/') or any(p in ('..','.') or ':' in p or '\0' in p for p in parts):
                raise ValueError('Unsafe archive path: '+item.filename)
            key='/'.join(parts).casefold()
            if key in seen: raise ValueError('Duplicate archive path: '+item.filename)
            seen.add(key)
            mode=item.external_attr >> 16
            if stat.S_IFMT(mode) not in (0,stat.S_IFREG,stat.S_IFDIR):
                raise ValueError('Archive links/devices are not allowed.')
            target=destination.joinpath(*parts)
            if not target.resolve().is_relative_to(destination): raise ValueError('Archive path escapes destination.')
            if item.is_dir(): target.mkdir(parents=True,exist_ok=True);continue
            target.parent.mkdir(parents=True,exist_ok=True)
            with z.open(item) as src, target.open('xb') as dst:
                remaining=item.file_size
                while chunk:=src.read(65536):
                    remaining-=len(chunk)
                    if remaining<0: raise ValueError('Archive file exceeds its advertised size.')
                    dst.write(chunk)
    candidates=[]
    for manifest in destination.rglob('package.json'):
        try: package=json.loads(manifest.read_text('utf-8'))
        except (ValueError,UnicodeError): continue
        if package.get('name')=='@bydt-softwares/hostman': candidates.append((manifest.parent,package))
    if len(candidates)!=1: raise ValueError('Release ZIP must contain exactly one Hostman project.')
    root,package=candidates[0]
    if not re.fullmatch(r'\d+\.\d+\.\d+',package.get('version','')): raise ValueError('Release package needs an x.y.z version.')
    for name in ('bin/hostman.mjs','lib/bridge.mjs','python/hosts.py','scripts/setup-linux.sh','scripts/setup-windows.ps1','README.md','LICENSE'):
        if not (root/name).is_file(): raise ValueError('Incomplete Hostman ZIP: missing '+name)
    return {'root':str(root),'version':package['version']}

if __name__=='__main__':
    try: print(json.dumps(extract(sys.argv[1],sys.argv[2])))
    except Exception as exc: print(str(exc),file=sys.stderr);sys.exit(1)
