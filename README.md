# Hostman

**ByDT Softwares · Version 1.2.0 · MIT License**

Hostman lets you give devices and local websites easy-to-remember names, organise
those names into groups, and manage DNS on your computer. Use the terminal menu
or the optional browser dashboard—no programming experience is needed.

For example, you can make `files.test` point to a device on your network instead
of typing its IP address each time. Hostman changes how a name is found; it does
not create a website or start the service on that device.

## Install Hostman

You need an administrator account and an internet connection for installation.

### Windows

1. Download [windows-installer.exe](https://github.com/jan-du-toit/Hostman/releases/latest/download/windows-installer.exe) from the official Hostman release.
2. Open the installer and approve the Windows administrator prompt.
3. Follow the setup screens. Missing required software is installed automatically
   when Windows App Installer is available.
4. Open a **new** Terminal or PowerShell window after installation.

Hostman supports 64-bit Windows 10 and 11. The installer is unsigned, so Windows
may show an unknown-publisher notice. Use the download from the official
[ByDT Softwares Hostman repository](https://github.com/jan-du-toit/Hostman).

### Fedora or Ubuntu

Open Terminal, paste this command and press Enter:

```bash
curl -fsSL https://github.com/jan-du-toit/Hostman/releases/latest/download/linux-installer.sh | sudo bash
```

Enter your computer's password if prompted. Linux does not show characters while
you type a password; this is normal. The installer downloads the latest version
and installs the software it needs.

The installer supports standard Fedora installations and Ubuntu 22.04/24.04.
See the [installation guide](docs/INSTALLERS.md) for requirements and other ways
to install.

## Open the menu

On Windows, right-click Terminal or PowerShell and choose **Run as administrator**,
then enter:

```powershell
hostman
```

On Fedora or Ubuntu, enter:

```bash
sudo hostman
```

Choose an option by typing its number. You can add, edit, enable, disable and
remove names, manage groups, check your setup, update Hostman or uninstall it.
The menu stays open until you choose Exit.

You can run `hostman list` or `hostman help` without administrator access. Changes
to your computer's hosts or DNS settings need administrator access.

## Set up DNS and the dashboard

DNS is the system that turns names into addresses. Hostman's optional DNS mode
checks your local names and blocking rules, then asks another DNS server about
names it does not know. Installing Hostman does not switch this mode on.

On Fedora or Ubuntu:

```bash
sudo hostman dns setup
```

On Windows, use an Administrator terminal:

```powershell
hostman dns setup
```

The setup questions cover:

- **Upstream servers:** the DNS servers used for other names. Press Enter to keep
  the suggested addresses if you do not need a particular network DNS server.
- **TTL:** how long other software may remember a local DNS answer. Keep the
  suggested value if you are unsure.
- **Query activity:** whether to keep a short list of recent DNS lookups.
- **Dashboard:** answer `y` if you want to manage DNS in your browser.
- **Dashboard port:** press Enter to use `8090`, or choose a different number.
- **DNS priority:** answer `y` to use Hostman for normal DNS lookups on this computer.

If you enabled the dashboard, open **http://localhost:8090** on the same computer.
Sign in with your **system administrator username and password**. On Windows,
use your account password, not your Windows Hello PIN.

The dashboard lets you manage names, groups, upstream servers, blocking rules and
DNS controls. It also shows recent activity when query logging is enabled. You
can rerun the setup command whenever you want to change your choices.

## Common commands

These examples use Windows syntax. On Fedora or Ubuntu, add `sudo` before commands
that change settings. You can also perform these tasks from the menu.

| What you want to do | Command |
| --- | --- |
| See your names and addresses | `hostman list` |
| See all hosts-file entries | `hostman list --all` |
| Add a name for a network device | `hostman add files.test 192.168.1.50` |
| Change its address | `hostman set files.test --ip 192.168.1.60` |
| Temporarily turn off a name | `hostman disable files.test` |
| Turn it back on | `hostman enable files.test` |
| Remove a name | `hostman remove files.test` |
| Check your installation | `hostman doctor` |
| Check for an update | `hostman update --check` |
| Install the latest update | `hostman update` |
| Remove Hostman | `hostman uninstall` |
| See every command | `hostman help` |

Replace the sample IP addresses with the addresses of your own devices. For
custom local names, use an ending such as `.test` to avoid replacing a real
website's address.

## Updates and backups

`hostman update` checks the latest published Hostman release and asks before
installing it. Your names, groups, settings and backups are kept. You cannot use
this command to choose an older version.

Hostman automatically backs up changes to your hosts and saved settings. Restore
only when you want to return to an earlier state: a backup restores the **whole
hosts file and Hostman's saved settings**, not just one name. The
[user guide](docs/USER_GUIDE.md) explains how to export and restore your work.

## Remove Hostman

Run `hostman uninstall` from an Administrator terminal on Windows, or
`sudo hostman uninstall` on Fedora/Ubuntu. Confirm when asked.

Hostman restores the previous DNS settings before removing itself. Your saved
hosts entries and backups remain unless you choose to remove managed entries
with `--remove-hosts`. Windows users can also remove Hostman through
**Settings → Apps → Installed apps**.

## More help

- [Installation guide](docs/INSTALLERS.md)
- [User guide: names, groups, DNS and the dashboard](docs/USER_GUIDE.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [What's new](CHANGELOG.md)
- [Report a problem](https://github.com/jan-du-toit/Hostman/issues)

Hostman is made by **ByDT Softwares** and distributed under the [MIT License](LICENSE).
