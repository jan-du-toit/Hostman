# Changelog

## 1.2.0

- `hostman uninstall`, with DNS restoration, service cleanup and optional managed-host removal.
- Latest stable GitHub Release ZIP updates and installs; no branch/tag selection or Git dependency.
- Size/digest validation and safe bounded extraction of uploaded full-project ZIPs.
- First-time DNS wizard with upstreams, TTL, query logging and optional controller/port.
- Authenticated local DNS controller at localhost:8090, configurable port, classic ByDT theme/logo.
- Real system passwords: Linux PAM and Windows LogonUser, with administrator authorization.
- Same-origin/Host checks, session expiry, CSRF protection, login rate limits and fixed actions.
- Exact/wildcard domain blocking, query counters and optional recent activity.
- Colored terminal status, a new menu banner, separate dashboard service/task and persisted upgrade defaults.

## 1.1.0

- One-command GitHub bootstrap and shared Fedora/Ubuntu installer.
- Private, checksum-verified Node 22 runtime when system Node is unavailable.
- Legacy command-link migration fixes reverse symlinks, loops and hard links.
- Ubuntu systemd-resolved DNS backend with reversible settings; retains v1.0 backups.
- Compiled NSIS Windows installer with UAC, MIT license, dependency setup through WinGet,
  PATH, Start Menu shortcuts, Installed Apps registration and uninstaller.
- UTF-8 Windows command pointers support installation paths with Unicode characters.
- Installer regression checks and mocked DNS restoration/rollback tests.

## 1.0.0

- Node.js CLI and persistent interactive menu, with `hostman`/`hostmanager` aliases.
- Standard-library Python hosts-file backend with exclusive locking, journal
  recovery, automatic snapshots and optimistic editor conflict detection.
- Host CRUD, group CRUD/toggles, IPv4/IPv6 and JSON import/export.
- Loopback-only UDP/TCP DNS with local-first resolution and upstream failover.
- Optional reversible system DNS priority for Fedora NetworkManager and Windows.
- Protected Fedora/Windows installation, PATH setup and service/startup task.
- Fixed-repository GitHub updater with branch/tag selection and prior release
  retention; running DNS is health-checked after an update.
- ByDT Softwares branding and MIT License.
