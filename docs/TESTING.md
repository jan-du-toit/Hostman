# Hostman 1.2.0 verification

Verified with Node.js 24.19.0 and Python 3.12.14. **27 automated tests passed**.
No real system hosts, DNS settings, user passwords or OS accounts were changed.

The tests cover:

- Hosts CRUD, groups, enable/disable, IPv4/IPv6, validation and existing-entry preservation.
- CRLF content, backups, interrupted-edit recovery, editor conflicts and concurrent writes.
- v1.0 schema-1 migration to DNS/controller defaults; blocking and dashboard setting validation.
- Sandbox refusal of uninstall and global DNS changes.
- UDP/TCP DNS, IPv6 loopback, reload, upstream failover, spoofed IDs and truncated responses.
- Exact/wildcard NXDOMAIN blocking and query metrics.
- Old wrapper migration (reverse links, hard links, loops, same-target links), repeat installs.
- Mocked NetworkManager/systemd-resolved restoration and rollback, including old Fedora snapshots.
- Latest Release ZIP selection, ambiguous/absent assets, version comparison and missing Release errors.
- Safe ZIP extraction: normal/wrapped projects, path traversal, symlinks, duplicate names and completeness.
- Dashboard port-conflict validation before changing settings.
- Dashboard login/session/logout, CSRF, same-origin requests, fixed actions, injection refusal and rate limits.
- Empty-credential refusal and a real native C/Python PAM conversation ABI test with a fake PAM library.
  The native ABI check uses gcc when available and skips that subtest otherwise.

Additional DOM interaction checks exercised the actual dashboard JavaScript over
its HTTP API with a disposable fake authentication provider: login, record/group
creation, tab navigation, blocking, resets and logout passed with no script errors.
That provider exists only in test/QA scaffolding; the installed service uses the
OS-password helper. The browser preview could not be reached from this environment,
so a visual browser review remains a platform smoke-test item.

Python, JavaScript, shell scripts and the embedded bootstrap Python were
syntax-checked. PowerShell scripts parsed with PowerShell 7.6.6 on Linux. NSIS 3.09
compiled the Windows installer; its Windows PE header and administrator manifest
were checked. The systemd unit was checked using a temporary local Node path.
The EXE is unsigned. No signing certificate was supplied.

## Real-machine smoke tests still required

This runtime is not a Fedora desktop or a Windows system. Passing these checks
is not a live OS-password, Task Scheduler, systemd/network or uninstall test.

### Fedora / Ubuntu

1. Install the ZIP or publish a test stable Release and use linux-installer.sh.
2. Confirm hosts/groups survive migration from v1.0/v1.1 and both PATH aliases work.
3. Run `sudo hostman dns setup`, choose the dashboard, and check localhost:8090.
4. Sign in with a real wheel/sudo account password; reject incorrect and non-admin accounts.
5. Add/edit/toggle/delete a record/group; verify DNS answers and query activity.
6. Set upstreams, TTL, timeout and logging. Check exact/wildcard blocking and logging-off behavior.
7. Use enable/disable/restart/cache controls, then compare restored OS DNS to its saved state.
8. Test Fedora NetworkManager, Ubuntu Desktop NetworkManager and Ubuntu Server systemd-resolved.
9. Change the controller port, check conflicts, restart/reboot and verify preserved configuration.
10. Upload a newer full ZIP to Latest and check update, active DNS/controller restart and state retention.
11. Run `hostman uninstall`; verify DNS restoration, unit/PAM/PATH cleanup and retained backups.
12. Check Fedora SELinux enforcing operation and inability of normal users to edit protected data/app files.

### Windows 10/11

1. Run windows-installer.exe; test both existing prerequisites and WinGet dependency installation.
2. Open a fresh Administrator terminal; check aliases and run the DNS setup wizard.
3. Sign in with a real Administrators account password (not Hello PIN), including an account with UAC.
4. Reject incorrect/non-admin credentials; check native LogonUser authorization and account variants.
5. Exercise records, groups, wildcard blocks, metrics, upstream configuration and DNS priority restoration.
6. Change the port, test conflicts, reboot and check the independent DNS/controller tasks.
7. Verify SYSTEM finds the protected Python pointer and query logs are inaccessible to standard users.
8. Perform a live latest-Release update; verify tasks and preferences survive and the previous app is retained.
9. Uninstall from the CLI and Installed Apps; confirm restored IPv4/IPv6 static/DHCP DNS and task/PATH cleanup.
10. Confirm the ByDT theme on desktop/mobile sizes and browser focus, validation and session-expiry behavior.
