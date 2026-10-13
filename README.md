# Hostman

**Hostman 1.0.0 — ByDT Softwares — MIT License**

A Node.js CLI with a Python backend for managing your system hosts file, host
groups, and an optional local DNS resolver. No npm or pip packages are required.

## Quick start: Fedora

Extract this project, open a terminal in its directory, then:

```bash
sudo bash setup-fedora.sh
hostman help
sudo hostman
```

The installer adds `hostman` and `hostmanager` to `/usr/local/bin`, creates a
protected installation under `/opt/hostman`, and registers a systemd DNS service.
It installs missing Node.js, Python and Git dependencies using dnf. Node.js 22+
and Python 3.9+ are required. Fedora Atomic editions (Silverblue/Kinoite) need
manual package layering and integration; this installer targets conventional
Fedora Workstation/KDE with dnf, NetworkManager and systemd.

For one quick mapping:

```bash
sudo hostman add website.test 127.0.0.1
hostman list
sudo hostman set website.test --ip 192.168.1.50
sudo hostman remove website.test
```

Read-only commands do not need sudo. Editing the real hosts file does.

## Quick start: Windows 10/11

Install **Node.js 22+**, **Python 3.9+**, and **Git for Windows** first. Enable
Python's PATH option. Install Node.js for all users under Program Files, because
the DNS startup task runs as SYSTEM. An all-users Python install is recommended.

