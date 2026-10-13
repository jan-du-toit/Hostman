#!/usr/bin/env python3
"""Privileged hosts transactions; only standard-library Python is required."""
import contextlib
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import time
import uuid

BEGIN = '# BEGIN HOSTMAN - ByDT Softwares'
END = '# END HOSTMAN'

def paths():
    # Overrides are for explicit sandbox/testing runs, never accepted by installed services.
    root = Path(os.environ.get('HOSTMAN_DATA_DIR') or
                (str(Path(os.environ.get('ProgramData', 'C:/ProgramData')) / 'Hostman')
                 if os.name == 'nt' else '/var/lib/hostman'))
    hosts = Path(os.environ.get('HOSTMAN_HOSTS_FILE') or
                 (str(Path(os.environ.get('SystemRoot', 'C:/Windows')) / 'System32/drivers/etc/hosts')
                  if os.name == 'nt' else '/etc/hosts'))
    return root, hosts

def domain(value):
    if not isinstance(value, str) or not value or any(c.isspace() for c in value):
        raise ValueError('A hostname must be nonempty and contain no whitespace.')
    value = value.rstrip('.').encode('idna').decode('ascii').lower()
    if len(value) > 253 or any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', p)
                               for p in value.split('.')):
        raise ValueError('Invalid hostname; wildcards belong in DNS rules, not hosts entries.')
    return value

def group(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,48}', value):
        raise ValueError('Group names use letters, digits, hyphens and underscores (1–48).')
    return value

def defaults():
    return {'schema': 1, 'groups': {'default': True}, 'entries': [],
            'dns': {'upstreams': ['1.1.1.1', '9.9.9.9'], 'ttl': 60, 'timeoutMs': 1500}}

def validate(data):
    if not isinstance(data, dict) or data.get('schema') != 1:
        raise ValueError('Expected a Hostman schema 1 JSON file.')
    if not isinstance(data.get('groups'), dict) or not isinstance(data.get('entries'), list):
        raise ValueError('Invalid groups or entries.')
    for name, active in data['groups'].items():
        group(name)
        if not isinstance(active, bool): raise ValueError('Group enabled must be a boolean.')
    if 'default' not in data['groups']: raise ValueError('The default group is required.')
    seen, ids = set(), set()
    for e in data['entries']:
        if not isinstance(e, dict): raise ValueError('Invalid entry.')
        e['host'] = domain(e['host'])
        if '%' in e['ip']: raise ValueError('Scoped IPv6 addresses are not supported in hosts files.')
        e['ip'] = str(ipaddress.ip_address(e['ip']))
        if e['host'] in seen: raise ValueError('Duplicate hostname: ' + e['host'])
        seen.add(e['host'])
        if e.get('group') not in data['groups']: raise ValueError('Unknown group.')
        if not isinstance(e.get('enabled'), bool): raise ValueError('Invalid enabled value.')
        if not re.fullmatch(r'[a-f0-9]{12}', e.get('id', '')) or e['id'] in ids:
            raise ValueError('Invalid or duplicate entry ID.')
        ids.add(e['id'])
        if not isinstance(e.get('comment', ''), str) or any(c in e.get('comment', '') for c in '\r\n\0'):
            raise ValueError('Comments must be a single line.')
    dns = data.get('dns', {})
    servers = dns.get('upstreams')
    if not isinstance(servers, list) or not 1 <= len(servers) <= 5:
        raise ValueError('Set 1–5 upstream IP addresses.')
    for s in servers:
        if not isinstance(s, str) or '%' in s: raise ValueError('Use plain upstream IP addresses.')
        ip = ipaddress.ip_address(s)
        if ip.is_loopback or ip.is_unspecified or ip.is_multicast:
            raise ValueError('Upstreams cannot be loopback, unspecified or multicast addresses.')
    for key, minimum, maximum in [('ttl', 0, 86400), ('timeoutMs', 100, 10000)]:
        val = dns.get(key)
        if type(val) is not int or not minimum <= val <= maximum:
            raise ValueError('Invalid DNS ' + key)
    return data

def split_hosts(text):
    lines = text.splitlines(keepends=True)
    begins = [i for i, line in enumerate(lines) if line.rstrip('\r\n') == BEGIN]
    ends = [i for i, line in enumerate(lines) if line.rstrip('\r\n') == END]
    if not begins and not ends: return text, '', ''
    if len(begins) != 1 or len(ends) != 1 or begins[0] >= ends[0]:
        raise ValueError('Damaged Hostman markers. Repair the hosts file before editing.')
    a, b = begins[0], ends[0]
    return ''.join(lines[:a]), ''.join(lines[a:b+1]), ''.join(lines[b+1:])

