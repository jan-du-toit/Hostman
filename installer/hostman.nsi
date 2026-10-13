; ByDT Softwares Hostman installer — MIT License.
Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
!include "WinVer.nsh"
!ifndef SOURCE_DIR
  !define SOURCE_DIR ".."
!endif
!ifndef OUTPUT_FILE
  !define OUTPUT_FILE "windows-installer.exe"
!endif
Name "Hostman 1.2.0 — ByDT Softwares"
OutFile "${OUTPUT_FILE}"
InstallDir "$PROGRAMFILES64\Hostman"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
VIProductVersion "1.2.0.0"
VIAddVersionKey /LANG=1033 "ProductName" "Hostman"
VIAddVersionKey /LANG=1033 "CompanyName" "ByDT Softwares"
VIAddVersionKey /LANG=1033 "FileDescription" "Hostman Installer"
VIAddVersionKey /LANG=1033 "FileVersion" "1.2.0.0"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Copyright 2026 ByDT Softwares — MIT License"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Install Hostman"
!define MUI_WELCOMEPAGE_TEXT "ByDT Softwares Hostman manages hosts files and optional local DNS.$\r$\n$\r$\nSetup installs the bundled Hostman source, adds commands to PATH and registers its DNS task.$\r$\n$\r$\nMissing Node.js and Python dependencies are installed through WinGet and require internet access. DNS priority remains disabled until you enable it."
!define MUI_FINISHPAGE_TEXT "Hostman is installed.$\r$\n$\r$\nOpen a NEW terminal and run hostman.$\r$\nUse an Administrator terminal for hosts edits and DNS changes.$\r$\n$\r$\nHostman is published under the MIT License."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${SOURCE_DIR}/LICENSE"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  SetShellVarContext all
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "This installer requires 64-bit Windows 10 or 11."
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "This installer requires Windows 10 or 11."
    Abort
  ${EndIf}
  StrCpy $INSTDIR "$PROGRAMFILES64\Hostman"
FunctionEnd

Section "Hostman" SEC_HOSTMAN
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\Hostman"
  File /r /x "__pycache__" /x "*.pyc" /x ".git" /x "dist" "${SOURCE_DIR}/*"
  ${DisableX64FSRedirection}
  StrCpy $0 -1
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\Hostman\scripts\installer-windows.ps1" -Source "$PLUGINSDIR\Hostman"' $0
  ${EnableX64FSRedirection}
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Hostman setup failed (code $0).$\r$\nSee %ProgramData%\Hostman\installer.log for details.$\r$\nIf WinGet is unavailable, install Node.js 22+ and Python 3.9+ for all users and rerun setup."
    SetErrorLevel 1
    Abort
  ${EndIf}
  SetOutPath "$INSTDIR"
  File /oname=uninstall-bootstrap.ps1 "${SOURCE_DIR}/installer/uninstall-entry.ps1"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  SetRegView 64
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ByDT-Hostman" "DisplayName" "Hostman"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ByDT-Hostman" "DisplayVersion" "1.2.0"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ByDT-Hostman" "Publisher" "ByDT Softwares"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ByDT-Hostman" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ByDT-Hostman" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ByDT-Hostman" "URLInfoAbout" "https://github.com/jan-du-toit/Hostman"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ByDT-Hostman" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ByDT-Hostman" "NoRepair" 1
  CreateDirectory "$SMPROGRAMS\ByDT Softwares"
  CreateShortcut "$SMPROGRAMS\ByDT Softwares\Hostman.lnk" "$SYSDIR\cmd.exe" '/K "$INSTDIR\bin\hostman.cmd"'
  CreateShortcut "$SMPROGRAMS\ByDT Softwares\Uninstall Hostman.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  SetShellVarContext all
  ${DisableX64FSRedirection}
  StrCpy $0 -1
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\uninstall-bootstrap.ps1"' $0
  ${EnableX64FSRedirection}
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "DNS settings could not be restored. Uninstall stopped; run hostman dns disable as Administrator and try again."
    SetErrorLevel 1
    Abort
  ${EndIf}
  SetRegView 64
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\ByDT-Hostman"
  Delete "$SMPROGRAMS\ByDT Softwares\Hostman.lnk"
  Delete "$SMPROGRAMS\ByDT Softwares\Uninstall Hostman.lnk"
  RMDir "$SMPROGRAMS\ByDT Softwares"
  RMDir /r "$INSTDIR\releases"
  RMDir /r "$INSTDIR\bin"
  Delete "$INSTDIR\current.txt"
  Delete "$INSTDIR\previous.txt"
  Delete "$INSTDIR\node.txt"
  Delete "$INSTDIR\python.txt"
  Delete "$INSTDIR\uninstall-bootstrap.ps1"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  MessageBox MB_OK "Hostman removed. Hosts entries and backups in ProgramData\Hostman were retained." /SD IDOK
SectionEnd
