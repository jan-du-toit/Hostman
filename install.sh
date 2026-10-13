#!/usr/bin/env bash
# Latest-Release installer — ByDT Softwares — MIT License.
set -euo pipefail
if [[ -n "${HOSTMAN_REF:-}" ]]; then echo 'HOSTMAN_REF is no longer supported; installs use the latest Release.' >&2; exit 1; fi
if ((EUID != 0)); then echo 'Run this installer with sudo (see README).' >&2; exit 1; fi
. /etc/os-release
case "$ID" in
  fedora) dnf install -y ca-certificates curl python3 tar xz util-linux ;;
  ubuntu) apt-get update; DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl python3 tar xz-utils util-linux ;;
  *) echo "Supported systems: Fedora and Ubuntu. Detected: $ID" >&2; exit 1 ;;
esac
WORK="$(mktemp -d -t hostman-release-XXXXXXXX)"
trap 'rm -rf -- "$WORK"' EXIT
echo 'Downloading the latest stable Hostman Release…'
python3 - "$WORK" <<'PYBOOTSTRAP'
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


import urllib.request
import hashlib
try:
    work=Path(sys.argv[1])
    headers={'User-Agent':'ByDT-Hostman-Installer','Accept':'application/vnd.github+json'}
    request=urllib.request.Request('https://api.github.com/repos/jan-du-toit/Hostman/releases/latest',headers=headers)
    with urllib.request.urlopen(request,timeout=30) as response:
        raw=response.read(1024*1024+1)
        if len(raw)>1024*1024:raise ValueError('Oversized release metadata.')
        release=json.loads(raw)
    if release.get('draft') or release.get('prerelease'):raise ValueError('Only the latest stable Release is supported.')
    assets=[a for a in release.get('assets',[]) if a.get('state')=='uploaded' and a.get('name','').lower().endswith('.zip') and 0<a.get('size',0)<=100*1024*1024]
    linux=[a for a in assets if re.search(r'linux|fedora|ubuntu',a['name'],re.I)]
    universal=[a for a in assets if re.match(r'hostman[-_.](?:v?d|source|update|universal)',a['name'],re.I) and not re.search(r'linux|windows|win32|win64|fedora|ubuntu',a['name'],re.I)]
    asset=linux[0] if len(linux)==1 else universal[0] if len(universal)==1 else assets[0] if len(assets)==1 else None
    if asset is None:raise ValueError('Attach one full Hostman-vX.Y.Z.zip to the latest Release.')
    url=asset['browser_download_url']
    if not url.lower().startswith('https://github.com/jan-du-toit/hostman/releases/download/'):raise ValueError('Invalid asset URL.')
    archive=work/'release.zip';digest=hashlib.sha256();size=0
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'ByDT-Hostman-Installer'}),timeout=90) as src,archive.open('wb') as dst:
        while chunk:=src.read(65536):
            size+=len(chunk)
            if size>100*1024*1024:raise ValueError('Release download too large.')
            digest.update(chunk);dst.write(chunk)
    if size!=asset['size']:raise ValueError('Release size mismatch.')
    if asset.get('digest') and asset['digest'].lower()!='sha256:'+digest.hexdigest():raise ValueError('Release SHA-256 mismatch.')
    package=extract(archive,work/'source')
    if re.fullmatch(r'v?\d+\.\d+\.\d+',release.get('tag_name','')) and package['version']!=release['tag_name'].lstrip('v'):
        raise ValueError('Release tag and package version do not match.')
    (Path(package['root'])/'release.json').write_text(json.dumps({'id':release['id'],'tag':release['tag_name'],'asset':asset['name'],'sha256':digest.hexdigest()}))
    (work/'project-path.txt').write_text(package['root'])
    print('Latest Release:',release['tag_name'],'Package:',package['version'])
except Exception as exc:
    print('Hostman Release installation failed: '+str(exc),file=sys.stderr)
    sys.exit(1)
PYBOOTSTRAP
SOURCE="$(cat "$WORK/project-path.txt")"
bash "$SOURCE/scripts/setup-linux.sh" --source "$SOURCE"
