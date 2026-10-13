#!/usr/bin/env bash
set -euo pipefail
SOURCE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
UPDATING=0
while (($#)); do
  case "$1" in
    --source) [[ $# -ge 2 ]] || { echo '--source needs a path' >&2; exit 1; }; SOURCE="$2"; shift 2 ;;
    --update) UPDATING=1; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done
if ((EUID != 0)); then echo 'Run: sudo bash setup-linux.sh' >&2; exit 1; fi
if [[ -n "${HOSTMAN_DATA_DIR:-}" || -n "${HOSTMAN_HOSTS_FILE:-}" ]]; then echo 'Unset test path overrides before installing.' >&2; exit 1; fi
. /etc/os-release
case "$ID" in
  fedora) dnf install -y ca-certificates curl python3 tar xz util-linux ;;
  ubuntu) apt-get update; DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl python3 tar xz-utils util-linux ;;
  *) echo 'Supported systems: Fedora and Ubuntu.' >&2; exit 1 ;;
esac
[[ -d /run/systemd/system ]] || { echo 'A systemd-based Fedora/Ubuntu host is required; this is not a live systemd host.' >&2; exit 1; }
/usr/bin/python3 -c 'import sys; assert sys.version_info >= (3,9)'
[[ -f "$SOURCE/package.json" && -f "$SOURCE/bin/hostman.mjs" ]] || { echo 'Invalid Hostman source folder.' >&2; exit 1; }
INSTALL=/opt/hostman
DATA=/var/lib/hostman
install -d -m 755 "$INSTALL" "$INSTALL/releases" "$INSTALL/runtime" "$DATA" /usr/local/bin
exec 9>"$INSTALL/install.lock"
flock -x 9
WORK="$(mktemp -d -t hostman-runtime-XXXXXXXX)"
trap 'rm -rf -- "$WORK"' EXIT
NODE=''
if [[ -x /usr/bin/node ]] && /usr/bin/node -e 'if (+process.versions.node.split(".")[0] < 22) process.exit(1)'; then
  NODE=/usr/bin/node
elif [[ -x "$INSTALL/runtime/node" ]] && "$INSTALL/runtime/node" -e 'if (+process.versions.node.split(".")[0] < 22) process.exit(1)'; then
  NODE="$(readlink -f "$INSTALL/runtime/node")"
else
  # Install a private runtime, avoiding changes to Node used by other applications.
  case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; *) echo 'Automatic Node setup supports x86_64 and ARM64.' >&2; exit 1 ;; esac
  BASE=https://nodejs.org/dist/latest-v22.x
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$BASE/SHASUMS256.txt" -o "$WORK/SHASUMS256.txt"
  FILE="$(awk -v arch="$ARCH" '$2 ~ ("^node-v22\\.[0-9]+\\.[0-9]+-linux-" arch "\\.tar\\.xz$") {print $2; exit}' "$WORK/SHASUMS256.txt")"
  [[ -n "$FILE" ]] || { echo 'Could not locate the Node 22 runtime checksum.' >&2; exit 1; }
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$BASE/$FILE" -o "$WORK/$FILE"
  awk -v file="$FILE" '$2==file' "$WORK/SHASUMS256.txt" > "$WORK/checksum.txt"
  (cd "$WORK" && sha256sum -c checksum.txt)
  RUNTIME="$(mktemp -d "$INSTALL/runtime/node22-XXXXXXXX")"
  tar -xJf "$WORK/$FILE" -C "$RUNTIME" --strip-components=1 --no-same-owner
  chown -R root:root "$RUNTIME"
  chmod -R go-w "$RUNTIME"
  NODE="$RUNTIME/bin/node"
  "$NODE" --version
