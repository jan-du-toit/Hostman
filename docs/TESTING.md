# Verification report

Hostman 1.0.0 was verified in a Linux container using Node.js 24.19.0 and Python
3.12.14. All **15 automated integration tests passed**. No real hosts or system
DNS settings were changed during verification.

## Automated checks

- Hosts CRUD, IPv4 and IPv6, case normalization, enable/disable and group rename.
- Preservation of unmanaged entries, comments and CRLF content.
- Validation of duplicate names, invalid IPs, line injection and corrupt markers.
- Backup/restore of full hosts and managed state.
- Recovery from a simulated interrupted transaction.
- Optimistic conflict detection when editing the full file.
- Twelve concurrent Python writers without lost updates.
- Real CLI add, list, export, clear and import commands against sandbox paths.
- Refusal of system DNS edits with sandbox overrides and updates before install.
- Real UDP/TCP A/AAAA queries, local NODATA and hot reload.
- Upstream response ID checks and preservation of client IDs.
- Retry through a second upstream when the first is silent.
- TCP retry when an upstream sends a truncated UDP response.
- Large UDP response truncation and complete TCP responses.
- IPv6 loopback sockets and malformed DNS packets.
- The actual foreground CLI DNS process reloads edited hosts without a restart.

Shell scripts and Python/JavaScript files were syntax-checked. The generated
systemd unit was checked with systemd-analyze verify against a temporary service
path, substituting this container's Node executable for Fedora's `/usr/bin/node`. The checks do not start the service or apply networking changes.

## Platform checks still required

This container is **not a Fedora desktop** and has **no Windows/PowerShell
runtime**. The following require real disposable VMs before publishing a stable
release. The GitHub updater also needs the source published in the supplied repo
and working GitHub connectivity; no live update or push was performed here.

### Fedora VM

1. Record `/etc/resolv.conf`, its symlink target and NetworkManager DNS config.
2. Install with `sudo bash setup-fedora.sh`; confirm both PATH aliases.
3. Use `sudo hostman` to create/edit a test mapping and a group.
4. Set a reachable upstream, enable DNS, and check `getent hosts website.test`.
5. Verify `hostman dns lookup website.test --tcp` and `--type AAAA`.
6. Resolve an ordinary public hostname; check NetworkManager's nameserver list.
7. Reboot and verify DNS priority, then stop/restart the service.
8. Disable DNS and compare the saved prior resolver settings.
9. Simulate a port-53 conflict and confirm enable rolls back without redirecting.
10. Test updating to a second trusted tag, then the rollback path with a bad DNS
    release. Confirm entries/backups persist.
11. Check SELinux enforcing operation and non-root inability to edit protected
    state/hosts. Uninstall and verify DNS restoration and retained backups.

### Windows 10/11 VM

1. Record current static/automatic DNS for every active IPv4/IPv6 adapter.
2. Install as Administrator with a path containing spaces; open a new terminal
    and check both PATH aliases.
3. Confirm standard users can list but cannot edit hosts, state or application
    files. Test Notepad editing and snapshot restore.
4. Enable DNS. Check the startup task runs as SYSTEM and listeners bind only to
    127.0.0.1 and ::1, TCP/UDP 53.
5. Resolve a local mapping with `Resolve-DnsName website.test` and a public name;
    test `hostman dns lookup ipv6.test --type AAAA --tcp`.
6. Reboot and check the task restarts correctly. Disable DNS; confirm both static
    and DHCP DNS settings are restored for each family.
7. Connect another adapter, rerun enable, and confirm it is included. Test the
    disconnected-adapter recovery message.
8. Check task restart after a crash and port-53 conflict handling.
9. Update across two trusted tags; confirm task restart, state preservation and
    application rollback. Uninstall and inspect restored DNS and retained state.

Use disposable VMs for system integration; automated tests intentionally never
need administrator privileges or modify global networking.
