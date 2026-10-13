param([string]$Output=(Join-Path (Split-Path $PSScriptRoot -Parent) '..\windows-installer.exe'))
$ErrorActionPreference='Stop'
$Root=Split-Path $PSScriptRoot -Parent
$NSIS=Get-Command makensis.exe -ErrorAction SilentlyContinue
if(!$NSIS){$Compiler=Join-Path ${env:ProgramFiles(x86)} 'NSIS\makensis.exe'}else{$Compiler=$NSIS.Source}
if(!(Test-Path $Compiler)){throw 'Install NSIS 3 and rerun this build script.'}
& $Compiler "/DSOURCE_DIR=$Root" "/DOUTPUT_FILE=$Output" (Join-Path $PSScriptRoot 'hostman.nsi')
if($LASTEXITCODE -ne 0){throw 'NSIS build failed.'}
Write-Host "Built $Output"