Extract the project, then double-click **Setup-Windows.cmd** and accept the UAC
prompt. Alternatively run this from an Administrator PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```

Open a **new terminal** to pick up the machine PATH change:

```powershell
hostman help
hostman
hostman add website.test 127.0.0.1
hostman list --all
```

Use an Administrator terminal for edits. The installer adds `hostman.cmd` and
`hostmanager.cmd` to PATH, protects the application under Program Files, and
registers the **ByDT Hostman DNS** startup task. Installation leaves that task
disabled until you explicitly start/enable DNS. Python is used for hosts and
system integration; the DNS task itself runs directly in Node.js.

## Commands and menu

Run `hostman` for the menu or `hostman help` for every command. The menu supports
adding/editing/deleting hosts, enabling/disabling entries, groups, editing the
existing file, JSON export/import, backups, restore, DNS mode, diagnostics and
updates. It stays open until you choose Exit; ordinary commands finish normally.

| Purpose | Command |
| --- | --- |
| Show Hostman entries | `hostman list` |
| Include pre-existing hosts | `hostman list --all` |
| JSON output | `hostman list --json` |
| Create group | `hostman group create dev` |
| Add an entry | `hostman add api.test 127.0.0.1 --group dev --comment "Local API"` |
| Change IP/name/group/comment | `hostman set api.test --ip 192.168.1.8` |
| IPv6 entry | `hostman add ipv6.test ::1` |
| Disable one mapping | `hostman disable api.test` |
| Enable one mapping | `hostman enable api.test` |
| Disable all hosts in a group | `hostman group disable dev` |
| Rename a group | `hostman group rename dev staging` |
| Clear group entries | `hostman group clear staging --yes` |
| Delete a group and its entries | `hostman group delete staging --yes` |
| Delete managed entries | `hostman clear --yes` |
| Edit existing file | `hostman edit-file` |
| Export to a new JSON file | `hostman export hosts.json` |
| Replace managed data from JSON | `hostman import hosts.json --yes` |
| List backups | `hostman backups` |
| Restore full snapshot | `hostman restore BACKUP-ID --yes` |
| Recover interrupted edit | `hostman recover` |
| Check dependencies and DNS | `hostman doctor` |
| Clear resolver cache | `hostman flush` |
| Check available repo version | `hostman update --check` |
| Install latest main branch | `hostman update` |
| Install a release tag | `hostman update --ref v1.0.1` |

Prefix write commands with `sudo` on Fedora. Hosts can also be selected by the
entry ID printed in `hostman list`. One managed hostname has one IP; create
separate names for separate mappings. Hostnames are case-insensitive and support
IDNA conversion. Use `.test` for local websites; `.local` can conflict with mDNS.

Existing entries are displayed separately and preserved. To change them, use
`edit-file`, or remove the existing line there and then add it as a managed entry.
Hostman refuses active duplicates outside its section. Disabled groups and
entries are retained in its database but omitted from the live hosts file.

The default editor is `vi` on Fedora and Notepad on Windows. Set `HOSTMAN_EDITOR`
to an editor executable path to use another editor (no command-line arguments).
Hostman's generated block is rebuilt from its database after editing; edit that
block with the Hostman commands/menu instead. External edits made while your
editor is open cause a conflict rather than an overwrite.

## Local DNS with system priority

First choose upstream DNS IPs that are reachable from your network. Defaults
are Cloudflare `1.1.1.1` and Quad9 `9.9.9.9`. If you need router-only LAN names or
corporate/VPN DNS, configure those DNS IPs as upstreams instead.

```bash
# Fedora
sudo hostman dns upstream 192.168.1.1 1.1.1.1
sudo hostman dns enable
hostman dns status
hostman dns lookup website.test
hostman dns lookup ipv6.test --type AAAA --tcp
sudo hostman dns disable
```

On Windows run the same commands without sudo, from an Administrator terminal.

Hostman listens **only on 127.0.0.1 and ::1**, TCP and UDP port 53. It answers
hosts-file names first (A/AAAA; other types for a local name receive NODATA), then
forwards unknown names to your upstreams in order. If a server times out or
returns SERVFAIL/REFUSED, the next one is tried. Truncated UDP replies are retried
via TCP. Failed forwarding returns SERVFAIL. There is no daemon DNS cache;
operating systems and apps may still cache the answers for the configured TTL.
Changes reload within about one second. Use `hostman flush` after changes if needed.

- **Fedora:** a dedicated NetworkManager drop-in makes Hostman the exclusive
  general DNS server, overriding DNS from active connections. The installer does
  not stop systemd-resolved; Hostman binds loopback addresses that differ from its
  normal 127.0.0.53 stub. The prior resolv.conf file/symlink is saved and restored.
- **Windows:** DNS is redirected to Hostman on the adapters that are active when
  you enable it, for both IPv4 and IPv6. Original static DNS and automatic DHCP
  DNS modes are recorded separately and restored on disable. Run `dns enable`
  again after switching to a new adapter to include it. Reconnect a removed
  adapter before disabling so its saved settings can be restored.

`dns start` starts the service without redirecting DNS. `dns enable` starts it,
health-checks it, saves prior settings, and redirects DNS. `dns disable` and
`dns stop` restore settings before stopping the service. `dns restart` restarts
the daemon. Service restart policies handle ordinary crashes, but when a local
resolver is down, system DNS is unavailable until it recovers or you disable
Hostman. Upstreams live *inside* Hostman so the OS cannot bypass local overrides
by querying a secondary public DNS server itself.

This priority applies to normal system DNS. Browser Secure DNS/DoH, applications
with their own resolver, VPN policies, mDNS, and already cached answers can use
other resolution paths. Corporate split DNS is not implemented. Hostman is a
local development tool, not a LAN-facing authoritative DNS server or a DNSSEC
validator. Remote DNS packets are forwarded without rewriting their answers;
local overrides are not DNSSEC-signed.

## Updating from GitHub

Official repository: <https://github.com/jan-du-toit/Hostman>

```bash
sudo hostman update --check
sudo hostman update
# Noninteractive:
sudo hostman update --yes --ref main
```

Use an Administrator terminal on Windows. The updater fetches that fixed repo
into a temporary directory and runs its platform installer into a new protected
release directory. It never runs `git reset`, overwrites a source working tree,
or deletes your hosts, groups, backups or DNS settings. It restarts an already
running DNS daemon and restores the prior application release if the health
check fails. The previous release path is retained in `previous.txt`.

`main` is the default branch; `--ref` can select another branch or release tag.
The repo must contain this project, including its installers, package.json and
Python files. Publish the archive contents to your Hostman repository before
using the updater. Updating installs executable code from that repository; use
trusted tags for controlled releases. Downgrades are allowed when you explicitly
select an older tag. There is no signature or GitHub Releases verification.

## Data, backups and permissions

| Item | Fedora | Windows |
| --- | --- | --- |
| Hosts file | `/etc/hosts` | `%SystemRoot%\System32\drivers\etc\hosts` |
| State | `/var/lib/hostman/state.json` | `%ProgramData%\Hostman\state.json` |
| Backups | `/var/lib/hostman/backups/` | `%ProgramData%\Hostman\backups\` |
| DNS restoration record | `/var/lib/hostman/dns-system.json` | `%ProgramData%\Hostman\dns-system.json` |
| Application releases | `/opt/hostman/releases/` | `%ProgramFiles%\Hostman\releases\` |
| Logs | `journalctl -u hostman-dns` | `%ProgramData%\Hostman\dns.log` |

Each edit creates a snapshot of the **entire hosts file** and Hostman database.
Restoring a backup restores both, including non-Hostman entries in that snapshot.
A journal and exclusive lock coordinate edits; an interrupted write is rolled
back by the next write or `recover`. Hostman preserves file permissions and,
on Linux, extended attributes. Windows replacements preserve the destination
ACL. Backups are retained until you remove them; they may contain private names.
A hosts file mounted read-only, immutable, or supplied as a bind mount may reject
atomic replacement. Normal Fedora and Windows hosts files are supported.

## Uninstall

Optionally run `hostman clear --yes` first to remove Hostman's mappings. Then:

```bash
sudo bash /opt/hostman/current/scripts/uninstall-fedora.sh
```

Windows, from Administrator PowerShell:

```powershell
$release = (Get-Content "$env:ProgramFiles\Hostman\current.txt" -Raw).Trim()
& "$release\scripts\uninstall-windows.ps1"
```

Uninstall restores system DNS and removes the application, command wrappers and
service/task. It retains hosts entries and state/backups so your work is not lost.

## Development and verification

```bash
node bin/hostman.mjs help
npm test
```

Tests use temporary hosts/state files and unprivileged DNS ports. They never
change this machine's DNS or hosts file. `HOSTMAN_DATA_DIR` and
`HOSTMAN_HOSTS_FILE` can be set for development; system DNS changes and installers
refuse those overrides. Do not set them for installed system services.

See [docs/TESTING.md](docs/TESTING.md) for automated results and the platform smoke
test checklist. The shipped project has no runtime dependencies beyond Node,
Python and system utilities. Licensed under [MIT](LICENSE).