fi
ln -sfn -- "$NODE" "$INSTALL/runtime/node.new"
mv -Tf -- "$INSTALL/runtime/node.new" "$INSTALL/runtime/node"
getent group hostman >/dev/null || groupadd --system hostman
id hostman >/dev/null 2>&1 || useradd --system --gid hostman --home-dir /nonexistent --shell /usr/sbin/nologin hostman
STAGE="$(mktemp -d "$INSTALL/releases/release-XXXXXXXX")"
for item in bin lib python scripts test docs dashboard package.json LICENSE README.md CHANGELOG.md; do cp -R -- "$SOURCE/$item" "$STAGE/"; done
chown -R root:root "$STAGE"
find "$STAGE" -type d -exec chmod 755 {} +
find "$STAGE" -type f -exec chmod 644 {} +
chmod 755 "$STAGE/bin/hostman.mjs" "$STAGE/scripts/"*.sh
"$NODE" --check "$STAGE/bin/hostman.mjs"
/usr/bin/python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())' "$STAGE/python/hosts.py"
"$NODE" "$STAGE/bin/hostman.mjs" init
if [[ -f "$SOURCE/release.json" ]]; then cp -- "$SOURCE/release.json" "$STAGE/release.json"; fi
PREVIOUS="$(readlink "$INSTALL/current" 2>/dev/null || true)"
WAS_ACTIVE=0
DASH_ACTIVE=0
systemctl is-active --quiet hostman-dashboard.service && DASH_ACTIVE=1
systemctl is-active --quiet hostman-dns.service && WAS_ACTIVE=1
ln -sfn -- "$STAGE" "$INSTALL/.current-new"
mv -Tf -- "$INSTALL/.current-new" "$INSTALL/current"
# Preserve legacy wrappers/symlinks, then install by atomic rename (no symlink following).
source "$SOURCE/scripts/linux-links.sh"
LINK_BACKUP="$(mktemp -d "$INSTALL/legacy-commands-XXXXXXXX")"
hostman_install_commands /usr/local/bin "$INSTALL" "$LINK_BACKUP"
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
ExecStart=/opt/hostman/runtime/node /opt/hostman/current/bin/hostman.mjs dns serve
Restart=on-failure
RestartSec=2
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadOnlyPaths=/var/lib/hostman
RuntimeDirectory=hostman
RuntimeDirectoryMode=0750
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
UMask=0022

[Install]
WantedBy=multi-user.target
UNIT
# Password authentication uses the operating system's PAM stack.
if [[ ! -e /etc/pam.d/hostman ]]; then
  if [[ "$ID" == fedora ]]; then
    printf 'auth include system-auth\naccount include system-auth\n' > /etc/pam.d/hostman
  else
    printf '@include common-auth\n@include common-account\n' > /etc/pam.d/hostman
  fi
  chmod 644 /etc/pam.d/hostman
fi
cat > /etc/systemd/system/hostman-dashboard.service <<'UNIT'
[Unit]
Description=ByDT Hostman authenticated DNS controller
After=network.target

[Service]
Type=simple
User=root
ExecStart=/opt/hostman/runtime/node /opt/hostman/current/bin/hostman.mjs dashboard serve
Environment=HOSTMAN_PYTHON=/usr/bin/python3
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
UMask=0077

[Install]
WantedBy=multi-user.target
UNIT
if command -v restorecon >/dev/null; then restorecon -RF "$INSTALL" "$DATA" /usr/local/bin/hostman /etc/systemd/system/hostman-dns.service; fi
systemctl daemon-reload
if ((WAS_ACTIVE)); then
  if ! systemctl restart hostman-dns.service || ! /usr/bin/python3 -c 'import sys; sys.path.insert(0, sys.argv[1]); from system import probe; probe()' "$STAGE/python"; then
    if [[ -n "$PREVIOUS" ]]; then
      ln -sfn -- "$PREVIOUS" "$INSTALL/.rollback-current"
      mv -Tf -- "$INSTALL/.rollback-current" "$INSTALL/current"
      systemctl restart hostman-dns.service || true
    fi
    echo 'DNS restart failed. Previous application restored; inspect journalctl -u hostman-dns.' >&2
    exit 1
  fi
fi
DASH_ENABLED="$("$NODE" -e 'const s=JSON.parse(require("fs").readFileSync("/var/lib/hostman/state.json","utf8")); process.stdout.write(s.dashboard?.enabled?"yes":"no")')"
if [[ "$DASH_ENABLED" == yes ]]; then
  systemctl enable hostman-dashboard.service
  if ((DASH_ACTIVE)); then systemctl restart hostman-dashboard.service; else systemctl start hostman-dashboard.service; fi
fi
if [[ -n "$PREVIOUS" ]]; then printf '%s\n' "$PREVIOUS" > "$INSTALL/previous.txt"; fi
echo 'Hostman installed. Run hostman, or sudo hostman for editing.'
echo 'Old command files, if present, were saved in:' "$LINK_BACKUP"
echo 'First-time DNS/controller setup: sudo hostman dns setup'
echo 'Dashboard defaults to localhost:8090 and authenticates system administrator accounts.'
