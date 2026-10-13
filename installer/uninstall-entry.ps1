$ErrorActionPreference='Stop'
try {
    $Install=$PSScriptRoot
    $env:ProgramFiles=[Environment]::GetFolderPath('ProgramFiles')
    $release=(Get-Content -Raw -LiteralPath (Join-Path $Install 'current.txt')).Trim()
    & (Join-Path $release 'scripts\uninstall-windows.ps1') -KeepApplication
    if(!$?){throw 'Hostman DNS restoration failed.'}
    exit 0
} catch {
    Write-Host $_.Exception.Message
    exit 1
}
