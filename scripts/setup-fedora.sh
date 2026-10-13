#!/usr/bin/env bash
set -euo pipefail
SOURCE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
UPDATING=0
while (($#)); do
  case "$1" in
    --source) SOURCE="$2"; shift 2 ;;
    --update) UPDATING=1; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done
if ((EUID != 0)); then echo 'Run: sudo bash scripts/setup-fedora.sh' >&2; exit 1; fi
if [[ -n "${HOSTMAN_DATA_DIR:-}" || -n "${HOSTMAN_HOSTS_FILE:-}" ]]; then echo 'Unset test path overrides before installing.' >&2; exit 1; fi
. /etc/os-release
if [[ "$ID" != fedora ]]; then echo 'This installer supports Fedora. Other Linux distributions require manual integration.' >&2; exit 1; fi
if [[ ! -x /usr/bin/node || ! -x /usr/bin/python3 ]] || ! command -v git >/dev/null; then
  dnf install -y nodejs python3 git
fi
/usr/bin/node -e 'if (+process.versions.node.split(".")[0] < 22) process.exit(1)' || { echo 'Node.js 22+ is required.' >&2; exit 1; }
/usr/bin/python3 -c 'import sys; assert sys.version_info >= (3,9)'
command -v nmcli >/dev/null
command -v systemctl >/dev/null
[[ -f "$SOURCE/package.json" && -f "$SOURCE/bin/hostman.mjs" ]] || { echo 'Invalid Hostman source folder.' >&2; exit 1; }
INSTALL=/opt/hostman
DATA=/var/lib/hostman
install -d -m 755 "$INSTALL" "$INSTALL/releases" "$DATA" /usr/local/bin
getent group hostman >/dev/null || groupadd --system hostman
id hostman >/dev/null 2>&1 || useradd --system --gid hostman --home-dir /nonexistent --shell /usr/sbin/nologin hostman
STAGE="$(mktemp -d "$INSTALL/releases/release-XXXXXXXX")"
for item in bin lib python scripts test docs package.json LICENSE README.md; do cp -R -- "$SOURCE/$item" "$STAGE/"; done
chown -R root:root "$STAGE"
find "$STAGE" -type d -exec chmod 755 {} +
find "$STAGE" -type f -exec chmod 644 {} +
chmod 755 "$STAGE/bin/hostman.mjs" "$STAGE/scripts/setup-fedora.sh"
/usr/bin/node --check "$STAGE/bin/hostman.mjs"
/usr/bin/python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())' "$STAGE/python/hosts.py"
/usr/bin/node "$STAGE/bin/hostman.mjs" init
PREVIOUS="$(readlink "$INSTALL/current" 2>/dev/null || true)"
WAS_ACTIVE=0
systemctl is-active --quiet hostman-dns.service && WAS_ACTIVE=1
ln -s "$STAGE" "$INSTALL/.current-new"
mv -Tf "$INSTALL/.current-new" "$INSTALL/current"
cat > /usr/local/bin/hostman <<'WRAPPER'
#!/bin/sh
export HOSTMAN_PYTHON=/usr/bin/python3
exec /usr/bin/node /opt/hostman/current/bin/hostman.mjs "$@"
WRAPPER
chmod 755 /usr/local/bin/hostman
ln -sfn /usr/local/bin/hostman /usr/local/bin/hostmanager
cat > /etc/systemd/system/hostman-dns.service <<'UNIT'
[Unit]
Description=Hostman local DNS by ByDT Softwares
After=network.target
StartLimitIntervalSec=60
StartLimitBurst=10

[Service]
Type=simple
User=hostman
Group=hostman
ExecStart=/usr/bin/node /opt/hostman/current/bin/hostman.mjs dns serve
Restart=on-failure
RestartSec=2
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadOnlyPaths=/var/lib/hostman
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
UMask=0022

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
if ((WAS_ACTIVE)); then
  if ! systemctl restart hostman-dns.service || ! /usr/bin/python3 -c "import sys; sys.path.insert(0, '$STAGE/python'); from system import probe; probe()"; then
    if [[ -n "$PREVIOUS" ]]; then
      ln -s "$PREVIOUS" "$INSTALL/.rollback-current"
      mv -Tf "$INSTALL/.rollback-current" "$INSTALL/current"
      systemctl restart hostman-dns.service || true
    fi
    echo 'DNS restart failed. Previous application restored; inspect journalctl -u hostman-dns.' >&2
    exit 1
  fi
fi
if [[ -n "$PREVIOUS" ]]; then printf '%s\n' "$PREVIOUS" > "$INSTALL/previous.txt"; fi
if command -v restorecon >/dev/null; then restorecon -RF "$INSTALL" "$DATA" /usr/local/bin/hostman /etc/systemd/system/hostman-dns.service; fi
echo 'Hostman installed. Run hostman, or sudo hostman for editing.'
echo 'Set upstream servers, then run sudo hostman dns enable for DNS priority.'
