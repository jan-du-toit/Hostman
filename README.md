# Hostman

**Hostman 1.2.0 — ByDT Softwares — MIT License**

A Node.js CLI with a Python backend for managing your system hosts file, host
groups, and an optional local DNS resolver. No npm or pip packages are required.

## One-command install: Fedora and Ubuntu

After publishing the new stable Release with `linux-installer.sh` and the
complete `Hostman-v1.2.0.zip` attached:

```bash
curl -fsSL https://github.com/jan-du-toit/Hostman/releases/latest/download/linux-installer.sh | sudo bash
```

The bootstrap looks up the latest stable GitHub Release, downloads your uploaded
ZIP, verifies its size and GitHub SHA-256 digest when available, safely extracts
it and runs its installer. GitHub-generated source archives are not used. There
is no fallback to `main`, old tags or prereleases. The root `install.sh` is the
same bootstrap and can also be distributed directly.

The shared installer supports conventional Fedora and Ubuntu 22.04/24.04 with
systemd. It uses system Node.js 22+ or installs a private Node 22 runtime from
nodejs.org with checksum verification. Python 3.9+ and normal OS utilities are
installed as needed. It does not replace another application's Node runtime.
Automatic private Node setup supports x86_64 and ARM64. Fedora Atomic editions
and non-systemd containers/WSL instances require manual integration. Curl is
needed for the initial command. Git is no longer required for Release updates.

For a downloaded source archive, extract it and run:

```bash
sudo bash setup-linux.sh
hostman help
sudo hostman
```

`setup-fedora.sh` remains a compatibility alias. Commands are installed in
`/usr/local/bin`, the application in `/opt/hostman`, and the DNS daemon is
registered as a systemd service. DNS priority is **not enabled by installation**.

Old `hostman`/`hostmanager` wrappers, hard links and symlinks are backed up and
replaced without following them. This fixes the old "are the same file" error
and leaves unrelated old program targets untouched.

For one quick mapping:

```bash
sudo hostman add website.test 127.0.0.1
hostman list
sudo hostman set website.test --ip 192.168.1.50
sudo hostman remove website.test
```

Read-only commands do not need sudo. Editing the real hosts file does.

## Quick start: Windows 10/11

Download and run **windows-installer.exe**. Accept the administrator prompt,
then continue through the welcome, MIT license and installation pages. Run
`hostman dns setup` from an Administrator terminal afterward for DNS and dashboard setup.

The executable contains the Hostman application. Missing Node.js 22+ and Python
3.9+ dependencies are installed for all users through WinGet. This
requires WinGet (Microsoft App Installer) and internet access for missing
prerequisites. If WinGet is unavailable, install those prerequisites for all
users manually, then rerun the installer. The installer targets 64-bit Windows
10/11. It registers Hostman in Installed Apps, provides Start Menu shortcuts,
and includes a matching uninstaller.

This build is **unsigned**. No code-signing certificate was supplied. Windows
may display an unknown-publisher or SmartScreen prompt. The installer has been
compiled and inspected here; full Windows installation needs the VM smoke tests
in docs/TESTING.md.

After setup, open a **new terminal** to pick up PATH:

```powershell
hostman help
hostman
```

Use an Administrator terminal for hosts edits and DNS settings. The installer
adds `hostman` and `hostmanager` commands, protects the application under Program
Files, and registers the **ByDT Hostman DNS** startup task. The task stays disabled
until you explicitly enable/start DNS. Existing hosts, groups and backups are
preserved. An existing running Hostman DNS task is restarted during upgrades.

