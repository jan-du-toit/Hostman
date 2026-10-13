# Publish Hostman 1.2.0

Publish a **stable GitHub Release**, mark it **Latest**, and attach:

| File | Use |
| --- | --- |
| Hostman-v1.2.0.zip | Complete update/install project payload |
| windows-installer.exe | Windows executable installer |
| linux-installer.sh | Fedora/Ubuntu latest-Release bootstrap |

The Release tag should be `v1.2.0`, matching package.json. Never attach only the
files that changed; the updater needs the full project. The supplied source ZIP
already has the correct structure. If multiple ZIPs are attached, give platform
ones clear `linux`/`windows` names and keep the universal ZIP named Hostman-vX.Y.Z.zip.

No Release or source commit is published by this task. Upload the provided files
before testing the live latest-Release URLs.

Your website can use stable download URLs:

- https://github.com/jan-du-toit/Hostman/releases/latest/download/windows-installer.exe
- https://github.com/jan-du-toit/Hostman/releases/latest/download/linux-installer.sh

Linux one-command installation:

```bash
curl -fsSL https://github.com/jan-du-toit/Hostman/releases/latest/download/linux-installer.sh | sudo bash
```

The script retrieves the uploaded ZIP from the latest Release. Source checkouts
can still install with `sudo bash setup-linux.sh`. For v1.0/v1.1 installations,
run the new local installer/EXE once to migrate to Release-based updating.

Windows setup bundles Hostman and uses WinGet for missing all-users Node.js and
Python prerequisites. Git is no longer needed. The EXE is unsigned. It registers
Installed Apps and Start Menu entries plus independent DNS and controller startup
tasks. DNS and the controller remain opt-in through `hostman dns setup`.

After installing, run the DNS setup wizard from an Administrator/root terminal.
The controller uses existing OS administrator accounts and real passwords; it
does not create separate accounts or store a password database.

Rebuild the executable with NSIS 3:

```powershell
.\installer\build-installer.ps1
```

Linux with makensis in PATH:

```bash
bash installer/build-installer.sh
```

Keep the version in package.json and installer/hostman.nsi synchronized.
Dependency licenses remain with their respective upstream packages. Hostman
itself is made by ByDT Softwares and licensed under MIT.
