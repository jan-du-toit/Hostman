#!/usr/bin/env python3
"""Explicit opt-in system integration for Fedora, Ubuntu and Windows."""
import json
import os
from pathlib import Path
import shutil
import socket
import struct
import subprocess
import sys
import time
from hosts import paths, atomic, lock

NM = Path('/etc/NetworkManager/conf.d/99-hostman.conf')
RESOLV = Path('/etc/resolv.conf')
DROPIN = b'[main]\ndns=default\nrc-manager=symlink\nsystemd-resolved=false\n\n[global-dns]\n\n[global-dns-domain-*]\nservers=127.0.0.1\n'
RESOLVED = Path('/etc/systemd/resolved.conf.d/99-hostman.conf')
RESOLVED_DROPIN = b'[Resolve]\nDNS=127.0.0.1\nFallbackDNS=\nDomains=~.\nReadEtcHosts=yes\n'
ROOT = Path(__file__).resolve().parent.parent

def run(args, check=True):
    return subprocess.run(args, check=check)

def admin():
    if os.name == 'nt':
        import ctypes
        ok = ctypes.windll.shell32.IsUserAnAdmin()
    else: ok = os.geteuid() == 0
    if not ok: raise ValueError('Use sudo / an Administrator terminal for this command.')
    if os.environ.get('HOSTMAN_DATA_DIR') or os.environ.get('HOSTMAN_HOSTS_FILE'):
        raise ValueError('System DNS changes are disabled with test path overrides.')

def probe():
    query = struct.pack('!HHHHHH', 0x484d, 0x0100, 1, 0, 0, 0) + b'\x09localhost\x00\x00\x01\x00\x01'
    for _ in range(40):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.settimeout(.25); s.connect(('127.0.0.1',53)); s.send(query); reply = s.recv(4096)
                if len(reply) >= 12 and reply[:2] == b'HM' and reply[2] & 0x80 and not reply[3] & 15: return
        except OSError: pass
        time.sleep(.1)
    raise ValueError('Hostman DNS health check failed; system DNS was not redirected.')

def snapshot(path):
    if path.is_symlink(): return {'kind':'link', 'target':os.readlink(path)}
    if path.exists(): return {'kind':'file', 'text':path.read_text(), 'mode':path.stat().st_mode & 0o777}
    return {'kind':'missing'}

def restore(path, item):
    if path.is_symlink(): path.unlink()
    if item['kind'] == 'link':
        if path.exists(): path.unlink()
        path.symlink_to(item['target'])
    elif item['kind'] == 'file': atomic(path,item['text'].encode(),item['mode'])
    elif path.exists(): path.unlink()

