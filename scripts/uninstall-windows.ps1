param([switch]$KeepApplication)
$ErrorActionPreference='Stop'
$Install=Join-Path $env:ProgramFiles 'Hostman'
& (Join-Path $Install 'bin\hostman.cmd') dns disable
if($LASTEXITCODE -ne 0){throw 'DNS restoration failed; uninstall stopped.'}
Stop-ScheduledTask -TaskName 'ByDT Hostman Dashboard' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'ByDT Hostman Dashboard' -Confirm:$false -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'ByDT Hostman DNS' -Confirm:$false
$Bin=Join-Path $Install 'bin'
$MachinePath=[Environment]::GetEnvironmentVariable('Path','Machine')
[Environment]::SetEnvironmentVariable('Path',(($MachinePath -split ';' | Where-Object {$_ -ne $Bin}) -join ';'),'Machine')
if(!$KeepApplication){Remove-Item -Recurse -Force $Install}
Write-Host 'Hostman removed. Managed hosts and ProgramData\Hostman backups retained.'
