param([string]$Source=(Split-Path $PSScriptRoot -Parent),[switch]$Update)
$ErrorActionPreference='Stop'
$principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Open PowerShell as Administrator, then run .\scripts\setup-windows.ps1' }
if ($env:HOSTMAN_DATA_DIR -or $env:HOSTMAN_HOSTS_FILE) { throw 'Unset test path overrides before installing.' }
$Node=(Get-Command node.exe -ErrorAction Stop).Source
if ($Node -like "$env:USERPROFILE\*") { throw 'Install Node.js 22+ for all users under Program Files; the startup task runs as SYSTEM.' }
& $Node -e 'if (+process.versions.node.split(".")[0] < 22) process.exit(1)'
if($LASTEXITCODE -ne 0){throw 'Node.js 22+ is required.'}
$Python=(Get-Command python.exe -ErrorAction SilentlyContinue).Source
if ($Python) { & $Python -c 'import sys; assert sys.version_info >= (3,9)' }
if (!$Python -or $LASTEXITCODE -ne 0) {
    $Py=(Get-Command py.exe -ErrorAction Stop).Source
    $Python=(& $Py -3 -c 'import sys; assert sys.version_info >= (3,9); print(sys.executable)').Trim()
}
if (!$Python -or $LASTEXITCODE -ne 0) { throw 'Install Python 3.9+ and enable Add Python to PATH.' }
Get-Command git.exe -ErrorAction Stop | Out-Null
if (!(Test-Path (Join-Path $Source 'package.json'))) { throw 'Invalid Hostman source folder.' }
$Install=Join-Path $env:ProgramFiles 'Hostman'
$Data=Join-Path $env:ProgramData 'Hostman'
$Release=Join-Path $Install ('releases\release-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $Release,$Data,(Join-Path $Install 'bin') | Out-Null
# State and all executable code must be writable only by Administrators and SYSTEM.
& icacls.exe $Install /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
if($LASTEXITCODE -ne 0){throw 'Could not secure the installation directory.'}
& icacls.exe $Data /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
if($LASTEXITCODE -ne 0){throw 'Could not secure the data directory.'}
foreach ($item in @('bin','lib','python','scripts','test','docs','package.json','LICENSE','README.md')) { Copy-Item -Recurse (Join-Path $Source $item) $Release }
# Reset copied ACLs to the protected parent, including on subsequent updates.
& icacls.exe $Release /reset /T /Q | Out-Null
if($LASTEXITCODE -ne 0){throw 'Could not secure release files.'}
$env:HOSTMAN_PYTHON=$Python
& $Node (Join-Path $Release 'bin\hostman.mjs') init
if($LASTEXITCODE -ne 0){throw 'Could not initialize Hostman.'}
$Current=Join-Path $Install 'current.txt'
$Previous=if(Test-Path $Current){(Get-Content -Raw $Current).Trim()}else{''}
$TaskName='ByDT Hostman DNS'
$OldTask=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$WasRunning=$OldTask -and $OldTask.State -eq 'Running'
$WasDisabled=$OldTask -and $OldTask.State -eq 'Disabled'
if($OldTask){Stop-ScheduledTask -TaskName $TaskName; Start-Sleep -Milliseconds 500}
function Register-Resolver($Directory) {
    $action=New-ScheduledTaskAction -Execute $Node -Argument ('"'+(Join-Path $Directory 'bin\hostman.mjs')+'" dns serve') -WorkingDirectory $Directory
    $trigger=New-ScheduledTaskTrigger -AtStartup
    $settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
}
try {
    Register-Resolver $Release
    if(!$WasRunning -and (!$OldTask -or $WasDisabled)){Disable-ScheduledTask -TaskName $TaskName | Out-Null}
    $Release | Set-Content -Encoding UTF8 ($Current+'.tmp'); Move-Item -Force ($Current+'.tmp') $Current
    $Python | Set-Content -Encoding UTF8 (Join-Path $Install 'python.txt')
    $Node | Set-Content -Encoding UTF8 (Join-Path $Install 'node.txt')
    $launcher=@'
@echo off
setlocal
set /p HOSTMAN_RELEASE=<"%ProgramFiles%\Hostman\current.txt"
set /p HOSTMAN_NODE=<"%ProgramFiles%\Hostman\node.txt"
set /p HOSTMAN_PYTHON=<"%ProgramFiles%\Hostman\python.txt"
"%HOSTMAN_NODE%" "%HOSTMAN_RELEASE%\bin\hostman.mjs" %*
exit /b %errorlevel%
'@
    # Pointer files use ASCII to avoid a UTF-8 BOM becoming part of cmd.exe paths.
    [IO.File]::WriteAllText($Current,$Release,[Text.Encoding]::ASCII)
    [IO.File]::WriteAllText((Join-Path $Install 'python.txt'),$Python,[Text.Encoding]::ASCII)
    [IO.File]::WriteAllText((Join-Path $Install 'node.txt'),$Node,[Text.Encoding]::ASCII)
    [IO.File]::WriteAllText((Join-Path $Install 'bin\hostman.cmd'),$launcher,[Text.Encoding]::ASCII)
    Copy-Item (Join-Path $Install 'bin\hostman.cmd') (Join-Path $Install 'bin\hostmanager.cmd') -Force
    if($WasRunning){
        Start-ScheduledTask -TaskName $TaskName
        & $Python -c "import sys; sys.path.insert(0, sys.argv[1]); from system import probe; probe()" (Join-Path $Release 'python')
        if($LASTEXITCODE -ne 0){throw 'Updated DNS health check failed.'}
    }
} catch {
    if($Previous){
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Register-Resolver $Previous
        [IO.File]::WriteAllText($Current,$Previous,[Text.Encoding]::ASCII)
        if($WasRunning){Start-ScheduledTask -TaskName $TaskName}
        elseif($WasDisabled){Disable-ScheduledTask -TaskName $TaskName | Out-Null}
    }
    throw
}
if($Previous){[IO.File]::WriteAllText((Join-Path $Install 'previous.txt'),$Previous,[Text.Encoding]::ASCII)}
$Bin=Join-Path $Install 'bin'
$MachinePath=[Environment]::GetEnvironmentVariable('Path','Machine')
if (($MachinePath -split ';') -notcontains $Bin) { [Environment]::SetEnvironmentVariable('Path',($MachinePath.TrimEnd(';')+';'+$Bin),'Machine') }
$env:Path=$env:Path+';'+$Bin
Write-Host 'Hostman installed. Open a new terminal and run hostman.'
Write-Host 'Use an Administrator terminal for edits and hostman dns enable.'