def active(unit):
    return subprocess.run(['systemctl', 'is-active', '--quiet', unit],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0

def dns_backend():
    if shutil.which('nmcli') and active('NetworkManager.service'): return 'networkmanager'
    if active('systemd-resolved.service'): return 'resolved'
    raise ValueError('DNS integration needs active NetworkManager or systemd-resolved. Hosts editing works without them.')

def reload_backend(backend):
    if backend == 'networkmanager':
        run(['nmcli','general','reload','conf']); run(['nmcli','general','reload','dns-full'])
    else: run(['systemctl','restart','systemd-resolved.service'])

def linux_enable(root):
    if not shutil.which('systemctl'): raise ValueError('This setup requires systemd.')
    saved = root / 'dns-system.json'
    if saved.exists():
        data = json.loads(saved.read_text())
        if data.get('phase') != 'enabled': raise ValueError('An interrupted DNS change needs dns disable before retrying.')
        run(['systemctl','start','hostman-dns']); probe(); print('Hostman DNS priority is already enabled.'); return
    backend = dns_backend()
    config, content = (NM, DROPIN) if backend == 'networkmanager' else (RESOLVED, RESOLVED_DROPIN)
    if config.exists() or config.is_symlink(): raise ValueError(str(config) + ' already exists; move that conflicting file before enabling Hostman.')
    data = {'platform':'linux', 'backend':backend, 'config':snapshot(config),
            'resolv':snapshot(RESOLV), 'phase':'pending'}
    atomic(saved,json.dumps(data,indent=2).encode(),0o600)
    try:
        run(['systemctl','enable','--now','hostman-dns.service']); probe()
        config.parent.mkdir(parents=True,exist_ok=True); atomic(config,content)
        tmp = RESOLV.parent / '.hostman-resolv-link'
        if tmp.exists() or tmp.is_symlink(): tmp.unlink()
        target = '/run/NetworkManager/resolv.conf' if backend == 'networkmanager' else str(root / 'resolv.conf')
        if backend == 'resolved': atomic(root / 'resolv.conf',b'nameserver 127.0.0.1\n')
        tmp.symlink_to(target); os.replace(tmp,RESOLV)
        reload_backend(backend)
        nameservers = [line.split()[1] for line in RESOLV.read_text().splitlines()
                       if line.strip().startswith('nameserver ') and len(line.split()) >= 2]
        if nameservers != ['127.0.0.1']:
            raise ValueError('System did not apply exclusive Hostman DNS; check conflicting resolver configuration.')
        data['phase']='enabled'; atomic(saved,json.dumps(data,indent=2).encode(),0o600)
        flush(); print('Hostman DNS priority enabled via '+backend+'. Use hostman dns disable to restore DNS.')
    except BaseException:
        linux_disable(root)
        raise

def linux_disable(root):
    saved = root / 'dns-system.json'
    if saved.exists():
        data=json.loads(saved.read_text())
        # Read v1.0 Fedora snapshots too, so upgrading never loses DNS restoration.
        backend=data.get('backend','networkmanager')
        config, content = (NM,DROPIN) if backend == 'networkmanager' else (RESOLVED,RESOLVED_DROPIN)
        original=data.get('config',data.get('nm'))
        if original is None: raise ValueError('Missing DNS restoration metadata; do not stop the resolver until this is repaired.')
        if config.exists() and config.read_bytes() != content:
            raise ValueError('Hostman resolver configuration changed externally. Restore its Hostman contents before disabling.')
        restore(config,original)
        reload_backend(backend)
        restore(RESOLV,data['resolv'])
        saved.unlink(); flush()
    run(['systemctl','disable','--now','hostman-dns.service'])
    print('System DNS settings restored; Hostman DNS stopped.')

def flush():
    if os.name == 'nt': run(['ipconfig','/flushdns'],False)
    elif shutil.which('resolvectl'): run(['resolvectl','flush-caches'],False)

def dashboard_probe():
    import urllib.request
    from hosts import load
    root,_=paths()
    port=load(root)['dashboard']['port']
    for _ in range(40):
        try:
            opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open('http://127.0.0.1:'+str(port)+'/api/health',timeout=.25) as response:
                if json.load(response).get('service')=='hostman-dashboard': return
        except Exception: pass
        time.sleep(.1)
    raise ValueError('Dashboard did not start. Check its logs and whether the configured port is already in use.')

def dashboard(action):
    if action not in ('enable','disable','start','stop','restart','status'): raise ValueError('Unknown dashboard action.')
    if action!='status': admin()
    if os.name=='nt':
        run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(ROOT/'scripts/windows-dashboard.ps1'),'-Action',action]); return
    if action=='status': run(['systemctl','status','hostman-dashboard.service','--no-pager'],False)
    elif action=='enable': run(['systemctl','enable','--now','hostman-dashboard.service'])
    elif action=='disable': run(['systemctl','disable','--now','hostman-dashboard.service'])
    else: run(['systemctl',action,'hostman-dashboard.service'])
    if action in ('enable','start','restart'): dashboard_probe()

def main():
    action = sys.argv[1] if len(sys.argv)>1 else 'status'
    root,_=paths()
    if action == 'check-admin': admin(); print('Administrator privileges: OK'); return
    if action.startswith('dashboard-'):
        dashboard(action[len('dashboard-'):]); return
    if action == 'flush': admin(); flush(); return
    if action == 'status':
        enabled=(root/'dns-system.json').exists()
        print('DNS priority: '+ ('enabled or pending recovery (see dns-system.json)' if enabled else 'disabled'))
        if os.name=='nt':
            run(['powershell.exe','-NoProfile','-File',str(ROOT/'scripts/windows-dns.ps1'),'-Action','status'],False)
        else: run(['systemctl','status','hostman-dns.service','--no-pager'],False)
        return
    if action not in ('enable','disable','start','stop','restart'): raise ValueError('Unknown DNS action.')
    admin()
    if os.name == 'nt':
        run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(ROOT/'scripts/windows-dns.ps1'),'-Action',action])
        return
    with lock(root):
        if action=='enable': linux_enable(root)
        elif action in ('disable','stop'): linux_disable(root)
        elif action=='start': run(['systemctl','start','hostman-dns.service']); probe()
        else: run(['systemctl','restart','hostman-dns.service']); probe()

if __name__ == '__main__':
    try: main()
    except Exception as exc: print('Hostman: '+str(exc),file=sys.stderr);sys.exit(1)
