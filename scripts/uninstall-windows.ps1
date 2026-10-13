$ErrorActionPreference='Stop'
$Install=Join-Path $env:ProgramFiles 'Hostman'
& (Join-Path $Install 'bin\hostman.cmd') dns disable
if($LASTEXITCODE -ne 0){throw 'DNS restoration failed; uninstall stopped.'}
Unregister-ScheduledTask -TaskName 'ByDT Hostman DNS' -Confirm:$false
$Bin=Join-Path $Install 'bin'
$MachinePath=[Environment]::GetEnvironmentVariable('Path','Machine')
[Environment]::SetEnvironmentVariable('Path',(($MachinePath -split ';' | Where-Object {$_ -ne $Bin}) -join ';'),'Machine')
Remove-Item -Recurse -Force $Install
Write-Host 'Hostman removed. Managed hosts and ProgramData\Hostman backups retained.'
