param([Parameter(Mandatory=$true)][string]$Source)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$env:ProgramFiles=[Environment]::GetFolderPath('ProgramFiles')
$Data=Join-Path $env:ProgramData 'Hostman'
New-Item -ItemType Directory -Force $Data | Out-Null
& icacls.exe $Data /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
if($LASTEXITCODE -ne 0){throw 'Could not secure the installer log directory.'}
$Log=Join-Path $Data 'installer.log'
Start-Transcript -Path $Log -Append | Out-Null
function Refresh-Path {
    $env:Path=[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User')
}
function Find-Node {
    foreach($path in @((Join-Path $env:ProgramFiles 'nodejs\node.exe'),(Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'))) {
        if(Test-Path $path){& $path -e 'if (+process.versions.node.split(".")[0] < 22) process.exit(1)' 2>$null;if($LASTEXITCODE -eq 0){return $path}}
    }
    return $null
}
function Find-Python {
    $paths=@()
    foreach($key in @(Get-ChildItem 'HKLM:\SOFTWARE\Python\PythonCore' -ErrorAction SilentlyContinue)) {
        $install=Get-ItemProperty ($key.PSPath+'\InstallPath') -ErrorAction SilentlyContinue
        if($install.ExecutablePath){$paths+=@($install.ExecutablePath)}
        elseif($install.'(default)'){$paths+=@(Join-Path $install.'(default)' 'python.exe')}
    }
    $paths+=@(Get-ChildItem $env:ProgramFiles -Directory -Filter 'Python*' | Sort-Object Name -Descending | ForEach-Object {Join-Path $_.FullName 'python.exe'})
    foreach($path in $paths){
        if(Test-Path $path){& $path -c 'import sys; assert sys.version_info >= (3,9)' 2>$null;if($LASTEXITCODE -eq 0){return $path}}
    }
    return $null
}
function Install-Dependency([string]$Package) {
    $winget=Get-Command winget.exe -ErrorAction SilentlyContinue
    if(!$winget){throw 'WinGet is unavailable. Install/update Microsoft App Installer, or install Node.js 22+ and Python 3.9+ for all users, then run this installer again.'}
    Write-Host "Installing missing dependency: $Package"
    & $winget.Source install --id $Package --exact --source winget --scope machine --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
    if($LASTEXITCODE -ne 0){throw "WinGet could not install $Package (exit $LASTEXITCODE). Install it for all users and rerun this installer."}
    Refresh-Path
}
try {
    $Node=Find-Node
    if(!$Node){Install-Dependency 'OpenJS.NodeJS.LTS';$Node=Find-Node}
    $Python=Find-Python
    if(!$Python){Install-Dependency 'Python.Python.3.13';$Python=Find-Python}
    if(!$Node -or !$Python){throw 'A required runtime was not found after dependency setup. See installer.log.'}
    $env:HOSTMAN_PYTHON=$Python
    $env:Path=(Split-Path $Node)+';'+(Split-Path $Python)+';'+$env:Path
    & (Join-Path $Source 'scripts\setup-windows.ps1') -Source $Source
    if(!$?){throw 'Hostman setup failed.'}
    Write-Host 'Hostman installation completed. Open a new terminal and run hostman.'
    Stop-Transcript | Out-Null
    exit 0
} catch {
    Write-Host ('INSTALLATION FAILED: '+$_.Exception.Message)
    Stop-Transcript | Out-Null
    exit 1
}
