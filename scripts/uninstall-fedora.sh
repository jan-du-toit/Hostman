#!/usr/bin/env bash
set -euo pipefail
if ((EUID != 0)); then echo 'Run this script with sudo.' >&2; exit 1; fi
/opt/hostman/current/bin/hostman.mjs dns disable
systemctl disable --now hostman-dashboard.service || true
systemctl disable --now hostman-dns.service
rm -f /etc/systemd/system/hostman-dns.service /etc/systemd/system/hostman-dashboard.service /usr/local/bin/hostman /usr/local/bin/hostmanager
systemctl daemon-reload
rm -f /etc/pam.d/hostman
rm -rf /opt/hostman
echo 'Hostman uninstalled. Managed hosts and /var/lib/hostman backups are retained.'
echo 'Before uninstalling, run hostman clear --yes if you want to remove managed hosts.'