def parse_hosts(text):
    entries = []
    for line in text.splitlines():
        bits = line.split('#', 1)[0].split()
        if len(bits) < 2: continue
        try: ip = str(ipaddress.ip_address(bits[0]))
        except ValueError: continue
        for name in bits[1:]:
            try: entries.append({'ip': ip, 'host': domain(name)})
            except ValueError: pass
    return entries

def render(text, data):
    before, block, after = split_hosts(text)
    external = {e['host'] for e in parse_hosts(before + after)}
    active = [e for e in data['entries'] if e['enabled'] and data['groups'][e['group']]]
    for e in active:
        if e['host'] in external:
            raise ValueError(e['host'] + ' already exists outside the Hostman block. Use edit-file to remove that duplicate first.')
    newline = '\r\n' if '\r\n' in text else '\n'
    lines = [BEGIN]
    for e in sorted(active, key=lambda e: (e['group'], e['host'])):
        comment = f" # [{e['group']}]" + (' ' + e.get('comment', '') if e.get('comment') else '')
        lines.append(f"{e['ip']}\t{e['host']}{comment}")
    lines.append(END)
    if before and not before.endswith(('\n', '\r')): before += newline
    return before + newline.join(lines) + newline + after

def atomic(path, raw, mode=0o644):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink(): raise ValueError('Refusing to replace symlink: ' + str(path))
    old = path.stat() if path.exists() else None
    fd, tmp = tempfile.mkstemp(prefix='.hostman-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(raw); f.flush(); os.fsync(f.fileno())
        os.chmod(tmp, old.st_mode & 0o777 if old else mode)
        if os.name != 'nt' and old:
            os.chown(tmp, old.st_uid, old.st_gid)
            if hasattr(os, 'listxattr'):
                for key in os.listxattr(path): os.setxattr(tmp, key, os.getxattr(path, key))
        if os.name == 'nt' and old:
            # ReplaceFileW preserves destination ACLs on Windows.
            import ctypes
            fn = ctypes.windll.kernel32.ReplaceFileW
            fn.argtypes = [ctypes.c_wchar_p]*3 + [ctypes.c_uint32, ctypes.c_void_p, ctypes.c_void_p]
            if not fn(str(path), tmp, None, 0, None, None):
                raise ctypes.WinError()
        else: os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

@contextlib.contextmanager
def lock(root):
    root.mkdir(parents=True, exist_ok=True)
    with open(root / 'state.lock', 'a+b') as f:
        if os.name == 'nt':
            import msvcrt
            if f.tell() == 0: f.write(b'0'); f.flush()
            f.seek(0); msvcrt.locking(f.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(f, fcntl.LOCK_EX)
        try: yield
        finally:
            if os.name == 'nt': f.seek(0); msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
            else: fcntl.flock(f, fcntl.LOCK_UN)

def load(root):
    p = root / 'state.json'
    return validate(json.loads(p.read_text('utf-8'))) if p.exists() else defaults()

def backup(root, hosts, data):
    name = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + uuid.uuid4().hex[:8]
    p = root / 'backups' / name
    p.mkdir(parents=True, mode=0o700)
    raw = hosts.read_bytes()
    atomic(p / 'hosts', raw, 0o600)
    atomic(p / 'state.json', json.dumps(data, indent=2).encode(), 0o600)
    return name

def recover(root, hosts):
    journal = root / 'transaction.json'
    if journal.exists():
        job = json.loads(journal.read_text())
        p = root / 'backups' / job['backup']
        atomic(hosts, (p / 'hosts').read_bytes())
        atomic(root / 'state.json', (p / 'state.json').read_bytes())
        journal.unlink()

def commit(root, hosts, old, new, raw=None):
    validate(new)
    original = hosts.read_bytes()
    rendered = raw if raw is not None else render(original.decode('utf-8'), new).encode('utf-8')
    name = backup(root, hosts, old)
    if hosts.read_bytes() != original: raise ValueError('Hosts changed during edit; retry.')
    atomic(root / 'transaction.json', json.dumps({'backup': name}).encode(), 0o600)
    try:
        atomic(hosts, rendered)
        atomic(root / 'state.json', (json.dumps(new, indent=2) + '\n').encode())
        (root / 'transaction.json').unlink()
    except BaseException:
        recover(root, hosts)
        raise
    return name

def entry(data, key):
    found = [e for e in data['entries'] if e['id'] == key or e['host'] == key.lower().rstrip('.')]
    if not found: raise ValueError('No managed entry matches ' + key)
    return found[0]

def dispatch(request):
    root, hosts = paths()
    op = request['op']
    if op in ('list', 'export', 'backups', 'raw', 'status'):
        if (root / 'transaction.json').exists(): raise ValueError('An interrupted edit needs recovery. Run hostman recover as administrator.')
        data = load(root)
        if op == 'export': return data
        if op == 'raw':
            raw = hosts.read_bytes()
            return {'text': raw.decode('utf-8'), 'hash': hashlib.sha256(raw).hexdigest()}
        if op == 'backups':
            return sorted([p.name for p in (root / 'backups').glob('*') if p.is_dir()], reverse=True)
        before, block, after = split_hosts(hosts.read_text('utf-8'))
        return {'data': data, 'unmanaged': parse_hosts(before + after), 'hostsFile': str(hosts), 'dataDir': str(root)}
    with lock(root):
        recover(root, hosts)
        data = load(root)
        old = json.loads(json.dumps(data))
        if op == 'recover': return {'message': 'Recovery complete.'}
        if op == 'init':
            if not hosts.exists(): raise ValueError('System hosts file is missing.')
            if not (root / 'state.json').exists(): atomic(root / 'state.json', (json.dumps(data, indent=2)+'\n').encode())
            return {'message': 'Hostman initialized.'}
        if op == 'add':
            host = domain(request['host'])
            if any(e['host'] == host for e in data['entries']): raise ValueError('Host already managed; use set.')
            g = group(request.get('group', 'default'))
            if g not in data['groups']: raise ValueError('Create that group first.')
            data['entries'].append({'id': uuid.uuid4().hex[:12], 'host': host,
                                    'ip': request['ip'], 'group': g, 'enabled': True,
                                    'comment': request.get('comment', '')})
        elif op == 'set':
            e = entry(data, request['key'])
            for key in ('ip', 'host', 'group', 'comment'):
                if key in request: e[key] = request[key]
        elif op == 'remove': data['entries'].remove(entry(data, request['key']))
        elif op in ('enable', 'disable'): entry(data, request['key'])['enabled'] = op == 'enable'
        elif op == 'group':
            action, name = request['action'], group(request['name'])
            if action == 'create':
                if name in data['groups']: raise ValueError('Group already exists.')
                data['groups'][name] = True
            else:
                if name not in data['groups']: raise ValueError('Unknown group.')
                if action in ('enable', 'disable'): data['groups'][name] = action == 'enable'
                elif action in ('clear', 'delete'):
                    if action == 'delete' and name == 'default': raise ValueError('Cannot delete default group.')
                    data['entries'] = [e for e in data['entries'] if e['group'] != name]
                    if action == 'delete': del data['groups'][name]
                elif action == 'rename':
                    new = group(request['new'])
                    if name == 'default' or new in data['groups']: raise ValueError('Cannot rename default or overwrite another group.')
                    data['groups'][new] = data['groups'].pop(name)
                    for e in data['entries']:
                        if e['group'] == name: e['group'] = new
                else: raise ValueError('Unknown group action.')
        elif op == 'import': data = validate(request['data'])
        elif op == 'dns-config': data['dns']['upstreams'] = request['upstreams']
        elif op == 'clear': data['entries'] = []
        elif op == 'restore':
            name = request['name']
            if not re.fullmatch(r'\d{8}T\d{6}Z-[a-f0-9]{8}', name): raise ValueError('Invalid backup ID.')
            p = root / 'backups' / name
            if not p.is_dir(): raise ValueError('Backup does not exist.')
            data = validate(json.loads((p / 'state.json').read_text()))
            raw = (p / 'hosts').read_bytes()
            return {'backup': commit(root, hosts, old, data, raw), 'message': 'Full hosts and state snapshot restored.'}
        elif op == 'write-raw':
            original = hosts.read_bytes()
            if hashlib.sha256(original).hexdigest() != request['hash']:
                raise ValueError('Hosts changed since opening the editor; edit again.')
            text = request['text']
            if '\0' in text or len(text.encode()) > 1048576: raise ValueError('Invalid hosts file.')
            # Keep managed entries controlled by the database; edits outside it are preserved.
            before, block, after = split_hosts(text)
            for line in (before + after).splitlines():
                content = line.split('#', 1)[0].strip()
                if content:
                    bits = content.split()
                    if len(bits) < 2: raise ValueError('Hosts entries need an IP and hostname.')
                    ipaddress.ip_address(bits[0])
                    for host in bits[1:]: domain(host)
            raw = render(text, data).encode()
            return {'backup': commit(root, hosts, old, data, raw), 'message': 'Hosts file saved.'}
        else: raise ValueError('Unknown operation: ' + op)
        return {'backup': commit(root, hosts, old, data), 'message': 'Saved.'}

if __name__ == '__main__':
    try:
        print(json.dumps({'ok': True, 'result': dispatch(json.load(sys.stdin))}))
    except Exception as exc:
        message = 'Run this command with sudo / from an Administrator terminal.' if isinstance(exc, PermissionError) else str(exc)
        print(json.dumps({'ok': False, 'error': message}))
        sys.exit(1)