The source package also retains the manual `Setup-Windows.cmd` installer. It
requires prerequisites to be installed already:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```

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
| Check the latest stable Release | `hostman update --check` |
| Install the latest uploaded ZIP | `hostman update` |
| Uninstall and restore DNS | `hostman uninstall` |
| Configure DNS and optional dashboard | `hostman dns setup` |
| Change dashboard port | `hostman dashboard port 8091` |
| Block domain and subdomains | `hostman dns block "*.example.com"` |
| Set TTL/timeout/logging | `hostman dns config --ttl 60 --timeout 1500 --logging on` |

Prefix write commands with `sudo` on Fedora or Ubuntu. Hosts can also be selected by the
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
# Fedora / Ubuntu
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

- **Fedora / Ubuntu Desktop with NetworkManager:** a dedicated NetworkManager drop-in makes Hostman the exclusive
  general DNS server, overriding DNS from active connections. The installer does
  not stop systemd-resolved; Hostman binds loopback addresses that differ from its
  normal 127.0.0.53 stub. The prior resolv.conf file/symlink is saved and restored.
- **Ubuntu Server with systemd-resolved:** a saved resolver drop-in selects
  Hostman as the default DNS route, and resolv.conf is pointed to Hostman.
  Hostman does not switch the machine to NetworkManager or rewrite netplan.
  More-specific VPN/split-DNS routes can still apply to applications using
  systemd-resolved directly; hosts-file overrides remain available there.
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

## DNS setup and optional controller dashboard

On Fedora/Ubuntu:

```bash
sudo hostman dns setup
```

On Windows, use the same command without sudo from an Administrator terminal.
The wizard asks for upstream IPs, TTL and query logging, then asks whether you
want the dashboard and which port to use (default **8090**). It can enable DNS
priority at the end. The wizard runs on first interactive DNS enable/menu use
if you have not completed it yet. It can be rerun at any time. Dashboard and DNS
services are independent: the dashboard remains usable while DNS is stopped.

Open **http://localhost:8090** and sign in with your system account username and
password. The interface uses the ByDT Softwares website's ice-blue/cyan theme,
rounded panels and logo, all served locally without third-party page resources.

- Linux passwords are checked through PAM with the normal system account policy;
  root or members of `wheel`/`sudo` can control DNS.
- Windows passwords are checked with LogonUser; the authenticated account must
  belong to Administrators. Local accounts and `DOMAIN\username` are supported.
  Use the account password, not a Windows Hello PIN. Microsoft-account-only or
  passwordless/OTP PAM policies can require a compatible local password account.
- Passwords are never stored or written to logs. Sessions expire after 30 minutes
  idle or eight hours total; logout invalidates them immediately.
- Requests enforce a local Host header, same-origin mutations, session cookies,
  CSRF tokens, login rate limits and a fixed set of allowed actions.

The dashboard binds only to **127.0.0.1**, since it accepts real OS passwords over
local HTTP. It is intended for a browser on that computer. It is not exposed to
LAN clients. Its port can be changed:

```bash
sudo hostman dashboard port 8091
sudo hostman dashboard status
sudo hostman dashboard enable
sudo hostman dashboard disable
```

The controller provides record/group CRUD and toggles, upstream/TTL/timeout
settings, exact and wildcard blocking, DNS start/restart/priority/restore/cache
controls, counters and a rolling recent-query table.

```bash
sudo hostman dns block "*.example.com"
hostman dns blocks
sudo hostman dns unblock "*.example.com"
sudo hostman dns config --ttl 60 --timeout 1500 --logging off
```

Blocking rules apply before Hostman local answers and return NXDOMAIN. System
resolution through /etc/hosts or another resolver can bypass DNS blocking; only
queries that reach Hostman are filtered. `*.example.com`
includes the parent and all subdomains. Turning query logging off clears recent
names while keeping aggregate counters. The resolver retains up to 200 recent
queries; metrics are snapshots of in-memory activity, not a historical database.
Linux metrics live under `/run/hostman`, Windows under the protected
`ProgramData\Hostman\runtime` folder. Dashboard port changes restart an enabled
controller. A port conflict is reported rather than silently choosing a new port.

## Updating from GitHub Releases

Official repository: <https://github.com/jan-du-toit/Hostman>

```bash
sudo hostman update --check
sudo hostman update
sudo hostman update --yes
```

On Windows, use an Administrator terminal without sudo. The updater calls
GitHub's **latest stable Release** endpoint and uses your attached ZIP asset.
It no longer clones `main` or accepts `--ref`. Old/prerelease versions cannot be
selected, and packages older than or equal to the installed version are skipped.

Upload one complete **Hostman-vX.Y.Z.zip** to a Release marked **Latest**. The
package.json version must match a normal version tag such as `v1.2.0`. The ZIP
can contain the files directly or one enclosing Hostman directory. It must
include the full project and both platform installers. If supplying separate
platform ZIPs, name them clearly with `linux`/`windows`. Ambiguous assets,
malicious paths, symlinks, duplicate paths, oversized extraction and incomplete
packages are rejected before installing. Do not upload a ZIP of only changed
files. Automatic GitHub "Source code" ZIPs are deliberately ignored.

The updater checks the download size and the API-provided SHA-256 digest when
available; this is integrity checking, not a signing certificate. Installers use
protected new release directories, retain the previous app and preserve your
hosts, groups, DNS setup and backups. An active DNS service is health-checked
after replacement. No Git working tree is overwritten.

**Moving from v1.0/v1.1:** install this ZIP or the new Windows EXE once. Those
older versions still contain their old Git-based updater. After this upgrade,
future `hostman update` commands use Releases only.

## Data, backups and permissions

| Item | Fedora / Ubuntu | Windows |
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
atomic replacement. Normal Fedora, Ubuntu and Windows hosts files are supported.

## Uninstall

```bash
sudo hostman uninstall
# Explicit noninteractive removal:
sudo hostman uninstall --yes
# Also remove managed hosts entries (the edit is backed up):
sudo hostman uninstall --yes --remove-hosts
```

On Windows, use an Administrator terminal without sudo, or uninstall through
Installed Apps. The command restores prior system DNS before stopping/removing
the application and both service/task registrations. Hosts and backups are
retained by default; `--remove-hosts` clears only managed entries. OS accounts
and passwords are not changed. Dependency runtimes shared with other apps remain
installed. If restoring DNS fails, uninstall stops so DNS is not left pointing
at a missing resolver.

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

## Rebuilding the Windows executable

Install NSIS 3, then run:

```powershell
.\installer\build-installer.ps1
```

On Linux with `makensis` in PATH:

```bash
bash installer/build-installer.sh
```

The version is currently specified in both package.json and installer/hostman.nsi;
update both when creating a release. The generated EXE bundles the source at
build time; subsequent updates pull from the official GitHub repo.
