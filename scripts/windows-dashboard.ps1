param([ValidateSet('enable','disable','start','stop','restart','status')][string]$Action='status')
$ErrorActionPreference='Stop'
$Task='ByDT Hostman Dashboard'
if($Action -eq 'status'){Get-ScheduledTask -TaskName $Task | Select-Object TaskName,State;exit 0}
$id=[Security.Principal.WindowsIdentity]::GetCurrent()
if(!([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Use an Administrator terminal.'}
if($env:HOSTMAN_DATA_DIR -or $env:HOSTMAN_HOSTS_FILE){throw 'System operations are disabled with test path overrides.'}
switch($Action){
    'enable' {Enable-ScheduledTask -TaskName $Task | Out-Null;Start-ScheduledTask -TaskName $Task}
    'disable' {Stop-ScheduledTask -TaskName $Task;Disable-ScheduledTask -TaskName $Task | Out-Null}
    'restart' {Stop-ScheduledTask -TaskName $Task;Start-Sleep -Milliseconds 500;Start-ScheduledTask -TaskName $Task}
    'start' {Enable-ScheduledTask -TaskName $Task | Out-Null;Start-ScheduledTask -TaskName $Task}
    'stop' {Stop-ScheduledTask -TaskName $Task}
}

if($Action -in @('enable','start','restart')){
    $config=Get-Content -Raw (Join-Path $env:ProgramData 'Hostman\state.json') | ConvertFrom-Json
    $ready=$false
    for($i=0;$i -lt 40;$i++){
        try{$health=Invoke-RestMethod -Uri ('http://127.0.0.1:'+$config.dashboard.port+'/api/health') -TimeoutSec 1;if($health.service -eq 'hostman-dashboard'){$ready=$true;break}}catch{}
        Start-Sleep -Milliseconds 100
    }
    if(!$ready){throw 'Dashboard did not start. Check the configured port and Task Scheduler history.'}
}
